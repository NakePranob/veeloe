// Package postgres is the pairing outbound adapter. It owns
// workspace_svc.workspaces, and writes the first row of the Machine and the
// Controller tables, because a Pairing is the one write that spans all three.
package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"time"

	"hub/internal/app/pairing/domain"
	"hub/internal/app/pairing/ports"
	"hub/internal/shared/dberr"
	"hub/internal/shared/id"
	"hub/internal/shared/tx"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var _ ports.Registry = (*Registry)(nil)

type workspaceRow struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	CreatedAt time.Time
}

func (workspaceRow) TableName() string { return "workspace_svc.workspaces" }

type controllerRow struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	WorkspaceID uuid.UUID `gorm:"type:uuid"`
	MemberID    string
	PublicKey   []byte
}

func (controllerRow) TableName() string { return "controller_svc.controllers" }

type machineRow struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	WorkspaceID uuid.UUID `gorm:"type:uuid"`
	PublicKey   []byte
}

func (machineRow) TableName() string { return "machine_svc.machines" }

type Registry struct {
	db *gorm.DB
}

func NewRegistry(db *gorm.DB) *Registry {
	return &Registry{db: db}
}

// Register runs in one transaction, so a Machine another Workspace holds leaves
// no new Workspace behind. Two requests racing on a new key cannot both insert
// it: the loser fails on the unique key, and its second try finds the winner's
// rows and answers from them.
func (r *Registry) Register(ctx context.Context, machineKey, controllerKey []byte) (domain.Result, error) {
	result, err := r.register(ctx, machineKey, controllerKey)
	if err != nil && dberr.IsDuplicate(err) {
		result, err = r.register(ctx, machineKey, controllerKey)
	}
	return result, err
}

func (r *Registry) register(ctx context.Context, machineKey, controllerKey []byte) (domain.Result, error) {
	var result domain.Result
	err := tx.Do(ctx, r.db, func(ctx context.Context) error {
		db := tx.From(ctx, r.db).WithContext(ctx)

		var controller controllerRow
		err := db.Take(&controller, "public_key = ?", controllerKey).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			workspace := workspaceRow{ID: id.New()}
			if err := db.Create(&workspace).Error; err != nil {
				return err
			}
			controller = controllerRow{ID: id.New(), WorkspaceID: workspace.ID, MemberID: newMemberID(), PublicKey: controllerKey}
			err = db.Create(&controller).Error
		}
		if err != nil {
			return err
		}
		result.Workspace, result.Member = controller.WorkspaceID, controller.MemberID

		var machine machineRow
		err = db.Take(&machine, "public_key = ?", machineKey).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			machine = machineRow{ID: id.New(), WorkspaceID: controller.WorkspaceID, PublicKey: machineKey}
			err = db.Create(&machine).Error
		}
		if err != nil {
			return err
		}
		if machine.WorkspaceID != controller.WorkspaceID {
			return domain.ErrMachineTaken
		}
		result.Machine = machine.ID
		return nil
	})
	return result, err
}

// newMemberID is random, not derived from the key, so a Member keeps one id when
// a later Controller of theirs is linked (ADR 0013).
func newMemberID() string {
	return "m_" + strings.ToLower(rand.Text())
}
