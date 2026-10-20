package middleware

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
)

// TEST-ONLY KEY: the seed packages/protocol's vectors use for TEST_MACHINE.
var testMachine = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x33}, 32))

func knownLookup(_ context.Context, key []byte) (string, bool, error) {
	if bytes.Equal(key, testMachine.Public().(ed25519.PublicKey)) {
		return "machine-1", true, nil
	}
	return "", false, nil
}

func TestVerifyAnswer_HandshakeVectors(t *testing.T) {
	var file struct {
		HubURL  string `json:"hubUrl"`
		Nonce   string `json:"nonce"`
		Vectors []struct {
			Name  string `json:"name"`
			Frame string `json:"frame"`
			Valid bool   `json:"valid"`
		} `json:"vectors"`
	}
	data, err := os.ReadFile("../../../../packages/protocol/vectors/handshakes.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	url, _ := protocol.NormalizeHubURL(file.HubURL)
	auth := KeyAuth{PublicURL: url, Lookup: knownLookup}
	for _, v := range file.Vectors {
		subject, err := auth.VerifyAnswer(context.Background(), file.Nonce, []byte(v.Frame))
		if v.Valid && (err != nil || subject != "machine-1") {
			t.Errorf("%s: want machine-1, got %q, %v", v.Name, subject, err)
		}
		if !v.Valid && !isAuthFailure(err) {
			t.Errorf("%s: want an auth failure, got %q, %v", v.Name, subject, err)
		}
	}
}

func isAuthFailure(err error) bool {
	var he *HandshakeError
	return errors.As(err, &he) && he.Code == protocol.CloseAuthFailed
}

func TestVerifyAnswer_Refusals(t *testing.T) {
	const url, nonce = "ws://hub.test", "bm9uY2Utbm9uY2Utbm9uY2Utbm9uY2Utbm9uY2Utbm9uY2U"
	auth := KeyAuth{PublicURL: url, Lookup: knownLookup}
	answer := func(key ed25519.PrivateKey, signed []byte) []byte {
		frame, _ := json.Marshal(protocol.Auth{
			Type: "hub.auth",
			Key:  base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey)),
			Sig:  base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, signed)),
		})
		return frame
	}
	stranger := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x22}, 32))

	cases := map[string][]byte{
		"unknown key, valid signature": answer(stranger, protocol.HandshakeBytes(url, nonce)),
		"another frame type":           []byte(`{"type":"hub.ping"}`),
		"not JSON":                     []byte(`{`),
		"key that is not base64url":    []byte(`{"type":"hub.auth","key":"a+b/","sig":"AA"}`),
		"key of the wrong length":      []byte(`{"type":"hub.auth","key":"AAAA","sig":"AA"}`),
	}
	for name, frame := range cases {
		if _, err := auth.VerifyAnswer(context.Background(), nonce, frame); !isAuthFailure(err) {
			t.Errorf("%s: want an auth failure, got %v", name, err)
		}
	}

	if got, err := auth.VerifyAnswer(context.Background(), nonce, answer(testMachine, protocol.HandshakeBytes(url, nonce))); err != nil || got != "machine-1" {
		t.Errorf("valid answer: got %q, %v", got, err)
	}
}

func TestVerifyAnswer_LookupFailureIsNotAnAuthFailure(t *testing.T) {
	const url, nonce = "ws://hub.test", "bm9uY2U"
	broken := func(context.Context, []byte) (string, bool, error) { return "", false, errors.New("db down") }
	frame, _ := json.Marshal(protocol.Auth{
		Type: "hub.auth",
		Key:  base64.RawURLEncoding.EncodeToString(testMachine.Public().(ed25519.PublicKey)),
		Sig:  base64.RawURLEncoding.EncodeToString(ed25519.Sign(testMachine, protocol.HandshakeBytes(url, nonce))),
	})
	_, err := KeyAuth{PublicURL: url, Lookup: broken}.VerifyAnswer(context.Background(), nonce, frame)
	if err == nil || isAuthFailure(err) {
		t.Fatalf("want the lookup's own error, got %v", err)
	}
}

