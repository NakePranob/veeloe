// Package memory keeps relay state in process memory.
package memory

import (
	"sync"

	"hub/internal/app/relay/ports"
)

var _ ports.PresenceRegistry = (*Presence)(nil)

type place struct{ workspace, id string }

type Presence struct {
	mu       sync.Mutex
	byKey    map[string]ports.Session
	machines map[place]ports.Session
	members  map[place]map[ports.Session]struct{}
	// The sessions of each Workspace, kept as they come and go, so answering one
	// Workspace does not walk every session on the Hub.
	byWorkspace map[string]map[ports.Session]struct{}
}

func NewPresence() *Presence {
	return &Presence{
		byKey:       map[string]ports.Session{},
		machines:    map[place]ports.Session{},
		members:     map[place]map[ports.Session]struct{}{},
		byWorkspace: map[string]map[ports.Session]struct{}{},
	}
}

// live keeps the per-Workspace index in step with the sessions that are in it.
func (p *Presence) live(workspace string, s ports.Session, on bool) {
	if p.byWorkspace[workspace] == nil {
		p.byWorkspace[workspace] = map[ports.Session]struct{}{}
	}
	if on {
		p.byWorkspace[workspace][s] = struct{}{}
		return
	}
	delete(p.byWorkspace[workspace], s)
	if len(p.byWorkspace[workspace]) == 0 {
		delete(p.byWorkspace, workspace)
	}
}

func (p *Presence) Put(who ports.Identity, s ports.Session) ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	previous := p.byKey[who.Key]
	if previous != nil {
		p.live(who.Workspace, previous, false)
	}
	p.byKey[who.Key] = s
	p.live(who.Workspace, s, true)
	at := place{who.Workspace, who.ID}
	if who.Kind == ports.KindMachine {
		p.machines[at] = s
		return previous
	}
	if previous != nil {
		delete(p.members[at], previous)
	}
	if p.members[at] == nil {
		p.members[at] = map[ports.Session]struct{}{}
	}
	p.members[at][s] = struct{}{}
	return previous
}

func (p *Presence) Remove(who ports.Identity, s ports.Session) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.byKey[who.Key] != s {
		return
	}
	delete(p.byKey, who.Key)
	p.live(who.Workspace, s, false)
	at := place{who.Workspace, who.ID}
	if who.Kind == ports.KindMachine {
		delete(p.machines, at)
		return
	}
	delete(p.members[at], s)
	if len(p.members[at]) == 0 {
		delete(p.members, at)
	}
}

func (p *Presence) Machine(workspace, id string) ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.machines[place{workspace, id}]
}

func (p *Presence) Key(key string) ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.byKey[key]
}

// Workspace answers only the sessions of that Workspace, from the index kept for it.
func (p *Presence) Workspace(workspace string) []ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	sessions := p.byWorkspace[workspace]
	live := make([]ports.Session, 0, len(sessions))
	for s := range sessions {
		live = append(live, s)
	}
	return live
}

func (p *Presence) Controllers(workspace, member string) []ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	live := make([]ports.Session, 0, len(p.members[place{workspace, member}]))
	for s := range p.members[place{workspace, member}] {
		live = append(live, s)
	}
	return live
}
