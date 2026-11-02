// Package postgres is the controller outbound adapter. Its GORM model is not
// exported as a domain type; conversion happens at this boundary.
package postgres

import (
	"time"

	"hub/internal/app/controller/domain"

	"github.com/google/uuid"
)

type ControllerModel struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Version     int       `gorm:"not null;default:1"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null"`
	MemberID    string    `gorm:"not null"`
	PublicKey   []byte    `gorm:"not null"`
}

func (ControllerModel) TableName() string {
	return "controller_svc.controllers"
}

func toDomain(m *ControllerModel) *domain.Controller {
	if m == nil {
		return nil
	}
	return &domain.Controller{ID: m.ID, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, Version: m.Version, WorkspaceID: m.WorkspaceID, MemberID: m.MemberID, PublicKey: m.PublicKey}
}

func fromDomain(m *domain.Controller) *ControllerModel {
	if m == nil {
		return nil
	}
	return &ControllerModel{ID: m.ID, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, Version: m.Version, WorkspaceID: m.WorkspaceID, MemberID: m.MemberID, PublicKey: m.PublicKey}
}
