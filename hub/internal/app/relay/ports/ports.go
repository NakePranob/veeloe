// Package ports declares what the relay application needs from outside it.
package ports

import "context"

// MachineKeys answers which Machine holds a public key. ok is false when no
// Machine does. The machine module answers it, through internal/composition.
type MachineKeys interface {
	MachineByKey(ctx context.Context, publicKey []byte) (machineID string, ok bool, err error)
}

// Session is one authenticated connection, as the application sees it.
type Session interface {
	// Replaced ends this session because a newer one took over its Machine.
	Replaced()
}

// PresenceRegistry remembers which session is live for each Machine. It lives
// in memory, which holds while one Hub serves a Workspace (ADR 0007, 0022).
type PresenceRegistry interface {
	// Put makes s the live session for the Machine and answers the one it
	// replaced, if any.
	Put(machineID string, s Session) (previous Session)
	// Remove forgets s, but only while s is still the live session: an old
	// connection closing must not take a newer one offline.
	Remove(machineID string, s Session)
	Online(machineID string) bool
}
