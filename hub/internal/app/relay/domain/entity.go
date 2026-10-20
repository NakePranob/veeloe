// Package domain contains relay's business state and invariants. It does
// not import Gin, GORM, SQL drivers, or HTTP concerns.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Relay is the domain entity. Persistence and transport models are
// deliberately separate so a database column or JSON field cannot silently
// become part of the business API.
type Relay struct {
	ID        uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
	// TODO: add business fields and invariants here.
}
