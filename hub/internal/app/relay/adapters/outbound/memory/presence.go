// Package memory keeps relay state in process memory.
package memory

import (
	"sync"

	"hub/internal/app/relay/ports"
)

var _ ports.PresenceRegistry = (*Presence)(nil)

type Presence struct {
	mu     sync.Mutex
	online map[string]ports.Session
}

func NewPresence() *Presence {
	return &Presence{online: map[string]ports.Session{}}
}

func (p *Presence) Put(machineID string, s ports.Session) ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	previous := p.online[machineID]
	p.online[machineID] = s
	return previous
}

func (p *Presence) Remove(machineID string, s ports.Session) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.online[machineID] == s {
		delete(p.online, machineID)
	}
}

func (p *Presence) Online(machineID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, ok := p.online[machineID]
	return ok
}
