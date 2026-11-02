package application

import (
	"context"
	"testing"

	"hub/internal/app/machine/domain"
	"hub/internal/app/machine/ports"

	"github.com/google/uuid"
)

// repositoryStub exposes one function per dependency operation. Focused
// application tests can configure only the calls they expect; an unexpected
// call panics instead of silently returning a zero value that hides broken
// orchestration.
type repositoryStub struct {
	createFn   func(context.Context, *domain.Machine) error
	findAllFn  func(context.Context, ports.ListFilter) ([]domain.Machine, int64, error)
	findByIDFn func(context.Context, uuid.UUID) (*domain.Machine, error)
	updateFn   func(context.Context, *domain.Machine) error
	deleteFn   func(context.Context, uuid.UUID) error
	findByKey  func(context.Context, []byte) (*domain.Machine, error)
	// go-scaffold:repository-stub-fields
}

func (s *repositoryStub) Create(ctx context.Context, m *domain.Machine) error {
	if s.createFn == nil {
		panic("unexpected repository.Create call")
	}
	return s.createFn(ctx, m)
}
func (s *repositoryStub) FindAll(ctx context.Context, filter ports.ListFilter) ([]domain.Machine, int64, error) {
	if s.findAllFn == nil {
		panic("unexpected repository.FindAll call")
	}
	return s.findAllFn(ctx, filter)
}
func (s *repositoryStub) FindByID(ctx context.Context, id uuid.UUID) (*domain.Machine, error) {
	if s.findByIDFn == nil {
		panic("unexpected repository.FindByID call")
	}
	return s.findByIDFn(ctx, id)
}
func (s *repositoryStub) Update(ctx context.Context, m *domain.Machine) error {
	if s.updateFn == nil {
		panic("unexpected repository.Update call")
	}
	return s.updateFn(ctx, m)
}
func (s *repositoryStub) Delete(ctx context.Context, id uuid.UUID) error {
	if s.deleteFn == nil {
		panic("unexpected repository.Delete call")
	}
	return s.deleteFn(ctx, id)
}

func TestService_ComposesWithRepositoryPort(t *testing.T) {
	if NewService(&repositoryStub{}) == nil {
		t.Fatal("expected service")
	}
}

func (s *repositoryStub) FindByPublicKey(ctx context.Context, key []byte) (*domain.Machine, error) {
	if s.findByKey == nil {
		panic("unexpected repository.FindByPublicKey call")
	}
	return s.findByKey(ctx, key)
}

// go-scaffold:repository-stub-methods
