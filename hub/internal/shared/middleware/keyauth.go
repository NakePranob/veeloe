package middleware

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
)

// KeyLookup answers who holds a public key. ok is false for a key nobody
// holds; err is for the lookup itself failing.
type KeyLookup func(ctx context.Context, publicKey []byte) (subject string, ok bool, err error)

// KeyAuth proves who is on the other end of a WebSocket by their key alone
// (ADR 0013): a fresh nonce in the first frame, an Ed25519 signature over it
// back. The challenge travels in a frame, not a header, so browsers can do it.
// It takes the lookup as a function and does no IO of its own (ADR 0022).
type KeyAuth struct {
	// PublicURL is this Hub's normalized public URL. It is in the signed
	// bytes, so an answer made for another Hub does not work here.
	PublicURL string
	Timeout   time.Duration
	Lookup    KeyLookup
}

// HandshakeError says how to close the connection.
type HandshakeError struct {
	Code   websocket.StatusCode
	Reason string
}

func (e *HandshakeError) Error() string { return fmt.Sprintf("handshake %d: %s", e.Code, e.Reason) }

var errAuth = &HandshakeError{Code: protocol.CloseAuthFailed, Reason: "authentication failed"}

// Handshake runs the challenge on conn and answers the subject behind the key.
// On a *HandshakeError the caller closes conn with its code; any other error
// is the Hub's own fault.
func (a KeyAuth) Handshake(ctx context.Context, conn *websocket.Conn) (string, error) {
	// Not a context deadline: coder/websocket drops the connection without a
	// close frame when a Read's context ends, and the client should be told
	// why. The timer closes it properly instead, which also ends the Read.
	var timedOut atomic.Bool
	timer := time.AfterFunc(a.Timeout, func() {
		timedOut.Store(true)
		_ = conn.Close(protocol.CloseHandshakeTimeout, "handshake timed out")
	})
	defer timer.Stop()
	timeoutOr := func(err error) error {
		if timedOut.Load() {
			return &HandshakeError{Code: protocol.CloseHandshakeTimeout, Reason: "handshake timed out"}
		}
		return err
	}

	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	nonce := base64.RawURLEncoding.EncodeToString(raw[:])
	challenge, _ := json.Marshal(protocol.Challenge{Type: "hub.challenge", V: 1, Nonce: nonce})
	if err := conn.Write(ctx, websocket.MessageText, challenge); err != nil {
		return "", timeoutOr(err)
	}

	_, frame, err := conn.Read(ctx)
	if err != nil {
		return "", timeoutOr(err)
	}
	if !timer.Stop() {
		return "", timeoutOr(errors.New("handshake timed out"))
	}
	return a.VerifyAnswer(ctx, nonce, frame)
}

// VerifyAnswer checks one answer frame against the nonce this connection was
// sent. Anything but a valid hub.auth from a known key is an auth failure.
func (a KeyAuth) VerifyAnswer(ctx context.Context, nonce string, frame []byte) (string, error) {
	var answer protocol.Auth
	if err := json.Unmarshal(frame, &answer); err != nil || answer.Type != "hub.auth" {
		return "", errAuth
	}
	key, err := base64.RawURLEncoding.DecodeString(answer.Key)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return "", errAuth
	}
	sig, err := base64.RawURLEncoding.DecodeString(answer.Sig)
	if err != nil || !ed25519.Verify(key, protocol.HandshakeBytes(a.PublicURL, nonce), sig) {
		return "", errAuth
	}
	// Looked up only after the signature checks out: an unsigned answer never
	// reaches the database.
	subject, ok, err := a.Lookup(ctx, key)
	if err != nil {
		return "", fmt.Errorf("look up key: %w", err)
	}
	if !ok {
		return "", errAuth
	}
	return subject, nil
}
