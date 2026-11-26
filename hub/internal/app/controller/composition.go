package controller

import (
	"context"
	"errors"

	"hub/internal/app/controller/adapters/outbound/postgres"
	"hub/internal/app/controller/application"
	"hub/internal/app/controller/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Lookup is this module's public capability for other features: which Controller
// a public key belongs to, and its Workspace. ok is false when no Controller holds
// that key.
type Lookup interface {
	ControllerByPublicKey(ctx context.Context, key []byte) (member string, workspace uuid.UUID, ok bool, err error)
}

// NewLookupFromDB composes Lookup for internal/composition to adapt.
func NewLookupFromDB(db *gorm.DB) Lookup {
	return lookup{application.NewService(postgres.NewRepository(db))}
}

type lookup struct{ svc *application.Service }

func (l lookup) ControllerByPublicKey(ctx context.Context, key []byte) (string, uuid.UUID, bool, error) {
	out, err := l.svc.FindByPublicKey(ctx, key)
	if errors.Is(err, domain.ErrNotFound) {
		return "", uuid.Nil, false, nil
	}
	if err != nil {
		return "", uuid.Nil, false, err
	}
	return out.MemberID, out.WorkspaceID, true, nil
}
