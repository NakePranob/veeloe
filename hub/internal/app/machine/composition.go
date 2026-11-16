package machine

import (
	"context"
	"errors"

	"hub/internal/app/machine/adapters/outbound/postgres"
	"hub/internal/app/machine/application"
	"hub/internal/app/machine/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Lookup is this module's public capability for other features: which Machine
// a public key belongs to, and its Workspace. ok is false when no Machine holds
// that key.
type Lookup interface {
	MachineByPublicKey(ctx context.Context, key []byte) (id uuid.UUID, workspace uuid.UUID, ok bool, err error)
}

// NewLookupFromDB composes Lookup for internal/composition to adapt.
func NewLookupFromDB(db *gorm.DB) Lookup {
	return lookup{application.NewService(postgres.NewRepository(db))}
}

type lookup struct{ svc *application.Service }

func (l lookup) MachineByPublicKey(ctx context.Context, key []byte) (uuid.UUID, uuid.UUID, bool, error) {
	out, err := l.svc.FindByPublicKey(ctx, key)
	if errors.Is(err, domain.ErrNotFound) {
		return uuid.Nil, uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, false, err
	}
	return out.ID, out.WorkspaceID, true, nil
}
