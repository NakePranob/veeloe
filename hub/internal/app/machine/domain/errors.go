package domain

import "errors"

var (
	ErrNotFound       = errors.New("machine not found")
	ErrConflict       = errors.New("machine conflicts with an existing record")
	ErrStaleVersion   = errors.New("machine was modified by someone else")
	ErrHasReferences  = errors.New("machine still has related records")
	ErrNotImplemented = errors.New("machine operation is not implemented")
)
