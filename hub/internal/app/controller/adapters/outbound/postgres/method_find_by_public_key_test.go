package postgres

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"hub/internal/app/controller/domain"

	"github.com/google/uuid"
)

func testKey(b byte) []byte { return bytes.Repeat([]byte{b}, 32) }

func TestRepository_FindByPublicKey(t *testing.T) {
	db := repositoryDBForTest(t)
	repo := NewRepository(db)
	workspace := workspaceForTest(t, db)
	ctx := context.Background()
	item := &domain.Controller{ID: uuid.New(), Version: 1, WorkspaceID: workspace, MemberID: "m-1", PublicKey: testKey(3)}
	if err := repo.Create(ctx, item); err != nil {
		t.Fatalf("create: %v", err)
	}

	found, err := repo.FindByPublicKey(ctx, item.PublicKey)
	if err != nil || found.ID != item.ID || found.WorkspaceID != item.WorkspaceID || found.MemberID != item.MemberID {
		t.Fatalf("known key: got %+v, %v", found, err)
	}
	if _, err := repo.FindByPublicKey(ctx, testKey(4)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown key: want ErrNotFound, got %v", err)
	}
}

// The schema, not the code, keeps a key owned by one Controller.
func TestRepository_PublicKeyIsUnique(t *testing.T) {
	db := repositoryDBForTest(t)
	repo := NewRepository(db)
	workspace := workspaceForTest(t, db)
	ctx := context.Background()
	if err := repo.Create(ctx, &domain.Controller{ID: uuid.New(), Version: 1, WorkspaceID: workspace, MemberID: "m-1", PublicKey: testKey(5)}); err != nil {
		t.Fatalf("create: %v", err)
	}
	dup := &domain.Controller{ID: uuid.New(), Version: 1, WorkspaceID: workspace, MemberID: "m-1", PublicKey: testKey(5)}
	if err := repo.Create(ctx, dup); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate key: want ErrConflict, got %v", err)
	}
}
