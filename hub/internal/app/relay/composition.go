package relay

import (
	httpadapter "hub/internal/app/relay/adapters/inbound/http"
	"hub/internal/app/relay/adapters/outbound/memory"
	"hub/internal/app/relay/application"
	"hub/internal/app/relay/ports"
)

// These are re-exported so the process root and internal/composition need only
// this package.
type (
	Config     = httpadapter.Config
	Identities = ports.Identities
	Identity   = ports.Identity
)

const (
	KindMachine    = ports.KindMachine
	KindController = ports.KindController
)

// NewHandler is this module's composition root. It owns no table; it gets
// identities from whoever the process root hands it.
func NewHandler(identities ports.Identities, cfg Config) *httpadapter.Handler {
	return httpadapter.NewHandler(application.NewService(identities, memory.NewPresence()), cfg)
}
