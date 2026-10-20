package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

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
)

// connect serves one connection for its whole life. http.Server's
// ReadTimeout and WriteTimeout do not cut it off: net/http clears both
// deadlines when the upgrade hijacks the connection (composition_test.go
// holds it to that).
func (h *Handler) connect(c *gin.Context) {
	conn, err := websocket.Accept(c.Writer, c.Request, nil)
	if err != nil {
		return // Accept has written the HTTP error
	}
	defer func() { _ = conn.CloseNow() }()
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	conn.SetReadLimit(handshakeReadLimit)
	machineID, err := h.auth.Handshake(ctx, conn)
	if err != nil {
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

	ready, _ := json.Marshal(protocol.Ready{Type: "hub.ready", Machine: machineID})
	if err := conn.Write(ctx, websocket.MessageText, ready); err != nil {
		return
	}
	s := &session{conn: conn}
	h.svc.Connected(machineID, s)
	defer h.svc.Disconnected(machineID, s)
	go h.keepAlive(ctx, conn)

	for {
		if _, _, err := conn.Read(ctx); err != nil {
			return
		}
		// ponytail: no frame type means anything after the handshake yet, so
		// every frame is skipped, as an unknown type must be (ADR 0023).
		// Routing envelopes comes with the first signed command (#9).
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

type session struct{ conn *websocket.Conn }

// Replaced closes in the background: Close waits for the peer's answer, and
// the newer connection must not wait on the older one.
func (s *session) Replaced() {
	go func() { _ = s.conn.Close(protocol.CloseReplaced, "replaced by a newer connection") }()
}
