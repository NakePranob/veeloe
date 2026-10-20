package application

import (
	"context"

	"hub/internal/app/relay/ports"
)

// ServicePort is the inbound application port used by the WebSocket adapter.
type ServicePort interface {
	MachineByKey(ctx context.Context, publicKey []byte) (machineID string, ok bool, err error)
	Connected(machineID string, s ports.Session)
	Disconnected(machineID string, s ports.Session)
	Online(machineID string) bool
	// go-scaffold:service-interface
}

var _ ServicePort = (*Service)(nil)

// Service decides who is online. It owns no table: presence is in memory.
type Service struct {
	keys     ports.MachineKeys
	presence ports.PresenceRegistry
}

func NewService(keys ports.MachineKeys, presence ports.PresenceRegistry) *Service {
	return &Service{keys: keys, presence: presence}
}

func (s *Service) MachineByKey(ctx context.Context, publicKey []byte) (string, bool, error) {
	return s.keys.MachineByKey(ctx, publicKey)
}

// Connected marks the Machine online on s. A Machine has one live connection:
// the newer one wins and the older one is ended, which is what a Runtime that
// reconnects past a half-open connection needs.
func (s *Service) Connected(machineID string, sess ports.Session) {
	if previous := s.presence.Put(machineID, sess); previous != nil && previous != sess {
		previous.Replaced()
	}
}

// Disconnected marks the Machine offline, unless a newer session took over.
func (s *Service) Disconnected(machineID string, sess ports.Session) {
	s.presence.Remove(machineID, sess)
}

func (s *Service) Online(machineID string) bool {
	return s.presence.Online(machineID)
}

// go-scaffold:service-methods
