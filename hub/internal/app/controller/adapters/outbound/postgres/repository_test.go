package postgres

import (
	"os"
	"testing"

	"hub/internal/app/controller/domain"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// repositoryDBForTest expects the test database schema to come from the same
// versioned SQL migrations used in production. Unit tests stay database-free;
// CI sets REQUIRE_TEST_DB=true so an unavailable or unmigrated database fails
// instead of becoming a false-green skip.
func repositoryDBForTest(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		if os.Getenv("REQUIRE_TEST_DB") == "true" {
			t.Fatal("TEST_DB_DSN is required when REQUIRE_TEST_DB=true")
		}
		t.Skip("repository integration test skipped: set TEST_DB_DSN to a migrated PostgreSQL database")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true})
	if err != nil {
		if os.Getenv("REQUIRE_TEST_DB") == "true" {
			t.Fatalf("open required test database: %v", err)
		}
		t.Skipf("repository integration test skipped: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get SQL database handle: %v", err)
	}
	if err := sqlDB.Ping(); err != nil {
		if os.Getenv("REQUIRE_TEST_DB") == "true" {
			t.Fatalf("ping required test database: %v", err)
		}
		t.Skipf("repository integration test skipped: %v", err)
	}

	tx := db.Begin()
	if tx.Error != nil {
		t.Fatalf("begin test transaction: %v", tx.Error)
	}
	t.Cleanup(func() {
		if err := tx.Rollback().Error; err != nil {
			t.Errorf("rollback test transaction: %v", err)
		}
	})
	return tx
}

// workspaceForTest adds the Workspace a row's foreign key needs; the test
// transaction takes it away again.
func workspaceForTest(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := db.Exec("INSERT INTO workspace_svc.workspaces (id) VALUES (?)", id).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	return id
}

// insertForTest writes a row the way Pairing does; this module only reads.
func insertForTest(t *testing.T, db *gorm.DB, c *domain.Controller) error {
	t.Helper()
	row := ControllerModel{ID: c.ID, Version: c.Version, WorkspaceID: c.WorkspaceID, MemberID: c.MemberID, PublicKey: c.PublicKey}
	return db.Create(&row).Error
}
