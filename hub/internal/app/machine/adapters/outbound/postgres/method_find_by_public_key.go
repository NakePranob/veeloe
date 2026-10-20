package postgres

import (
	"context"

	"hub/internal/app/machine/domain"
	"hub/internal/shared/tx"
)

func (r *Repository) FindByPublicKey(ctx context.Context, key []byte) (*domain.Machine, error) {
	var row MachineModel
	if err := tx.From(ctx, r.db).WithContext(ctx).First(&row, "public_key = ?", key).Error; err != nil {
		return nil, mapDatabaseError(err)
	}
	return toDomain(&row), nil
}
