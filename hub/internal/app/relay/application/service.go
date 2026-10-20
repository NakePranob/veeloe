package application

import (
	"context"

	"hub/internal/app/relay/domain"
)

// ServicePort is the inbound application port used by the HTTP adapter.
type ServicePort interface {
	// go-scaffold:service-interface
}

// Service orchestrates relay use cases and depends only on ports.
// Service has no repository: this module owns no table. Declare what it
// needs as an interface in ports/ and take it here when it is earned.
type Service struct{}

func NewService() *Service {
	return &Service{}
}

// Keep these imports visible until the first use case needs them.
var _ context.Context
var _ *domain.Relay

// go-scaffold:service-methods
