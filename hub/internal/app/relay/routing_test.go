package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
)

// envelope builds a frame the Hub routes. The Hub never checks the signature,
// so these need no real one; the odd spacing and the unknown field show the
// bytes pass through untouched.
func envelope(from ed25519.PrivateKey, route, sig, body string) []byte {
	return fmt.Appendf(nil, `{ "v":1, "type":"future.type",  "from":%q, %s, "hint":"new", "signed":%q, "sig":%q }`, keyText(from), route, body, sig)
}

func send(t *testing.T, conn *websocket.Conn, frame []byte) {
	t.Helper()
	if err := conn.Write(context.Background(), websocket.MessageText, frame); err != nil {
		t.Fatal(err)
	}
}

func receive(t *testing.T, conn *websocket.Conn) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("expected a frame: %v", err)
	}
	return data
}

func receiveError(t *testing.T, conn *websocket.Conn, code, ref string) {
	t.Helper()
	var e protocol.Error
	data := receive(t, conn)
	if err := json.Unmarshal(data, &e); err != nil || e.Type != "hub.error" || e.Code != code || e.Ref != ref {
		t.Fatalf("want %s about %s, got %s", code, ref, data)
	}
}

// expectNothing ends conn: coder/websocket closes a connection whose Read times out.
func expectNothing(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if _, data, err := conn.Read(ctx); err == nil {
		t.Fatalf("expected nothing, got %s", data)
	}
}

func TestConnect_EachKindGetsItsOwnReady(t *testing.T) {
	url, _ := startHub(t, time.Second)
	if _, ready := connectAs(t, url, testMachine); ready.Machine != "machine-1" || ready.Member != "" {
		t.Fatalf("machine: %+v", ready)
	}
	if _, ready := connectAs(t, url, testController); ready.Member != "member-1" || ready.Machine != "" {
		t.Fatalf("controller: %+v", ready)
	}
}

// A Controller on the web sends its own origin; the signature is what counts.
func TestConnect_AcceptsAnotherOrigin(t *testing.T) {
	url, _ := startHub(t, time.Second)
	opts := &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://app.example.com"}}}
	conn, _, err := websocket.Dial(context.Background(), url, opts)
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.CloseNow()
}

func TestConnect_UnknownKeyIsClosed(t *testing.T) {
	url, _ := startHub(t, time.Second)
	stranger := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x99}, 32))
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	_, data, _ := conn.Read(ctx)
	var c protocol.Challenge
	_ = json.Unmarshal(data, &c)
	answer, _ := json.Marshal(protocol.Auth{Type: "hub.auth", Key: keyText(stranger), Sig: base64.RawURLEncoding.EncodeToString(ed25519.Sign(stranger, protocol.HandshakeBytes(hubURL, c.Nonce)))})
	send(t, conn, answer)
	_, _, err = conn.Read(ctx)
	if code := websocket.CloseStatus(err); code != protocol.CloseAuthFailed {
		t.Fatalf("want close %d, got %d (%v)", protocol.CloseAuthFailed, code, err)
	}
}

func TestRoute_ToReachesTheMachineWithTheSameBytes(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	frame := envelope(testController, `"to":"machine-1"`, "sig-1", "body")
	send(t, controller, frame)
	if got := receive(t, machine); !bytes.Equal(got, frame) {
		t.Fatalf("got %s, want %s", got, frame)
	}
}

func TestRoute_OfflineUnknownAndOtherWorkspaceAnswerTheSame(t *testing.T) {
	url, _ := startHub(t, time.Second)
	connectAs(t, url, onlyMachine) // online, in another Workspace
	controller, _ := connectAs(t, url, testController)
	for _, target := range []string{"machine-1", "never-existed", "machine-only-there"} {
		send(t, controller, envelope(testController, fmt.Sprintf(`"to":%q`, target), "sig-"+target, "b"))
		receiveError(t, controller, protocol.CodeMachineOffline, "sig-"+target)
	}
}

func TestRoute_SameIDInAnotherWorkspaceIsNotReached(t *testing.T) {
	url, _ := startHub(t, time.Second)
	theirs, _ := connectAs(t, url, otherMachine) // also "machine-1", in w-2
	controller, _ := connectAs(t, url, testController)
	send(t, controller, envelope(testController, `"to":"machine-1"`, "sig-1", "b"))
	receiveError(t, controller, protocol.CodeMachineOffline, "sig-1")
	expectNothing(t, theirs)
}

func TestRoute_RecipientsReachEveryControllerInTheWorkspace(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	first, _ := connectAs(t, url, testController)
	second, _ := connectAs(t, url, testController2)
	theirs, _ := connectAs(t, url, otherController) // also "member-1", in w-2

	frame := envelope(testMachine, `"recipients":["member-1","member-1","nobody-connected"]`, "sig-1", "b")
	send(t, machine, frame)
	for _, c := range []*websocket.Conn{first, second} {
		if got := receive(t, c); !bytes.Equal(got, frame) {
			t.Fatalf("got %s", got)
		}
		expectNothing(t, c) // a repeated name delivers once
	}
	expectNothing(t, theirs)
	expectNothing(t, machine) // a Member who is not connected is no error
}

