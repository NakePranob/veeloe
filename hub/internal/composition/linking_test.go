package composition

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"hub/internal/app/controller"
	"hub/internal/app/linking"
	"hub/internal/app/machine"
	"hub/internal/app/relay"
	"hub/internal/shared/middleware"
	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const hubURL = "ws://hub.test"

var text = base64.RawURLEncoding.EncodeToString

// On real commits: the relay reads from other goroutines than the request
// that wrote, which one rolled-back transaction cannot serve.
func openDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		if os.Getenv("REQUIRE_TEST_DB") == "true" {
			t.Fatal("TEST_DB_DSN is required when REQUIRE_TEST_DB=true")
		}
		t.Skip("skipped: set TEST_DB_DSN to a migrated PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	return db
}

func newKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func public(key ed25519.PrivateKey) []byte { return key.Public().(ed25519.PublicKey) }

// startHub wires the relay and linking as cmd/api does.
func startHub(t *testing.T, db *gorm.DB) (ws, api string) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Error(false))
	live := relay.New(RelayIdentities(machine.NewLookupFromDB(db), controller.NewLookupFromDB(db)), linking.NewCertificatesFromDB(db),
		relay.Config{PublicURL: hubURL, HandshakeTimeout: time.Second, HeartbeatInterval: time.Second})
	live.Register(r)
	linking.NewHandlerFromDB(db, live).Register(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/connect", srv.URL
}

// dial answers the connection after hub.ready, or the close code it got instead.
func dial(t *testing.T, url string, key ed25519.PrivateKey) (*websocket.Conn, websocket.StatusCode) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
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
	answer, _ := json.Marshal(protocol.Auth{Type: "hub.auth", Key: text(public(key)), Sig: text(ed25519.Sign(key, protocol.HandshakeBytes(hubURL, c.Nonce)))})
	if err := conn.Write(ctx, websocket.MessageText, answer); err != nil {
		t.Fatal(err)
	}
	if _, _, err = conn.Read(ctx); err != nil {
		return nil, websocket.CloseStatus(err)
	}
	return conn, -1
}

func read(t *testing.T, conn *websocket.Conn) ([]byte, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	return data, err
}

func certificates(t *testing.T, conn *websocket.Conn) []protocol.Certificate {
	t.Helper()
	data, err := read(t, conn)
	var got protocol.Certificates
	if err != nil || json.Unmarshal(data, &got) != nil || got.Type != "hub.certificates" {
		t.Fatalf("want hub.certificates, got %s (%v)", data, err)
	}
	return got.Certificates
}

func sign(fields map[string]any, by ed25519.PrivateKey) protocol.Certificate {
	fields["v"], fields["at"], fields["by"] = 1, 1800000000000, text(public(by))
	signed, _ := json.Marshal(fields)
	return protocol.Certificate{Signed: string(signed), Sig: text(ed25519.Sign(by, signed))}
}

func post(t *testing.T, api, path string, c protocol.Certificate) {
	t.Helper()
	raw, _ := json.Marshal(c)
	res, err := http.Post(api+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("%s: %d", path, res.StatusCode)
	}
}

// A linked key gets in; a revoked one is cut off at once and kept out after.
func TestLinkThenRevokeAtTheRelay(t *testing.T) {
	db := openDB(t)
	workspace, member := uuid.NewString(), "m_"+strings.ToLower(rand.Text())
	first, phone, machineKey := newKey(t), newKey(t), newKey(t)
	t.Cleanup(func() {
		db.Exec("DELETE FROM controller_svc.certificates WHERE workspace_id = ?", workspace)
		db.Exec("DELETE FROM controller_svc.controllers WHERE workspace_id = ?", workspace)
		db.Exec("DELETE FROM machine_svc.machines WHERE workspace_id = ?", workspace)
		db.Exec("DELETE FROM workspace_svc.workspaces WHERE id = ?", workspace)
	})
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO workspace_svc.workspaces (id) VALUES (?)", []any{workspace}},
		{"INSERT INTO controller_svc.controllers (id, workspace_id, member_id, public_key) VALUES (?, ?, ?, ?)", []any{uuid.New(), workspace, member, public(first)}},
		{"INSERT INTO machine_svc.machines (id, workspace_id, public_key) VALUES (?, ?, ?)", []any{uuid.New(), workspace, public(machineKey)}},
	} {
		if err := db.Exec(q.sql, q.args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	ws, api := startHub(t, db)

	if _, code := dial(t, ws, phone); code != protocol.CloseAuthFailed {
		t.Fatalf("before the link: close %d", code)
	}
	runtime, _ := dial(t, ws, machineKey)

	linked := sign(map[string]any{"type": "device.link", "workspace": workspace, "member": member, "key": text(public(phone)), "name": "Phone"}, first)
	post(t, api, "/links", linked)
	if got := certificates(t, runtime); len(got) != 1 || got[0] != linked {
		t.Fatalf("published %v", got)
	}
	device, code := dial(t, ws, phone)
	if device == nil {
		t.Fatalf("after the link: close %d", code)
	}
	if got := certificates(t, device); len(got) != 1 || got[0] != linked {
		t.Fatalf("on connect %v", got)
	}
	// The phone links a tablet, which goes with it when the phone is revoked.
	tablet := newKey(t)
	tabletLinked := sign(map[string]any{"type": "device.link", "workspace": workspace, "member": member, "key": text(public(tablet)), "name": "Tablet"}, phone)
	post(t, api, "/links", tabletLinked)
	if got := certificates(t, runtime); len(got) != 1 || got[0] != tabletLinked {
		t.Fatalf("published %v", got)
	}
	if got := certificates(t, device); len(got) != 1 || got[0] != tabletLinked {
		t.Fatalf("published to the phone %v", got)
	}

	revoked := sign(map[string]any{"type": "device.revoke", "workspace": workspace, "member": member, "key": text(public(phone)), "keep": []string{}}, first)
	post(t, api, "/revocations", revoked)
	if _, err := read(t, device); websocket.CloseStatus(err) != protocol.CloseRevoked {
		t.Fatalf("live session: want close %d, got %v", protocol.CloseRevoked, err)
	}
	if got := certificates(t, runtime); len(got) != 1 || got[0] != revoked {
		t.Fatalf("published %v", got)
	}
	// Told it is revoked, not that it is unknown, which a device waiting to be
	// linked also hears; a key nobody ever saw still gets 4401.
	if _, code := dial(t, ws, phone); code != protocol.CloseRevoked {
		t.Fatalf("after the revocation: close %d", code)
	}
	if _, code := dial(t, ws, tablet); code != protocol.CloseRevoked {
		t.Fatalf("the tablet dropped with it: close %d", code)
	}
	if _, code := dial(t, ws, newKey(t)); code != protocol.CloseAuthFailed {
		t.Fatalf("a key never seen: close %d", code)
	}

	// A Machine that was off through both gets both, in order, before anything else.
	_ = runtime.CloseNow()
	runtime, _ = dial(t, ws, machineKey)
	if got := certificates(t, runtime); len(got) != 3 || got[0] != linked || got[1] != tabletLinked || got[2] != revoked {
		t.Fatalf("on reconnect %v", got)
	}
}
