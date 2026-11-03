package pairing

import (
	httpadapter "hub/internal/app/pairing/adapters/inbound/http"
	"hub/internal/app/pairing/adapters/outbound/postgres"
	"hub/internal/app/pairing/application"

	"gorm.io/gorm"
)

// NewHandlerFromDB is this module's composition root. hubURL is this Hub's
// normalized public URL, which every Controller signature is bound to.
func NewHandlerFromDB(db *gorm.DB, hubURL string) *httpadapter.Handler {
	return httpadapter.NewHandler(application.NewService(postgres.NewRegistry(db), hubURL))
}
