package domain

import "errors"

var (
	ErrNotFound       = errors.New("relay not found")
	ErrConflict       = errors.New("relay conflicts with an existing record")
	ErrStaleVersion   = errors.New("relay was modified by someone else")
	ErrHasReferences  = errors.New("relay still has related records")
	ErrNotImplemented = errors.New("relay operation is not implemented")
)
