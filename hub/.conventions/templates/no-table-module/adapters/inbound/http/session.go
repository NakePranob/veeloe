package httpadapter

import (
	"context"
	"sync"

	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
)

// session writes to one connection from its own goroutine. Senders only queue,
// so each sender's order is kept and a stalled receiver holds up nobody else.
type session struct {
	conn  *websocket.Conn
	limit int

	mu     sync.Mutex
	queue  [][]byte
	queued int
	closed bool
	wake   chan struct{}
}

func newSession(conn *websocket.Conn, limit int) *session {
	return &session{conn: conn, limit: limit, wake: make(chan struct{}, 1)}
}

// Send queues a frame. Past the limit the receiver has fallen too far behind,
// so it is cut off, and it catches up after reconnecting (ADR 0021).
func (s *session) Send(frame []byte) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	if s.queued+len(frame) > s.limit {
		s.closed = true
		s.queue, s.queued = nil, 0
		// In the background: a close handshake would wait behind a stalled
		// write. It waits up to its own timeout, then drops the connection.
		go func() { _ = s.conn.Close(protocol.CloseSlowReceiver, "receiver too slow") }()
		return false
	}
	s.queue = append(s.queue, frame)
	s.queued += len(frame)
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return true
}

// pump writes queued frames until ctx ends or a write fails.
func (s *session) pump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		}
		for {
			s.mu.Lock()
			if len(s.queue) == 0 {
				s.mu.Unlock()
				break
			}
			frame := s.queue[0]
			s.queue = s.queue[1:]
			s.queued -= len(frame)
			s.mu.Unlock()
			if err := s.conn.Write(ctx, websocket.MessageText, frame); err != nil {
				s.stop()
				_ = s.conn.CloseNow()
				return
			}
		}
	}
}

func (s *session) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.queue, s.queued = nil, 0
}

// sendFirst puts a frame ahead of everything queued. It runs before the pump
// starts, so the frame is the first the peer gets after hub.ready.
func (s *session) sendFirst(frame []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.queue = append([][]byte{frame}, s.queue...)
	s.queued += len(frame)
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Replaced closes in the background: Close waits for the peer's answer, and
// the newer connection must not wait on the older one.
func (s *session) Replaced() {
	s.stop()
	go func() { _ = s.conn.Close(protocol.CloseReplaced, "replaced by a newer connection") }()
}

// Revoked drops whatever is still queued, which a revoked key must not get,
// and closes in the background like Replaced.
func (s *session) Revoked() {
	s.stop()
	go func() { _ = s.conn.Close(protocol.CloseRevoked, "key revoked") }()
}
