// Package httpadapter is the inbound adapter for relay: the WebSocket that
// Runtimes and Controllers connect to. WebSocket starts as an HTTP
// upgrade, so it lives here (ADR 0022).
package httpadapter

import (
	"time"

	"hub/internal/app/relay/application"
	"hub/internal/shared/middleware"

	"github.com/gin-gonic/gin"
)

// Config is what the connection needs from the process.
type Config struct {
	// PublicURL is this Hub's normalized public URL, bound into every
	// handshake signature.
	PublicURL         string
	HandshakeTimeout  time.Duration
	HeartbeatInterval time.Duration
	// MaxQueueBytes is how much unsent data one connection may hold. Zero means
	// the default.
	MaxQueueBytes int
}

type Handler struct {
	svc        application.ServicePort
	auth       middleware.KeyAuth
	heartbeat  time.Duration
	queueLimit int
}

func NewHandler(svc application.ServicePort, cfg Config) *Handler {
	limit := cfg.MaxQueueBytes
	if limit <= 0 {
		limit = defaultQueueLimit
	}
	return &Handler{
		svc:        svc,
		auth:       middleware.KeyAuth{PublicURL: cfg.PublicURL, Timeout: cfg.HandshakeTimeout},
		heartbeat:  cfg.HeartbeatInterval,
		queueLimit: limit,
	}
}

func (h *Handler) Register(rg gin.IRouter) {
	rg.GET("/connect", h.connect)
	// go-scaffold:handler-routes
}

// go-scaffold:handler-funcs
