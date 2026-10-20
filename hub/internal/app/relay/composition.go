package relay

import (
	httpadapter "hub/internal/app/relay/adapters/inbound/http"
	"hub/internal/app/relay/adapters/outbound/memory"
	"hub/internal/app/relay/application"
	"hub/internal/app/relay/ports"
)

// Config and MachineKeys are re-exported so the process root and
// internal/composition need only this package.
type (
	Config      = httpadapter.Config
	MachineKeys = ports.MachineKeys
)

// NewHandler is this module's composition root. It owns no table; it gets
// the Machines' keys from whoever the process root hands it.
func NewHandler(keys ports.MachineKeys, cfg Config) *httpadapter.Handler {
	return httpadapter.NewHandler(application.NewService(keys, memory.NewPresence()), cfg)
}
