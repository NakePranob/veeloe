// Package postgres is the machine outbound adapter. Its GORM model is not
// exported as a domain type; conversion happens at this boundary.
package postgres

import (
	"time"

	"hub/internal/app/machine/domain"

	"github.com/google/uuid"
)

type MachineModel struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Version     int       `gorm:"not null;default:1"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null"`
	PublicKey   []byte    `gorm:"not null"`
}

func (MachineModel) TableName() string {
	return "machine_svc.machines"
}

func toDomain(m *MachineModel) *domain.Machine {
	if m == nil {
		return nil
	}
	return &domain.Machine{ID: m.ID, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, Version: m.Version, WorkspaceID: m.WorkspaceID, PublicKey: m.PublicKey}
}

func fromDomain(m *domain.Machine) *MachineModel {
	if m == nil {
		return nil
	}
	return &MachineModel{ID: m.ID, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, Version: m.Version, WorkspaceID: m.WorkspaceID, PublicKey: m.PublicKey}
}
