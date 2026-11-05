package linking

import (
	"context"

	httpadapter "hub/internal/app/linking/adapters/inbound/http"
	"hub/internal/app/linking/adapters/outbound/postgres"
	"hub/internal/app/linking/application"
	"hub/internal/app/linking/ports"
	"hub/internal/shared/protocol"

	"gorm.io/gorm"
)

// Notifier is what this module needs from the live connections; the relay
// module answers it.
type Notifier = ports.Notifier

// NewHandlerFromDB is this module's composition root.
func NewHandlerFromDB(db *gorm.DB, notify Notifier) *httpadapter.Handler {
	return httpadapter.NewHandler(application.NewService(postgres.NewStore(db), notify))
}

// Certificates is this module's public capability for other features: the
// certificates of a Workspace, in the order they were made.
type Certificates interface {
	ForWorkspace(ctx context.Context, workspace string) ([]protocol.Certificate, error)
	// Revoked says whether a device.revoke certificate names this key.
	Revoked(ctx context.Context, publicKey []byte) (bool, error)
}

// NewCertificatesFromDB composes Certificates. Reading needs no Notifier.
func NewCertificatesFromDB(db *gorm.DB) Certificates {
	return application.NewService(postgres.NewStore(db), nil)
}
