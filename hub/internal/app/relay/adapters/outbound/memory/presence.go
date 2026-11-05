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
}

func NewPresence() *Presence {
	return &Presence{
		byKey:    map[string]ports.Session{},
		machines: map[place]ports.Session{},
		members:  map[place]map[ports.Session]struct{}{},
	}
}

func (p *Presence) Put(who ports.Identity, s ports.Session) ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	previous := p.byKey[who.Key]
	p.byKey[who.Key] = s
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

// Workspace walks every live session.
//
// ponytail: O(all sessions) per call, and it runs once per certificate; index
// sessions by Workspace if one Hub ever holds enough of them to notice.
func (p *Presence) Workspace(workspace string) []ports.Session {
	p.mu.Lock()
	defer p.mu.Unlock()
	var live []ports.Session
	for at, s := range p.machines {
		if at.workspace == workspace {
			live = append(live, s)
		}
	}
	for at, sessions := range p.members {
		if at.workspace == workspace {
			for s := range sessions {
				live = append(live, s)
			}
		}
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
