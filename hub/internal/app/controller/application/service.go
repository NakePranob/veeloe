package application

import "hub/internal/app/controller/ports"

// Service orchestrates controller use cases and depends only on ports.
type Service struct {
	repo ports.Repository
}

func NewService(repo ports.Repository) *Service {
	return &Service{repo: repo}
}
