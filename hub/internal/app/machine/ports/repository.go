// Package ports declares the dependencies owned by the machine application.
// Adapters implement these interfaces; application code never imports a
// database driver.
package ports

import (
	"context"

	"hub/internal/app/machine/domain"
)

// Repository reads machine_svc.machines. Pairing writes its rows (ADR 0013);
// this module only answers who holds a key.
type Repository interface {
	// FindByPublicKey answers the Machine that holds this Ed25519 public key,
	// or domain.ErrNotFound.
	FindByPublicKey(context.Context, []byte) (*domain.Machine, error)
}
