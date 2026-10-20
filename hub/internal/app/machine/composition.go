package machine

import (
	"context"
	"errors"

	httpadapter "hub/internal/app/machine/adapters/inbound/http"
	"hub/internal/app/machine/adapters/outbound/postgres"
	"hub/internal/app/machine/application"
	"hub/internal/app/machine/domain"
	"hub/internal/app/machine/ports"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// NewHandlerFromDB is this module's composition root. The process root owns
// the database handle; this package owns the feature's adapter graph.
func NewHandlerFromDB(db *gorm.DB) *httpadapter.Handler {
	repo := postgres.NewRepository(db)
	var service ports.Repository = repo
	return httpadapter.NewHandler(application.NewService(service))
}

// Lookup is this module's public capability for other features: which Machine
// a public key belongs to. ok is false when no Machine holds that key.
type Lookup interface {
	MachineByPublicKey(ctx context.Context, key []byte) (id uuid.UUID, ok bool, err error)
}

// NewLookupFromDB composes Lookup for internal/composition to adapt.
func NewLookupFromDB(db *gorm.DB) Lookup {
	return lookup{application.NewService(postgres.NewRepository(db))}
}

type lookup struct{ svc *application.Service }

func (l lookup) MachineByPublicKey(ctx context.Context, key []byte) (uuid.UUID, bool, error) {
	out, err := l.svc.FindByPublicKey(ctx, key)
	if errors.Is(err, domain.ErrNotFound) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	return out.ID, true, nil
}
