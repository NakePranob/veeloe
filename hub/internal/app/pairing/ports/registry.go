package ports

import (
	"context"

	"hub/internal/app/pairing/domain"
)

// Registry records a checked Pairing, all of it or none of it.
type Registry interface {
	Register(ctx context.Context, machineKey, controllerKey []byte) (domain.Result, error)
}
