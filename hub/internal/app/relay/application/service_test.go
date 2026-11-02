package application

import (
	"testing"

	"hub/internal/app/relay/ports"
)

type fakeSession struct{ replaced bool }

func (f *fakeSession) Replaced()        { f.replaced = true }
func (f *fakeSession) Send([]byte) bool { return true }

// presence is the registry's contract in its simplest form; the real one is
// in adapters/outbound/memory, which this layer may not import.
type presence map[string]ports.Session

func (p presence) Put(who ports.Identity, s ports.Session) ports.Session {
	prev := p[who.Key]
	p[who.Key] = s
	return prev
}
func (p presence) Remove(who ports.Identity, s ports.Session) {
	if p[who.Key] == s {
		delete(p, who.Key)
	}
}
func (p presence) Machine(_, id string) ports.Session         { return p[id] }
func (p presence) Controllers(string, string) []ports.Session { return nil }

func TestService_PresenceFollowsTheLiveSession(t *testing.T) {
	svc := NewService(nil, presence{})
	who := ports.Identity{Kind: ports.KindMachine, ID: "m-1", Workspace: "w-1", Key: "m-1"}
	older, newer := &fakeSession{}, &fakeSession{}

	svc.Connected(who, older)
	if !svc.Online("w-1", "m-1") {
		t.Fatal("online after connecting")
	}

	svc.Connected(who, newer)
	if !older.replaced || newer.replaced {
		t.Fatalf("the newer session replaces the older: older=%v newer=%v", older.replaced, newer.replaced)
	}

	svc.Disconnected(who, older)
	if !svc.Online("w-1", "m-1") {
		t.Fatal("the older session closing must not take the Machine offline")
	}

	svc.Disconnected(who, newer)
	if svc.Online("w-1", "m-1") {
		t.Fatal("offline once the live session closes")
	}
}
