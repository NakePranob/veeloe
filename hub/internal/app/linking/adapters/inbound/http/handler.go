// Package httpadapter is the Gin inbound adapter for linking.
package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"hub/internal/app/linking/application"
	"hub/internal/app/linking/domain"
	"hub/internal/shared/apperror"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
)

// maxBodyBytes is well over a certificate: `signed` is at most 4096 UTF-16
// units, which JSON escaping can grow to six bytes each.
const maxBodyBytes = 32 << 10

type Handler struct {
	svc application.ServicePort
}

func NewHandler(svc application.ServicePort) *Handler {
	h := &Handler{svc: svc}
	return h
}

// Register wires the module's routes. Neither needs an account: the
// certificate's signature, by a key the Hub already knows, is the whole of
// their authentication.
func (h *Handler) Register(rg gin.IRouter) {
	rg.POST("/links", h.serve(h.svc.Link, domain.ErrLinkInvalid))
	rg.POST("/revocations", h.serve(h.svc.Revoke, domain.ErrRevocationInvalid))
	// A new device's request, before the Hub knows its key: the HMAC inside is
	// checked by the device it goes to, not here.
	rg.POST("/link-requests", h.request)
	// go-scaffold:handler-routes
}

func (h *Handler) request(c *gin.Context) {
	var r protocol.LinkRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
	if err := json.NewDecoder(c.Request.Body).Decode(&r); err != nil {
		c.Error(appError(domain.ErrLinkRequestInvalid))
		return
	}
	if err := h.svc.Request(c.Request.Context(), r); err != nil {
		c.Error(appError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

// serve reads a certificate and hands it to use. A body that is not one is
// invalid the way use would call it.
func (h *Handler) serve(use func(context.Context, protocol.Certificate) error, invalid error) gin.HandlerFunc {
	return func(c *gin.Context) {
		var cert protocol.Certificate
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
		if err := json.NewDecoder(c.Request.Body).Decode(&cert); err != nil {
			c.Error(appError(invalid))
			return
		}
		if err := use(c.Request.Context(), cert); err != nil {
			c.Error(appError(err))
			return
		}
		c.JSON(http.StatusOK, gin.H{})
	}
}

func appError(err error) error {
	switch {
	case errors.Is(err, domain.ErrLinkInvalid):
		return apperror.New(http.StatusBadRequest, protocol.CodeLinkInvalid, "link certificate is not valid")
	case errors.Is(err, domain.ErrKeyTaken):
		return apperror.New(http.StatusConflict, protocol.CodeKeyTaken, "key is already a device or was revoked")
	case errors.Is(err, domain.ErrRevocationInvalid):
		return apperror.New(http.StatusBadRequest, protocol.CodeRevocationInvalid, "revocation certificate is not valid")
	case errors.Is(err, domain.ErrLastDevice):
		return apperror.New(http.StatusConflict, protocol.CodeLastDevice, "the member would have no device left")
	case errors.Is(err, domain.ErrLinkRequestInvalid):
		return apperror.New(http.StatusBadRequest, protocol.CodeLinkRequestInvalid, "link request is not valid")
	case errors.Is(err, domain.ErrDeviceOffline):
		return apperror.New(http.StatusNotFound, protocol.CodeDeviceOffline, "that device is not connected")
	default:
		return apperror.NewInternal(err)
	}
}

// go-scaffold:handler-funcs
