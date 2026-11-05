package application

import (
	"context"

	"hub/internal/app/linking/domain"
	"hub/internal/app/linking/ports"
	"hub/internal/shared/protocol"

	"github.com/google/uuid"
)

// ServicePort is the inbound application port used by the HTTP adapter.
type ServicePort interface {
	Link(ctx context.Context, c protocol.Certificate) error
	Revoke(ctx context.Context, c protocol.Certificate) error
	// go-scaffold:service-interface
}

var _ ServicePort = (*Service)(nil)

// Service registers and removes Controller keys on the strength of a
// certificate one of the Member's own Controllers signed (ADR 0013, 0031).
type Service struct {
	store  ports.Store
	notify ports.Notifier
}

func NewService(store ports.Store, notify ports.Notifier) *Service {
	return &Service{store: store, notify: notify}
}

// Link registers a new Controller of the signer's Member, then hands the
// certificate to everyone connected in the Workspace.
func (s *Service) Link(ctx context.Context, c protocol.Certificate) error {
	cert, ok := read(c, protocol.DeviceLink)
	if !ok {
		return domain.ErrLinkInvalid
	}
	created, err := s.store.Link(ctx, cert)
	if err != nil || !created {
		return err
	}
	s.notify.Publish(cert.Workspace.String(), protocol.CertificatesFrame([]protocol.Certificate{c}))
	return nil
}

// Revoke removes a Controller and what falls with it, cuts their live
// connections, then hands the certificate to everyone left in the Workspace.
// The rows go first, so a dropped key cannot get back in between.
func (s *Service) Revoke(ctx context.Context, c protocol.Certificate) error {
	cert, ok := read(c, protocol.DeviceRevoke)
	if !ok {
		return domain.ErrRevocationInvalid
	}
	dropped, err := s.store.Revoke(ctx, cert)
	if err != nil || dropped == nil {
		return err
	}
	s.notify.Revoke(dropped)
	s.notify.Publish(cert.Workspace.String(), protocol.CertificatesFrame([]protocol.Certificate{c}))
	return nil
}

// ForWorkspace answers the Workspace's certificates in the order they were
// made. A Workspace id that is not one has none.
func (s *Service) ForWorkspace(ctx context.Context, workspace string) ([]protocol.Certificate, error) {
	id, err := uuid.Parse(workspace)
	if err != nil {
		return nil, nil
	}
	return s.store.ForWorkspace(ctx, id)
}

// Revoked says whether a device.revoke certificate names this key.
func (s *Service) Revoked(ctx context.Context, key []byte) (bool, error) {
	return s.store.Revoked(ctx, key)
}

// read checks c's signature and shape, and that it is of the type wanted.
func read(c protocol.Certificate, want string) (domain.Certificate, bool) {
	got, ok := protocol.VerifyCertificate(c)
	if !ok || got.Type != want {
		return domain.Certificate{}, false
	}
	workspace, err := uuid.Parse(got.Workspace)
	key, keyOK := protocol.DecodeKey(got.Key)
	by, byOK := protocol.DecodeKey(got.By)
	if err != nil || !keyOK || !byOK {
		return domain.Certificate{}, false
	}
	return domain.Certificate{
		Type: got.Type, Workspace: workspace, Member: got.Member, Key: key, By: by,
		Keep: got.Keep, Signed: c.Signed, Sig: c.Sig,
	}, true
}

// go-scaffold:service-methods
