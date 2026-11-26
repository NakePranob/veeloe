package domain

import "errors"

var (
	// ErrInvalid is a request one side did not really sign, or that has run out.
	ErrInvalid = errors.New("pairing request is not valid")
	// ErrMachineTaken is a Machine key that already belongs to another Workspace.
	ErrMachineTaken = errors.New("machine belongs to another workspace")
)
