package relay

import (
	httpadapter "hub/internal/app/relay/adapters/inbound/http"
	"hub/internal/app/relay/adapters/outbound/memory"
	"hub/internal/app/relay/application"
	"hub/internal/app/relay/ports"

	"github.com/gin-gonic/gin"
)

// These are re-exported so the process root and internal/composition need only
// this package.
type (
	Config       = httpadapter.Config
	Identities   = ports.Identities
	Identity     = ports.Identity
	Certificates = ports.Certificates
)

const (
	KindMachine    = ports.KindMachine
	KindController = ports.KindController
)

// Relay is the WebSocket every Runtime and Controller connects to, and this
// module's public capability for other features: reaching those connections.
type Relay struct {
	handler *httpadapter.Handler
	svc     *application.Service
}

// New is this module's composition root. It owns no table; it gets identities
// and certificates from whoever the process root hands it.
func New(identities Identities, certificates Certificates, cfg Config) *Relay {
	svc := application.NewService(identities, certificates, memory.NewPresence())
	return &Relay{handler: httpadapter.NewHandler(svc, cfg), svc: svc}
}

func (r *Relay) Register(rg gin.IRouter) { r.handler.Register(rg) }

// Publish sends frame to every live session in the Workspace.
func (r *Relay) Publish(workspace string, frame []byte) { r.svc.Publish(workspace, frame) }

// Revoke closes the live sessions of these keys (base64url) with 4403.
func (r *Relay) Revoke(keys []string) { r.svc.Revoke(keys) }
