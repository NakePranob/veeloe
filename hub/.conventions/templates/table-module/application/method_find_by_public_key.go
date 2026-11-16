package application

import (
	"context"

	"hub/internal/app/machine/domain"
)

// FindByPublicKey answers the Machine that holds this public key, or
// domain.ErrNotFound. The relay uses it to tell who is connecting (ADR 0013).
func (s *Service) FindByPublicKey(ctx context.Context, key []byte) (*domain.Machine, error) {
	return s.repo.FindByPublicKey(ctx, key)
}
