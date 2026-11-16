package application

import (
	"context"
	"testing"

	"hub/internal/app/machine/domain"
)

// repositoryStub exposes one function per dependency operation; an unexpected
// call panics instead of silently returning a zero value.
type repositoryStub struct {
	findByKey func(context.Context, []byte) (*domain.Machine, error)
}

func (s *repositoryStub) FindByPublicKey(ctx context.Context, key []byte) (*domain.Machine, error) {
	if s.findByKey == nil {
		panic("unexpected repository.FindByPublicKey call")
	}
	return s.findByKey(ctx, key)
}

func TestService_ComposesWithRepositoryPort(t *testing.T) {
	if NewService(&repositoryStub{}) == nil {
		t.Fatal("expected service")
	}
}
