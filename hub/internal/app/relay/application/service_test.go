package application

import (
	"testing"

	"hub/internal/app/relay/ports"
)

type fakeSession struct{ replaced bool }

func (f *fakeSession) Replaced() { f.replaced = true }

// presence is the registry's contract in its simplest form; the real one is
// in adapters/outbound/memory, which this layer may not import.
type presence map[string]ports.Session

func (p presence) Put(id string, s ports.Session) ports.Session {
	prev := p[id]
	p[id] = s
	return prev
}
func (p presence) Remove(id string, s ports.Session) {
	if p[id] == s {
		delete(p, id)
	}
}
func (p presence) Online(id string) bool { _, ok := p[id]; return ok }

func TestService_PresenceFollowsTheLiveSession(t *testing.T) {
	svc := NewService(nil, presence{})
	older, newer := &fakeSession{}, &fakeSession{}

	svc.Connected("m-1", older)
	if !svc.Online("m-1") {
		t.Fatal("online after connecting")
	}

	svc.Connected("m-1", newer)
	if !older.replaced || newer.replaced {
		t.Fatalf("the newer session replaces the older: older=%v newer=%v", older.replaced, newer.replaced)
	}

	svc.Disconnected("m-1", older)
	if !svc.Online("m-1") {
		t.Fatal("the older session closing must not take the Machine offline")
	}

	svc.Disconnected("m-1", newer)
	if svc.Online("m-1") {
		t.Fatal("offline once the live session closes")
	}
}
