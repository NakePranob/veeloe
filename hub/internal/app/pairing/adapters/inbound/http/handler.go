// Package httpadapter is the Gin inbound adapter for pairing.
package httpadapter

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"hub/internal/app/pairing/application"
	"hub/internal/app/pairing/domain"
	"hub/internal/shared/apperror"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
)

// maxBodyBytes is well over the two keys and two signatures a request carries.
const maxBodyBytes = 4 << 10

type Handler struct {
	svc application.ServicePort
}

func NewHandler(svc application.ServicePort) *Handler {
	h := &Handler{svc: svc}
	return h
}

// Register wires the module's route group.
func (h *Handler) Register(rg gin.IRouter) {
	rg.POST("/pairings", h.pair)
	// go-scaffold:handler-routes
}

// pair needs no account: both signatures are the whole of its authentication.
//
// ponytail: nothing limits how many Workspaces one sender creates. The quota at
// Pairing comes in v0.3 (ADR 0001); add a per-IP limit if one shows up before it.
func (h *Handler) pair(c *gin.Context) {
	req, ok := readRequest(c)
	if !ok {
		c.Error(appError(domain.ErrInvalid))
		return
	}
	result, err := h.svc.Pair(c.Request.Context(), req)
	if err != nil {
		c.Error(appError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"workspace": result.Workspace.String(), "member": result.Member, "machine": result.Machine.String()})
}

func readRequest(c *gin.Context) (domain.Request, bool) {
	var body struct {
		Machine       string `json:"machine"`
		Controller    string `json:"controller"`
		Expires       int64  `json:"expires"`
		MachineSig    string `json:"machineSig"`
		ControllerSig string `json:"controllerSig"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	if err := json.NewDecoder(c.Request.Body).Decode(&body); err != nil {
		return domain.Request{}, false
	}
	decode := base64.RawURLEncoding.DecodeString
	machine, err1 := decode(body.Machine)
	controller, err2 := decode(body.Controller)
	machineSig, err3 := decode(body.MachineSig)
	controllerSig, err4 := decode(body.ControllerSig)
	if err := errors.Join(err1, err2, err3, err4); err != nil {
		return domain.Request{}, false
	}
	return domain.Request{MachineKey: machine, ControllerKey: controller, Expires: body.Expires, MachineSig: machineSig, ControllerSig: controllerSig}, true
}

func appError(err error) error {
	switch {
	case errors.Is(err, domain.ErrInvalid):
		return apperror.New(http.StatusBadRequest, protocol.CodePairingInvalid, "pairing request is not valid")
	case errors.Is(err, domain.ErrMachineTaken):
		return apperror.New(http.StatusConflict, protocol.CodeMachineTaken, "machine belongs to another workspace")
	default:
		return apperror.NewInternal(err)
	}
}

// go-scaffold:handler-funcs