func TestRoute_RefusesAForgedSender(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	send(t, controller, envelope(testController2, `"to":"machine-1"`, "sig-1", "b"))
	receiveError(t, controller, protocol.CodeSenderMismatch, "sig-1")
	expectNothing(t, machine)
}

// Go matches JSON names regardless of case, and receivers do not: `FROM` must
// not pass the check while receivers read the forged `from`.
func TestRoute_RefusesAForgedSenderBehindAnotherCase(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	send(t, controller, fmt.Appendf(nil, `{"v":1,"type":"x","from":%q,"FROM":%q,"to":"machine-1","signed":"b","sig":"sig-1"}`, keyText(testController2), keyText(testController)))
	receiveError(t, controller, protocol.CodeSenderMismatch, "sig-1")
	expectNothing(t, machine)
}

func TestRoute_EachKindUsesItsOwnRoute(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	send(t, controller, envelope(testController, `"recipients":["member-2"]`, "sig-1", "b"))
	receiveError(t, controller, protocol.CodeRouteNotAllowed, "sig-1")
	send(t, machine, envelope(testMachine, `"to":"machine-1"`, "sig-2", "b"))
	receiveError(t, machine, protocol.CodeRouteNotAllowed, "sig-2")
}

func TestRoute_SkipsWhatItCannotRouteAndStaysOpen(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	for _, frame := range [][]byte{
		[]byte(`not json`),
		[]byte(`{"type":"something.new"}`),
		envelope(testController, `"to":"machine-1","recipients":["member-1"]`, "both", "b"),
		envelope(testController, `"task":"t"`, "neither", "b"),
		envelope(testController, `"recipients":[]`, "empty", "b"),
	} {
		send(t, controller, frame)
	}
	// Still open, an unknown message type still goes through, and being the
	// first frame to arrive shows nothing before it was forwarded.
	good := envelope(testController, `"to":"machine-1"`, "good", "b")
	send(t, controller, good)
	if got := receive(t, machine); !bytes.Equal(got, good) {
		t.Fatalf("got %s", got)
	}
	expectNothing(t, controller) // nothing answered for what was skipped
}

func TestRoute_KeepsOrderInABurst(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	const burst = 500
	for i := range burst {
		send(t, controller, envelope(testController, `"to":"machine-1"`, fmt.Sprintf("sig-%d", i), "b"))
	}
	for i := range burst {
		var h protocol.Header
		if err := json.Unmarshal(receive(t, machine), &h); err != nil || h.Sig != fmt.Sprintf("sig-%d", i) {
			t.Fatalf("frame %d: %+v, %v", i, h, err)
		}
	}
}

func TestRoute_ASlowReceiverIsCutOffAndOthersKeepFlowing(t *testing.T) {
	url, svc := startHubWith(t, Config{HeartbeatInterval: time.Minute, MaxQueueBytes: 1 << 20})
	stalled, _ := connectAs(t, url, testMachine) // never reads again
	controller, _ := connectAs(t, url, testController)
	listener, _ := connectAs(t, url, testController2)

	big := strings.Repeat("x", 900<<10)
	frame := envelope(testController, `"to":"machine-1"`, "big", big)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	go func() {
		for ctx.Err() == nil {
			if controller.Write(ctx, websocket.MessageText, frame) != nil {
				return
			}
		}
	}()
	for ctx.Err() == nil && svc.Online("w-1", "machine-1") {
		time.Sleep(20 * time.Millisecond)
	}
	if ctx.Err() != nil {
		t.Fatal("the stalled receiver was never cut off")
	}
	cancel()
	_ = stalled.CloseNow()

	// The Hub still serves everyone else.
	replacement, _ := connectAs(t, url, testMachine)
	go keepReading(replacement)
	send(t, replacement, envelope(testMachine, `"recipients":["member-1"]`, "after", "b"))
	var h protocol.Header
	if err := json.Unmarshal(receive(t, listener), &h); err != nil || h.Sig != "after" {
		t.Fatalf("after the cut-off: %+v, %v", h, err)
	}
}

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

func TestRoute_NeverLogsTheSignedPart(t *testing.T) {
	var logs lockedBuffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(previous)

	const marker = "SECRET-MARKER"
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	send(t, controller, envelope(testController, `"to":"machine-1"`, "delivered", marker))
	receive(t, machine)
	send(t, controller, envelope(testController, `"to":"nowhere"`, "offline", marker))
	receiveError(t, controller, protocol.CodeMachineOffline, "offline")
	send(t, controller, envelope(testMachine, `"to":"machine-1"`, "forged", marker))
	receiveError(t, controller, protocol.CodeSenderMismatch, "forged")
	send(t, controller, envelope(testController, `"recipients":["x"]`, "route", marker))
	receiveError(t, controller, protocol.CodeRouteNotAllowed, "route")
	send(t, machine, envelope(testMachine, `"recipients":["member-1"]`, "back", marker))
	receive(t, controller)
	send(t, controller, envelope(testController, `"task":"no-route"`, "skip", marker))
	send(t, controller, []byte(`{"junk":"`+marker+`"}`))
	_ = machine.Close(websocket.StatusNormalClosure, marker)
	time.Sleep(50 * time.Millisecond)

	if strings.Contains(logs.String(), marker) {
		t.Fatalf("logs carry the signed part:\n%s", logs.String())
	}
}
