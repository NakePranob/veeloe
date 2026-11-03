package application

import (
	"context"
	"crypto/ed25519"
	"time"

	"hub/internal/app/pairing/domain"
	"hub/internal/app/pairing/ports"
	"hub/internal/shared/protocol"
)

// clockSkew is how far the Machine's clock and the Hub's may disagree.
const clockSkew = 2 * time.Minute

// ServicePort is the inbound application port used by the HTTP adapter.
type ServicePort interface {
	Pair(ctx context.Context, req domain.Request) (domain.Result, error)
	// go-scaffold:service-interface
}

// Service orchestrates pairing use cases and depends only on ports.
type Service struct {
	registry ports.Registry
	hubURL   string
	now      func() time.Time
}

func NewService(registry ports.Registry, hubURL string) *Service {
	return &Service{registry: registry, hubURL: hubURL, now: time.Now}
}

// Pair registers the Machine in the Workspace of the Controller that signed for
// it, and a new Workspace when the Hub does not know that Controller yet.
func (s *Service) Pair(ctx context.Context, req domain.Request) (domain.Result, error) {
	if !s.signedByBoth(req) {
		return domain.Result{}, domain.ErrInvalid
	}
	return s.registry.Register(ctx, req.MachineKey, req.ControllerKey)
}

// signedByBoth says the Machine and the Controller both signed this request for
// this Hub, and the Machine's consent has not run out.
func (s *Service) signedByBoth(r domain.Request) bool {
	if len(r.MachineKey) != ed25519.PublicKeySize || len(r.ControllerKey) != ed25519.PublicKeySize {
		return false
	}
	if s.now().Add(-clockSkew).Unix() > r.Expires {
		return false
	}
	return ed25519.Verify(r.MachineKey, protocol.PairingLinkBytes(s.hubURL, r.MachineKey, r.Expires), r.MachineSig) &&
		ed25519.Verify(r.ControllerKey, protocol.PairingRequestBytes(s.hubURL, r.MachineKey, r.ControllerKey, r.Expires), r.ControllerSig)
}

// go-scaffold:service-methods
