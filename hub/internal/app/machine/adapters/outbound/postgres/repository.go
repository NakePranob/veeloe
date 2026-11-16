package postgres

import (
	"errors"

	"hub/internal/app/machine/domain"
	"hub/internal/app/machine/ports"

	"gorm.io/gorm"
)

var _ ports.Repository = (*Repository)(nil)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func mapDatabaseError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.ErrNotFound
	}
	return err
}
