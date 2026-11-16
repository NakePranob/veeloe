// Package ports declares the dependencies owned by the controller application.
// Adapters implement these interfaces; application code never imports a
// database driver.
package ports

import (
	"context"

	"hub/internal/app/controller/domain"
)

// Repository reads controller_svc.controllers. Pairing and linking write its
// rows; this module only answers who holds a key.
type Repository interface {
	// FindByPublicKey answers the Controller that holds this Ed25519 public key,
	// or domain.ErrNotFound.
	FindByPublicKey(context.Context, []byte) (*domain.Controller, error)
}