// handshakeServer runs Handshake on every connection and reports its result.
func handshakeServer(t *testing.T, auth KeyAuth) (string, <-chan error) {
	t.Helper()
	results := make(chan error, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		_, err = auth.Handshake(r.Context(), conn)
		results <- err
		var he *HandshakeError
		if errors.As(err, &he) {
			_ = conn.Close(he.Code, he.Reason)
		} else {
			_ = conn.CloseNow()
		}
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http"), results
}

func readChallenge(t *testing.T, ctx context.Context, conn *websocket.Conn) protocol.Challenge {
	t.Helper()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var c protocol.Challenge
	if err := json.Unmarshal(data, &c); err != nil || c.Type != "hub.challenge" || c.V != 1 || len(c.Nonce) < 43 {
		t.Fatalf("first frame %s is not a challenge", data)
	}
	return c
}

func TestHandshake_FirstFrameIsAFreshChallenge(t *testing.T) {
	url, _ := handshakeServer(t, KeyAuth{PublicURL: "ws://hub.test", Timeout: time.Second, Lookup: knownLookup})
	ctx := context.Background()
	seen := map[string]bool{}
	for range 3 {
		conn, _, err := websocket.Dial(ctx, url, nil)
		if err != nil {
			t.Fatal(err)
		}
		c := readChallenge(t, ctx, conn)
		if seen[c.Nonce] {
			t.Fatalf("nonce %s sent twice", c.Nonce)
		}
		seen[c.Nonce] = true
		_ = conn.CloseNow()
	}
}

func TestHandshake_SilentClientTimesOut(t *testing.T) {
	url, results := handshakeServer(t, KeyAuth{PublicURL: "ws://hub.test", Timeout: 100 * time.Millisecond, Lookup: knownLookup})
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	readChallenge(t, ctx, conn)
	_, _, err = conn.Read(ctx)
	if code := websocket.CloseStatus(err); code != protocol.CloseHandshakeTimeout {
		t.Fatalf("want close %d, got %d (%v)", protocol.CloseHandshakeTimeout, code, err)
	}
	if err := <-results; err == nil {
		t.Fatal("handshake should have failed")
	}
}

func TestHandshake_ReplayedAnswerIsRefused(t *testing.T) {
	const hub = "ws://hub.test"
	url, results := handshakeServer(t, KeyAuth{PublicURL: hub, Timeout: time.Second, Lookup: knownLookup})
	ctx := context.Background()

	first, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	c := readChallenge(t, ctx, first)
	answer, _ := json.Marshal(protocol.Auth{
		Type: "hub.auth",
		Key:  base64.RawURLEncoding.EncodeToString(testMachine.Public().(ed25519.PublicKey)),
		Sig:  base64.RawURLEncoding.EncodeToString(ed25519.Sign(testMachine, protocol.HandshakeBytes(hub, c.Nonce))),
	})
	if err := first.Write(ctx, websocket.MessageText, answer); err != nil {
		t.Fatal(err)
	}
	if err := <-results; err != nil {
		t.Fatalf("first answer: %v", err)
	}

	second, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = second.CloseNow() }()
	readChallenge(t, ctx, second)
	if err := second.Write(ctx, websocket.MessageText, answer); err != nil {
		t.Fatal(err)
	}
	_, _, err = second.Read(ctx)
	if code := websocket.CloseStatus(err); code != protocol.CloseAuthFailed {
		t.Fatalf("replayed answer: want close %d, got %d (%v)", protocol.CloseAuthFailed, code, err)
	}
}

func TestHandshake_FrameBeforeAnswerIsRefused(t *testing.T) {
	url, _ := handshakeServer(t, KeyAuth{PublicURL: "ws://hub.test", Timeout: time.Second, Lookup: knownLookup})
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	readChallenge(t, ctx, conn)
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"task.message"}`)); err != nil {
		t.Fatal(err)
	}
	_, _, err = conn.Read(ctx)
	if code := websocket.CloseStatus(err); code != protocol.CloseAuthFailed {
		t.Fatalf("want close %d, got %d (%v)", protocol.CloseAuthFailed, code, err)
	}
}
