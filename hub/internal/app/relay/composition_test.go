package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	httpadapter "hub/internal/app/relay/adapters/inbound/http"
	"hub/internal/app/relay/adapters/outbound/memory"
	"hub/internal/app/relay/application"
	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
)

// TEST-ONLY KEY: the seed packages/protocol's vectors use for TEST_MACHINE.
var testMachine = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x33}, 32))

const hubURL = "ws://hub.test"

type keys struct{}

func (keys) MachineByKey(_ context.Context, key []byte) (string, bool, error) {
	if bytes.Equal(key, testMachine.Public().(ed25519.PublicKey)) {
		return "machine-1", true, nil
	}
	return "", false, nil
}

// startHub runs the relay behind an http.Server with deliberately short
// timeouts, so a test also sees whether they leak onto upgraded connections.
func startHub(t *testing.T, heartbeat time.Duration) (string, *application.Service) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	svc := application.NewService(keys{}, memory.NewPresence())
	r := gin.New()
	httpadapter.NewHandler(svc, Config{PublicURL: hubURL, HandshakeTimeout: time.Second, HeartbeatInterval: heartbeat}).Register(r)
	srv := httptest.NewUnstartedServer(r)
	srv.Config.ReadTimeout = 300 * time.Millisecond
	srv.Config.WriteTimeout = 300 * time.Millisecond
	srv.Start()
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/connect", svc
}

// connect dials and completes the handshake as testMachine.
func connect(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var c protocol.Challenge
	_ = json.Unmarshal(data, &c)
	answer, _ := json.Marshal(protocol.Auth{
		Type: "hub.auth",
		Key:  base64.RawURLEncoding.EncodeToString(testMachine.Public().(ed25519.PublicKey)),
		Sig:  base64.RawURLEncoding.EncodeToString(ed25519.Sign(testMachine, protocol.HandshakeBytes(hubURL, c.Nonce))),
	})
	if err := conn.Write(ctx, websocket.MessageText, answer); err != nil {
		t.Fatal(err)
	}
	_, data, err = conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ready protocol.Ready
	if err := json.Unmarshal(data, &ready); err != nil || ready.Type != "hub.ready" || ready.Machine != "machine-1" {
		t.Fatalf("want hub.ready for machine-1, got %s", data)
	}
	return conn
}

// keepReading answers the Hub's pings (coder/websocket does so only while
// reading) and reports how the connection ended.
func keepReading(conn *websocket.Conn) <-chan error {
	done := make(chan error, 1)
	go func() {
		for {
			if _, _, err := conn.Read(context.Background()); err != nil {
				done <- err
				return
			}
		}
	}()
	return done
}

func eventually(t *testing.T, within time.Duration, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("not %s within %s", what, within)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRelay_CleanDisconnectGoesOfflineAtOnce(t *testing.T) {
	url, svc := startHub(t, time.Second)
	conn := connect(t, url)
	eventually(t, time.Second, func() bool { return svc.Online("machine-1") }, "online")

	_ = conn.Close(websocket.StatusNormalClosure, "bye")
	eventually(t, 200*time.Millisecond, func() bool { return !svc.Online("machine-1") }, "offline")
}

func TestRelay_ConnectionThatStopsAnsweringGoesOfflineWithinOneInterval(t *testing.T) {
	const interval = 200 * time.Millisecond
	url, svc := startHub(t, interval)
	connect(t, url) // and never read again, so no pong goes back
	eventually(t, time.Second, func() bool { return svc.Online("machine-1") }, "online")

	start := time.Now()
	eventually(t, 2*interval, func() bool { return !svc.Online("machine-1") }, "offline")
	if took := time.Since(start); took > interval+50*time.Millisecond {
		t.Fatalf("went offline after %s, want within one interval (%s)", took, interval)
	}
}

func TestRelay_NewerConnectionReplacesTheOlder(t *testing.T) {
	url, svc := startHub(t, time.Second)
	older := connect(t, url)
	olderEnded := keepReading(older)

	connect(t, url)
	select {
	case err := <-olderEnded:
		if code := websocket.CloseStatus(err); code != protocol.CloseReplaced {
			t.Fatalf("older connection: want close %d, got %d (%v)", protocol.CloseReplaced, code, err)
		}
	case <-time.After(time.Second):
		t.Fatal("older connection was not closed")
	}
	time.Sleep(50 * time.Millisecond) // let the older connection's cleanup run
	if !svc.Online("machine-1") {
		t.Fatal("the Machine must stay online on the newer connection")
	}
}

func TestRelay_UnknownFrameAfterAuthIsSkipped(t *testing.T) {
	url, svc := startHub(t, 200*time.Millisecond)
	conn := connect(t, url)
	ended := keepReading(conn)
	if err := conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"runtime.something-new"}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-ended:
		t.Fatalf("connection closed after an unknown frame: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	if !svc.Online("machine-1") {
		t.Fatal("still online after an unknown frame")
	}
}

// startHub sets a 300ms server ReadTimeout and WriteTimeout. A connection must
// outlive both, or every Machine would drop as soon as the timeouts pass.
func TestRelay_ConnectionOutlivesTheServerTimeouts(t *testing.T) {
	url, svc := startHub(t, 200*time.Millisecond)
	conn := connect(t, url)
	ended := keepReading(conn)

	select {
	case err := <-ended:
		t.Fatalf("connection dropped: %v", err)
	case <-time.After(time.Second):
	}
	if err := conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"still.here"}`)); err != nil {
		t.Fatalf("write after the server timeouts: %v", err)
	}
	if !svc.Online("machine-1") {
		t.Fatal("still online after the server timeouts")
	}
}
