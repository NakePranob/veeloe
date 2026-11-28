package application

import (
	"context"
	"encoding/base64"
	"time"

	"hub/internal/app/linking/domain"
	"hub/internal/app/linking/ports"
	"hub/internal/shared/protocol"

	"github.com/google/uuid"
)

// ServicePort is the inbound application port used by the HTTP adapter.
type ServicePort interface {
	Link(ctx context.Context, c protocol.Certificate) error
	Revoke(ctx context.Context, c protocol.Certificate) error
	Request(ctx context.Context, r protocol.LinkRequest) error
	OpenInvitation(ctx context.Context, c protocol.Certificate) error
	CloseInvitation(ctx context.Context, c protocol.Certificate) error
	AskToJoin(ctx context.Context, r protocol.InvitationRequest) (*domain.Handoff, error)
	AddMember(ctx context.Context, c protocol.Certificate, handoff domain.Handoff) error
	// go-scaffold:service-interface
}

var _ ServicePort = (*Service)(nil)

// Service registers and removes Controller keys on the strength of a
// certificate one of the Member's own Controllers signed (ADR 0013, 0031).
type Service struct {
	store  ports.Store
	notify ports.Notifier
	now    func() time.Time
}

func NewService(store ports.Store, notify ports.Notifier) *Service {
	return &Service{store: store, notify: notify, now: time.Now}
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

// Request hands a new device's link request to the device showing the QR it
// read (ADR 0013). Nothing is kept: the request is good only while that device
// is connected and waiting, and only that device, holding the secret, can tell
// a real one from one the Hub made up. Registering the key still takes a
// device.link that device signs after its owner approves.
//
// ponytail: not rate-limited. Anyone who knows a Controller's public key can
// send it requests it discards; a per-IP limiter goes here if that is ever used
// to flood one.
func (s *Service) Request(ctx context.Context, r protocol.LinkRequest) error {
	if !r.Valid() {
		return domain.ErrLinkRequestInvalid
	}
	if !s.notify.ToController(ctx, r.To, protocol.LinkRequestFrame(r)) {
		return domain.ErrDeviceOffline
	}
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

// OpenInvitation keeps an Invitation a Controller of the Workspace signed open
// (ADR 0059), for up to a week.
func (s *Service) OpenInvitation(ctx context.Context, c protocol.Certificate) error {
	cert, got, ok := readFull(c, protocol.InvitationOpen)
	expires := time.UnixMilli(got.Expires)
	if !ok || got.Key != got.By || !expires.After(s.now()) || expires.After(s.now().Add(domain.MaxInvitationAge+time.Hour)) {
		return domain.ErrInvitationInvalid
	}
	id, _ := base64.RawURLEncoding.DecodeString(got.Invitation)
	return s.store.Open(ctx, cert, domain.Invitation{ID: id, Workspace: cert.Workspace, By: cert.By, Max: got.Max, Expires: expires})
}

// CloseInvitation closes an Invitation its own opener signed the close of.
func (s *Service) CloseInvitation(ctx context.Context, c protocol.Certificate) error {
	cert, got, ok := readFull(c, protocol.InvitationClose)
	if !ok {
		return domain.ErrInvitationInvalid
	}
	id, _ := base64.RawURLEncoding.DecodeString(got.Invitation)
	return s.store.Close(ctx, cert, id)
}

// AskToJoin answers someone who opened an Invitation: what the inviter left once
// they were let in, or nil while they wait, after handing the request to the
// inviter's live connection. Nothing of the request is kept: only the inviter,
// holding the secret, can tell a real one from one the Hub made up, and the
// asker posts again until let in.
//
// ponytail: not rate-limited, as /link-requests is not.
func (s *Service) AskToJoin(ctx context.Context, r protocol.InvitationRequest) (*domain.Handoff, error) {
	if !r.Valid() {
		return nil, domain.ErrInvitationInvalid
	}
	id, _ := base64.RawURLEncoding.DecodeString(r.Invitation)
	key, _ := protocol.DecodeKey(r.Key)
	inv, found, err := s.store.Invitation(ctx, id)
	if err != nil || !found {
		return nil, firstErr(err, domain.ErrInvitationClosed)
	}
	// Let in already: the hand-off stays theirs after the link closes.
	handoff, done, err := s.store.Handoff(ctx, id, key)
	if err != nil || done {
		return &handoff, err
	}
	if !inv.Open(s.now()) {
		return nil, domain.ErrInvitationClosed
	}
	s.notify.ToController(ctx, base64.RawURLEncoding.EncodeToString(inv.By), protocol.InvitationRequestFrame(r))
	return nil, nil
}

// AddMember registers a new Member's first Controller on the strength of a
// member.add its inviter signed, keeps what the inviter left for them, and
// hands the certificate to everyone in the Workspace, its Machines included.
func (s *Service) AddMember(ctx context.Context, c protocol.Certificate, handoff domain.Handoff) error {
	cert, got, ok := readFull(c, protocol.MemberAdd)
	if !ok || handoff.Data == "" || len(handoff.Data) > 100_000 || len(handoff.Proof) > 64 {
		return domain.ErrInvitationInvalid
	}
	id, _ := base64.RawURLEncoding.DecodeString(got.Invitation)
	created, err := s.store.AddMember(ctx, cert, id, handoff, s.now())
	if err != nil || !created {
		return err
	}
	s.notify.Publish(cert.Workspace.String(), protocol.CertificatesFrame([]protocol.Certificate{c}))
	return nil
}

func firstErr(err, otherwise error) error {
	if err != nil {
		return err
	}
	return otherwise
}

// read checks c's signature and shape, and that it is of the type wanted.
func read(c protocol.Certificate, want string) (domain.Certificate, bool) {
	cert, _, ok := readFull(c, want)
	return cert, ok
}

// readFull is read, with everything the certificate says.
func readFull(c protocol.Certificate, want string) (domain.Certificate, protocol.Certified, bool) {
	got, ok := protocol.VerifyCertificate(c)
	if !ok || got.Type != want {
		return domain.Certificate{}, got, false
	}
	workspace, err := uuid.Parse(got.Workspace)
	key, keyOK := protocol.DecodeKey(got.Key)
	by, byOK := protocol.DecodeKey(got.By)
	if err != nil || !keyOK || !byOK {
		return domain.Certificate{}, got, false
	}
	return domain.Certificate{
		Type: got.Type, Workspace: workspace, Member: got.Member, Key: key, By: by,
		Keep: got.Keep, Signed: c.Signed, Sig: c.Sig,
	}, got, true
}

// go-scaffold:service-methods
