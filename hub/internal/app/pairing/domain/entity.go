// Package domain contains pairing's business state and invariants. It does
// not import Gin, GORM, SQL drivers, or HTTP concerns.
package domain

import "github.com/google/uuid"

// Request is both sides' consent to a Pairing. The secret from the link is not
// in it: the Hub never sees that (ADR 0013).
type Request struct {
	MachineKey    []byte
	ControllerKey []byte
	// Expires is when the Machine's consent runs out, in Unix seconds.
	Expires       int64
	MachineSig    []byte
	ControllerSig []byte
}

// Result names where the Pairing put the two sides.
type Result struct {
	Workspace uuid.UUID
	Member    string
	Machine   uuid.UUID
}
