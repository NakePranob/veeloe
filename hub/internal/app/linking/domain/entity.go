// Package domain contains linking's business state and invariants. It does
// not import Gin, GORM, SQL drivers, or HTTP concerns.
package domain

import (
	"slices"

	"github.com/google/uuid"
)

// Certificate is a device.link or device.revoke whose signature checked out,
// with the ids and keys the Hub stores it under. Signed and Sig are kept
// exactly as sent, since the signature is over those bytes.
type Certificate struct {
	Type      string
	Workspace uuid.UUID
	Member    string
	Key, By   []byte
	// Keep is the key texts a revocation leaves trusted.
	Keep        []string
	Signed, Sig string
}

// Drops is which of the Member's registered keys a revocation takes: its
// fallout, the keys every side works out it takes (protocol.RevokedWith),
// limited to keys still registered. A revocation that would leave none is
// refused.
func Drops(fallout, registered []string) ([]string, error) {
	var drops []string
	for _, key := range fallout {
		if slices.Contains(registered, key) {
			drops = append(drops, key)
		}
	}
	if len(drops) >= len(registered) {
		return nil, ErrLastDevice
	}
	return drops, nil
}
