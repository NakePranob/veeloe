// Package domain contains machine's business state and invariants. It does
// not import Gin, GORM, SQL drivers, or HTTP concerns.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Machine is the domain entity. Persistence and transport models are
// deliberately separate so a database column or JSON field cannot silently
// become part of the business API.
type Machine struct {
	ID        uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
	// WorkspaceID is the Workspace the Machine was paired into.
	WorkspaceID uuid.UUID
	// PublicKey is the Machine's Ed25519 public key: its identity at the Hub
	// (ADR 0013).
	PublicKey []byte
}
