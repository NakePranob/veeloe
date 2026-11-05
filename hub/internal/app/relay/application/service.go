package application

import (
	"context"
	"encoding/json"

	"hub/internal/app/relay/ports"
	"hub/internal/shared/protocol"
)

// ServicePort is the inbound application port used by the WebSocket adapter.
type ServicePort interface {
	Identify(ctx context.Context, publicKey []byte) (ports.Identity, bool, error)
	// Revoked says whether a key nobody holds was revoked, so its device can
	// be told to wipe itself rather than wait to be linked.
	Revoked(ctx context.Context, publicKey []byte) (bool, error)
	Connected(who ports.Identity, s ports.Session)
	Disconnected(who ports.Identity, s ports.Session)
	Online(workspace, machineID string) bool
	// Certificates answers the hub.certificates frame a new session gets first,
	// or nil when its Workspace has none.
	Certificates(ctx context.Context, workspace string) ([]byte, error)
	Route(who ports.Identity, from ports.Session, frame []byte) *protocol.Error
	// go-scaffold:service-interface
}

var _ ServicePort = (*Service)(nil)

// Service decides who is online and where a frame goes. It owns no table:
// presence is in memory, and frames pass through (ADR 0005).
type Service struct {
	identities   ports.Identities
	certificates ports.Certificates
	presence     ports.PresenceRegistry
}

func NewService(identities ports.Identities, certificates ports.Certificates, presence ports.PresenceRegistry) *Service {
	return &Service{identities: identities, certificates: certificates, presence: presence}
}

func (s *Service) Identify(ctx context.Context, publicKey []byte) (ports.Identity, bool, error) {
	return s.identities.ByKey(ctx, publicKey)
}

func (s *Service) Revoked(ctx context.Context, publicKey []byte) (bool, error) {
	return s.certificates.Revoked(ctx, publicKey)
}

// Connected makes s the live session of who's key. A key has one live
// connection: the newer one wins and the older one is ended, which is what a
// client that reconnects past a half-open connection needs.
func (s *Service) Connected(who ports.Identity, sess ports.Session) {
	if previous := s.presence.Put(who, sess); previous != nil && previous != sess {
		previous.Replaced()
	}
}

// Disconnected removes s, unless a newer session took over its key.
func (s *Service) Disconnected(who ports.Identity, sess ports.Session) {
	s.presence.Remove(who, sess)
}

func (s *Service) Online(workspace, machineID string) bool {
	return s.presence.Machine(workspace, machineID) != nil
}

func (s *Service) Certificates(ctx context.Context, workspace string) ([]byte, error) {
	certs, err := s.certificates.ForWorkspace(ctx, workspace)
	if err != nil || len(certs) == 0 {
		return nil, err
	}
	return protocol.CertificatesFrame(certs), nil
}

// Publish sends frame to every live session in the Workspace.
func (s *Service) Publish(workspace string, frame []byte) {
	for _, sess := range s.presence.Workspace(workspace) {
		sess.Send(frame)
	}
}

// Revoke ends the live sessions of these keys as revoked. Their rows are gone
// already, so they cannot come back in.
func (s *Service) Revoke(keys []string) {
	for _, key := range keys {
		if sess := s.presence.Key(key); sess != nil {
			sess.Revoked()
		}
	}
}

// Route forwards one frame from who, exactly as it arrived, and answers what to
// tell the sender, if anything. It reads the header only (ADR 0005, 0019).
// Every lookup stays inside who's Workspace, and an unknown Machine answers as
// an offline one, so nobody can probe another Workspace.
func (s *Service) Route(who ports.Identity, from ports.Session, frame []byte) *protocol.Error {
	var h protocol.Header
	// A frame that is not an envelope, or has no single route, is skipped: a
	// newer client may send something this Hub does not know (ADR 0023).
	if err := json.Unmarshal(frame, &h); err != nil || !h.IsEnvelope() {
		return nil
	}
	route := h.Route()
	if route == protocol.RouteNone {
		return nil
	}
	if h.From != who.Key {
		return protocol.NewError(protocol.CodeSenderMismatch, h.Sig)
	}
	switch {
	case route == protocol.RouteTo && who.Kind == ports.KindController:
		machine := s.presence.Machine(who.Workspace, h.To)
		if machine == nil || !machine.Send(frame) {
			return protocol.NewError(protocol.CodeMachineOffline, h.Sig)
		}
	case route == protocol.RouteRecipients && who.Kind == ports.KindMachine:
		seen := make(map[string]bool, len(h.Recipients))
		for _, member := range h.Recipients {
			if seen[member] {
				continue
			}
			seen[member] = true
			// A Member who is not connected catches up by asking (ADR 0021).
			for _, controller := range s.presence.Controllers(who.Workspace, member) {
				controller.Send(frame)
			}
		}
	case route == protocol.RouteRecipients && onlyItself(h.Recipients, who.ID):
		// A Controller reaching its Member's other devices, as Linking does.
		for _, controller := range s.presence.Controllers(who.Workspace, who.ID) {
			if controller != from {
				controller.Send(frame)
			}
		}
	default:
		// Only a Runtime picks recipients, from the Grants it holds (ADR 0034).
		return protocol.NewError(protocol.CodeRouteNotAllowed, h.Sig)
	}
	return nil
}

func onlyItself(recipients []string, member string) bool {
	for _, r := range recipients {
		if r != member {
			return false
		}
	}
	return true
}

// go-scaffold:service-methods
