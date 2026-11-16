// Package ports declares what the relay application needs from outside it.
package ports

import (
	"context"

	"hub/internal/shared/protocol"
)

// Kind says which side of the Protocol a connection is.
type Kind string

const (
	KindMachine    Kind = "machine"
	KindController Kind = "controller"
)

// Identity is who a public key belongs to. ID is the Machine's id, or the
// Member's id for a Controller. Key is the public key as `from` carries it.
type Identity struct {
	Kind      Kind
	ID        string
	Workspace string
	Key       string
}

// Identities answers who holds a public key. ok is false when nobody does. The
// machine and controller modules answer it, through internal/composition.
type Identities interface {
	ByKey(ctx context.Context, publicKey []byte) (who Identity, ok bool, err error)
}

// Certificates answers the device.link and device.revoke certificates of a
// Workspace, in the order they were made. The linking module answers it.
type Certificates interface {
	ForWorkspace(ctx context.Context, workspace string) ([]protocol.Certificate, error)
	// Revoked says whether a device.revoke certificate names this key.
	Revoked(ctx context.Context, publicKey []byte) (bool, error)
}

// Session is one authenticated connection, as the application sees it.
type Session interface {
	// Replaced ends this session because a newer one took over its key.
	Replaced()
	// Revoked ends this session because its key was revoked.
	Revoked()
	// Send queues a frame and answers false when this session cannot take it,
	// which ends the session. It never blocks on the peer.
	Send(frame []byte) bool
}

// PresenceRegistry remembers the live session of each key. It lives in memory,
// which holds while one Hub serves a Workspace (ADR 0007, 0022).
type PresenceRegistry interface {
	// Put makes s the live session for who's key and answers the one it
	// replaced, if any.
	Put(who Identity, s Session) (previous Session)
	// Remove forgets s, but only while s is still the live session: an old
	// connection closing must not take a newer one offline.
	Remove(who Identity, s Session)
	// Machine answers the Machine's live session in that Workspace, or nil.
	Machine(workspace, id string) Session
	// Controllers answers the live sessions of the Member in that Workspace.
	Controllers(workspace, member string) []Session
	// Key answers the live session of a key (base64url), or nil.
	Key(key string) Session
	// Workspace answers every live session in that Workspace.
	Workspace(workspace string) []Session
}
