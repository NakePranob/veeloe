// Package httpadapter is the Gin inbound adapter for relay.
package httpadapter

import (
	"errors"
	"net/http"

	"hub/internal/app/relay/application"
	"hub/internal/app/relay/domain"
	"hub/internal/shared/apperror"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc application.ServicePort
}

func NewHandler(svc application.ServicePort) *Handler {
	h := &Handler{svc: svc}
	return h
}

// Register wires the module's route group. Add endpoints with
// `go-scaffold generate method relay <name> --type ...`.
func (h *Handler) Register(rg gin.IRouter) {
	g := rg.Group("/relays")
	_ = g
	_ = appError
	// go-scaffold:handler-routes
}

func appError(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return apperror.New(http.StatusNotFound, "RELAY_NOT_FOUND", "relay not found")
	case errors.Is(err, domain.ErrConflict):
		return apperror.New(http.StatusConflict, "RELAY_CONFLICT", "relay already exists")
	case errors.Is(err, domain.ErrStaleVersion):
		return apperror.New(http.StatusConflict, "RELAY_STALE", "relay was modified by someone else — reload and try again")
	case errors.Is(err, domain.ErrHasReferences):
		return apperror.New(http.StatusConflict, "RELAY_HAS_REFERENCES", "relay still has related records")
	case errors.Is(err, domain.ErrNotImplemented):
		return apperror.New(http.StatusNotImplemented, "NOT_IMPLEMENTED", "not implemented")
	default:
		return apperror.NewInternal(err)
	}
}

// go-scaffold:handler-funcs
