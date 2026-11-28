// Package ports declares what the linking application needs from outside it.
package ports

import (
	"context"
	"time"

	"hub/internal/app/linking/domain"
	"hub/internal/shared/protocol"

	"github.com/google/uuid"
)

// Store records certificates and the Controller rows they change, each one
// whole or not at all.
type Store interface {
	// Link registers c.Key as a Controller of c.Member and keeps c. created is
	// false when this very certificate was already in.
	Link(ctx context.Context, c domain.Certificate) (created bool, err error)
	// Revoke removes c.Key and the keys that fall with it, keeps c, and answers
	// the keys removed as base64url. It answers none when c was already in.
	Revoke(ctx context.Context, c domain.Certificate) (dropped []string, err error)
	// ForWorkspace answers the Workspace's certificates in the order they were made.
	ForWorkspace(ctx context.Context, workspace uuid.UUID) ([]protocol.Certificate, error)
	// Revoked says whether a device.revoke certificate names this key.
	Revoked(ctx context.Context, key []byte) (bool, error)

	// Open keeps an Invitation c.By opened, when c.By is a Controller of
	// c.Member in that Workspace. The same Invitation again is done already.
	Open(ctx context.Context, c domain.Certificate, inv domain.Invitation) error
	// Close closes an Invitation, when c.By opened it.
	Close(ctx context.Context, c domain.Certificate, invitation []byte) error
	// Invitation answers one Invitation, and found false for one never opened.
	Invitation(ctx context.Context, id []byte) (inv domain.Invitation, found bool, err error)
	// Handoff answers what the inviter left for key, if anything yet.
	Handoff(ctx context.Context, invitation, key []byte) (domain.Handoff, bool, error)
	// AddMember registers c.Key as the first Controller of a new Member c.Member,
	// keeps c and handoff, and counts one more in the Invitation, all at once, while
	// it is open and c.By opened it. created is false for the same c again.
	AddMember(ctx context.Context, c domain.Certificate, invitation []byte, handoff domain.Handoff, now time.Time) (created bool, err error)
	// RemoveMember removes every Controller of c.Member and keeps c, when c.By
	// is an Owner's (a Member who came by Pairing, not by an Invitation) and
	// c.Member came by an Invitation. It answers the keys removed, none for the
	// same c again.
	RemoveMember(ctx context.Context, c domain.Certificate) (dropped []string, err error)
}

// Notifier reaches the live connections. The relay module answers it, through
// the process root.
type Notifier interface {
	// Publish sends frame to every live session in the Workspace.
	Publish(workspace string, frame []byte)
	// Revoke closes the live sessions of these keys (base64url) as revoked.
	Revoke(keys []string)
	// ToController sends frame to the live session of key (base64url) when
	// key is a Controller's, and answers whether it went.
	ToController(ctx context.Context, key string, frame []byte) bool
}
