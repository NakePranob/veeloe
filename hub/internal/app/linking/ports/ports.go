// Package ports declares what the linking application needs from outside it.
package ports

import (
	"context"

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
