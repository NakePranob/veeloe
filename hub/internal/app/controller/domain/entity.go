// Package domain contains controller's business state and invariants. It does
// not import Gin, GORM, SQL drivers, or HTTP concerns.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Controller is the domain entity. Persistence and transport models are
// deliberately separate so a database column or JSON field cannot silently
// become part of the business API.
type Controller struct {
	ID        uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
	// WorkspaceID is the Workspace the Controller was paired into.
	WorkspaceID uuid.UUID
	// MemberID is the Member who holds this Controller. Recipient lists name
	// Members by it (ADR 0034).
	MemberID string
	// PublicKey is the Controller's Ed25519 public key: its identity at the Hub
	// (ADR 0013).
	PublicKey []byte
}
