package application

import (
	"context"

	"hub/internal/app/controller/domain"
)

// FindByPublicKey answers the Controller that holds this public key, or
// domain.ErrNotFound. The relay uses it to tell who is connecting (ADR 0013).
func (s *Service) FindByPublicKey(ctx context.Context, key []byte) (*domain.Controller, error) {
	return s.repo.FindByPublicKey(ctx, key)
}
