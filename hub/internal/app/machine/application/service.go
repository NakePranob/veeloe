package application

import "hub/internal/app/machine/ports"

// Service orchestrates machine use cases and depends only on ports.
type Service struct {
	repo ports.Repository
}

func NewService(repo ports.Repository) *Service {
	return &Service{repo: repo}
}
