package application

import (
	"context"

	"hub/internal/app/machine/domain"
	"hub/internal/app/machine/ports"
)

// ServicePort is the inbound application port used by the HTTP adapter.
type ServicePort interface {
	// go-scaffold:service-interface
}

// Service orchestrates machine use cases and depends only on ports.
type Service struct {
	repo ports.Repository
}

func NewService(repo ports.Repository) *Service {
	return &Service{repo: repo}
}

// Keep these imports and the port visible in a lean module before its first
// method is generated. Methods are added to this file by `generate method`.
var _ context.Context
var _ *domain.Machine

// go-scaffold:service-methods
