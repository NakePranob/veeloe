package relay

import (
	httpadapter "hub/internal/app/relay/adapters/inbound/http"
	"hub/internal/app/relay/application"
)

// NewHandler is this module's composition root. The module owns no table, so
// the process root hands it no database handle.
func NewHandler() *httpadapter.Handler {
	return httpadapter.NewHandler(application.NewService())
}
