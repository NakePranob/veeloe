package application

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"hub/internal/app/machine/domain"

	"github.com/google/uuid"
)

func TestService_FindByPublicKey(t *testing.T) {
	known := &domain.Machine{ID: uuid.New(), WorkspaceID: uuid.New(), PublicKey: bytes.Repeat([]byte{7}, 32)}
	svc := NewService(&repositoryStub{findByKey: func(_ context.Context, key []byte) (*domain.Machine, error) {
		if bytes.Equal(key, known.PublicKey) {
			return known, nil
		}
		return nil, domain.ErrNotFound
	}})

	got, err := svc.FindByPublicKey(context.Background(), known.PublicKey)
	if err != nil || got.ID != known.ID || got.WorkspaceID != known.WorkspaceID {
		t.Fatalf("known key: got %+v, %v", got, err)
	}
	if _, err := svc.FindByPublicKey(context.Background(), bytes.Repeat([]byte{8}, 32)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown key: want ErrNotFound, got %v", err)
	}
}
