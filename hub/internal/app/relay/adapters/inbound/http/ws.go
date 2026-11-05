package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"hub/internal/app/relay/ports"
	"hub/internal/shared/middleware"
	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
)

const (
	// Before the handshake a peer has proved nothing, so it gets just enough
	// room for an answer.
	handshakeReadLimit = 4 << 10
	readLimit          = 1 << 20
	// Enough for a few full frames in flight; past it the receiver is cut off.
	defaultQueueLimit = 4 << 20
)

// connect serves one connection for its whole life. http.Server's
// ReadTimeout and WriteTimeout do not cut it off: net/http clears both
// deadlines when the upgrade hijacks the connection (composition_test.go
// holds it to that).
func (h *Handler) connect(c *gin.Context) {
	// The Origin check guards cookies, and this connection carries none: only a
	// signature over the challenge proves anything. The Controller on the web
	// lives on another origin than a self-hosted Hub, so it must get through.
	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return // Accept has written the HTTP error
	}
	defer func() { _ = conn.CloseNow() }()
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	conn.SetReadLimit(handshakeReadLimit)
	// The handshake asks for a subject; the identity behind it is kept here.
	var who ports.Identity
	auth := h.auth
	auth.Lookup = func(ctx context.Context, key []byte) (string, bool, error) {
		found, ok, err := h.svc.Identify(ctx, key)
		who = found
		if err != nil || ok {
			return found.ID, ok, err
		}
		// 4401 is also what a new device waiting to be linked gets; a revoked
		// one has to know it is not coming back.
		revoked, err := h.svc.Revoked(ctx, key)
		if err == nil && revoked {
			err = &middleware.HandshakeError{Code: protocol.CloseRevoked, Reason: "key revoked"}
		}
		return "", false, err
	}
	if _, err := auth.Handshake(ctx, conn); err != nil {
		var he *middleware.HandshakeError
		if errors.As(err, &he) {
			_ = conn.Close(he.Code, he.Reason)
		} else {
			slog.Error("handshake", "error", err)
			_ = conn.Close(websocket.StatusInternalError, "internal error")
		}
		return
	}
	conn.SetReadLimit(readLimit)

	readyFrame := protocol.Ready{Type: "hub.ready", Machine: who.ID}
	if who.Kind == ports.KindController {
		readyFrame = protocol.Ready{Type: "hub.ready", Member: who.ID}
	}
	ready, _ := json.Marshal(readyFrame)
	if err := conn.Write(ctx, websocket.MessageText, ready); err != nil {
		return
	}
	// The certificates go ahead of any envelope, so a Machine learns of a
	// revocation before it reads anything the revoked key sent (ADR 0031). They
	// are read after the session is live, so one made in between is published
	// to it as well, and a duplicate is harmless; the pump starts last, so they
	// are first in line.
	s := newSession(conn, h.queueLimit)
	h.svc.Connected(who, s)
	defer h.svc.Disconnected(who, s)
	certificates, err := h.svc.Certificates(ctx, who.Workspace)
	if err != nil {
		// Without them a Machine could take envelopes from a revoked key.
		slog.Error("certificates", "error", err)
		_ = conn.Close(websocket.StatusInternalError, "internal error")
		return
	}
	if certificates != nil {
		s.sendFirst(certificates)
	}
	go s.pump(ctx)
	go h.keepAlive(ctx, conn)

	for {
		_, frame, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if answer := h.svc.Route(who, s, frame); answer != nil {
			data, _ := json.Marshal(answer)
			s.Send(data)
		}
	}
}

// keepAlive pings every half interval and gives each ping half an interval to
// come back, so a connection that stops answering is gone within one
// interval. Dropping it ends connect's read loop, which takes the Machine
// offline; there is no close handshake to wait for from a peer that has
// stopped answering.
func (h *Handler) keepAlive(ctx context.Context, conn *websocket.Conn) {
	half := h.heartbeat / 2
	ticker := time.NewTicker(half)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, half)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				_ = conn.CloseNow()
				return
			}
		}
	}
}
