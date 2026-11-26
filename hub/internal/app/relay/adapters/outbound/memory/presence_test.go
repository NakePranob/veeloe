package memory

import (
	"testing"

	"hub/internal/app/relay/ports"
)

type fakeSession struct{ name string }

func (s fakeSession) Replaced()        {}
func (s fakeSession) Revoked()         {}
func (s fakeSession) Send([]byte) bool { return true }

func identity(workspace, id string, kind ports.Kind) ports.Identity {
	return ports.Identity{Workspace: workspace, ID: id, Kind: kind, Key: workspace + "/" + id}
}

// A Workspace answers with its own sessions only, and a session that leaves stops being answered.
func TestWorkspaceKeepsOnlyItsOwnLiveSessions(t *testing.T) {
	p := NewPresence()
	machineA := fakeSession{"machine-a"}
	memberA := fakeSession{"member-a"}
	other := fakeSession{"other"}

	p.Put(identity("w1", "m1", ports.KindMachine), machineA)
	p.Put(identity("w1", "u1", ports.KindController), memberA)
	p.Put(identity("w2", "m2", ports.KindMachine), other)

	if got := len(p.Workspace("w1")); got != 2 {
		t.Fatalf("w1 has %d sessions, want 2", got)
	}
	if got := len(p.Workspace("w2")); got != 1 {
		t.Fatalf("w2 has %d sessions, want 1", got)
	}

	p.Remove(identity("w1", "u1", ports.KindController), memberA)
	if got := len(p.Workspace("w1")); got != 1 {
		t.Fatalf("after the member left, w1 has %d sessions, want 1", got)
	}
	if got := len(p.Workspace("w3")); got != 0 {
		t.Fatalf("an unknown Workspace has %d sessions, want 0", got)
	}
}

// A key that reconnects replaces its old session without leaving either behind.
func TestReconnectKeepsOneSessionPerKey(t *testing.T) {
	p := NewPresence()
	first := fakeSession{"first"}
	second := fakeSession{"second"}
	p.Put(identity("w1", "u1", ports.KindController), first)
	p.Put(identity("w1", "u1", ports.KindController), second)
	if got := len(p.Workspace("w1")); got != 1 {
		t.Fatalf("w1 has %d sessions after a reconnect, want 1", got)
	}
}
