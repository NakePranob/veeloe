// Package httpadapter is the Gin inbound adapter for controller.
package httpadapter

import (
	"errors"
	"net/http"

	"hub/internal/app/controller/application"
	"hub/internal/app/controller/domain"
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
// `go-scaffold generate method controller <name> --type ...`.
func (h *Handler) Register(rg gin.IRouter) {
	g := rg.Group("/controllers")
	_ = g
	_ = appError
	// go-scaffold:handler-routes
}

func appError(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return apperror.New(http.StatusNotFound, "CONTROLLER_NOT_FOUND", "controller not found")
	case errors.Is(err, domain.ErrConflict):
		return apperror.New(http.StatusConflict, "CONTROLLER_CONFLICT", "controller already exists")
	case errors.Is(err, domain.ErrStaleVersion):
		return apperror.New(http.StatusConflict, "CONTROLLER_STALE", "controller was modified by someone else — reload and try again")
	case errors.Is(err, domain.ErrHasReferences):
		return apperror.New(http.StatusConflict, "CONTROLLER_HAS_REFERENCES", "controller still has related records")
	case errors.Is(err, domain.ErrNotImplemented):
		return apperror.New(http.StatusNotImplemented, "NOT_IMPLEMENTED", "not implemented")
	default:
		return apperror.NewInternal(err)
	}
}

// go-scaffold:handler-funcs
