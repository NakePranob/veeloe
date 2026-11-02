package postgres

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"hub/internal/app/machine/domain"

	"github.com/google/uuid"
)

func testKey(b byte) []byte { return bytes.Repeat([]byte{b}, 32) }

func TestRepository_FindByPublicKey(t *testing.T) {
	repo := NewRepository(repositoryDBForTest(t))
	ctx := context.Background()
	item := &domain.Machine{ID: uuid.New(), Version: 1, WorkspaceID: uuid.New(), PublicKey: testKey(3)}
	if err := repo.Create(ctx, item); err != nil {
		t.Fatalf("create: %v", err)
	}

	found, err := repo.FindByPublicKey(ctx, item.PublicKey)
	if err != nil || found.ID != item.ID || found.WorkspaceID != item.WorkspaceID {
		t.Fatalf("known key: got %+v, %v", found, err)
	}
	if _, err := repo.FindByPublicKey(ctx, testKey(4)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown key: want ErrNotFound, got %v", err)
	}
}

// The schema, not the code, keeps a key owned by one Machine.
func TestRepository_PublicKeyIsUnique(t *testing.T) {
	repo := NewRepository(repositoryDBForTest(t))
	ctx := context.Background()
	if err := repo.Create(ctx, &domain.Machine{ID: uuid.New(), Version: 1, WorkspaceID: uuid.New(), PublicKey: testKey(5)}); err != nil {
		t.Fatalf("create: %v", err)
	}
	dup := &domain.Machine{ID: uuid.New(), Version: 1, WorkspaceID: uuid.New(), PublicKey: testKey(5)}
	if err := repo.Create(ctx, dup); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate key: want ErrConflict, got %v", err)
	}
}
