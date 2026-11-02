package domain

import "errors"

var (
	ErrNotFound       = errors.New("controller not found")
	ErrConflict       = errors.New("controller conflicts with an existing record")
	ErrStaleVersion   = errors.New("controller was modified by someone else")
	ErrHasReferences  = errors.New("controller still has related records")
	ErrNotImplemented = errors.New("controller operation is not implemented")
)
