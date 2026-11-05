package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"hub/internal/shared/protocol"

	"github.com/coder/websocket"
)

var stored = []protocol.Certificate{{Signed: "first", Sig: "s1"}, {Signed: "second", Sig: "s2"}}

// heldCertificates answers w-1's certificates, and once armed, holds the next
// read until released, to let an envelope arrive in between.
type heldCertificates struct {
	armed   chan struct{}
	loading chan struct{}
	release chan struct{}
}

func (h heldCertificates) ForWorkspace(_ context.Context, workspace string) ([]protocol.Certificate, error) {
	select {
	case <-h.armed:
		h.loading <- struct{}{}
		<-h.release
	default:
	}
	if workspace != "w-1" {
		return nil, nil
	}
	return stored, nil
}

func (heldCertificates) Revoked(context.Context, []byte) (bool, error) { return false, nil }

func receiveCertificates(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	var got protocol.Certificates
	if data := receive(t, conn); json.Unmarshal(data, &got) != nil || got.Type != "hub.certificates" || len(got.Certificates) != 2 || got.Certificates[1] != stored[1] {
		t.Fatalf("want hub.certificates in order, got %s", data)
	}
}

// A Machine must learn of a revocation before it reads anything else, even an
// envelope routed to it while its certificates were still being read.
func TestConnect_CertificatesArriveBeforeTheFirstEnvelope(t *testing.T) {
	held := heldCertificates{armed: make(chan struct{}, 1), loading: make(chan struct{}), release: make(chan struct{})}
	url, _ := startHubWithCertificates(t, Config{HeartbeatInterval: time.Second}, held)
	controller, _ := connectAs(t, url, testController)
	receiveCertificates(t, controller)

	held.armed <- struct{}{}
	machine, _ := connectAs(t, url, testMachine)
	<-held.loading
	frame := envelope(testController, `"to":"machine-1"`, "early", "b")
	send(t, controller, frame)
	time.Sleep(100 * time.Millisecond) // let the Hub queue it
	close(held.release)

	receiveCertificates(t, machine)
	if got := receive(t, machine); !bytes.Equal(got, frame) {
		t.Fatalf("got %s", got)
	}
}

func TestConnect_NoCertificatesSendsNoFrame(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	expectNothing(t, machine)
}

func TestPublish_ReachesEveryLiveSessionInTheWorkspaceOnly(t *testing.T) {
	url, svc := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	controller, _ := connectAs(t, url, testController)
	theirs, _ := connectAs(t, url, otherController)
	frame := protocol.CertificatesFrame(stored[:1])
	svc.Publish("w-1", frame)
	for _, c := range []*websocket.Conn{machine, controller} {
		if got := receive(t, c); !bytes.Equal(got, frame) {
			t.Fatalf("got %s", got)
		}
	}
	expectNothing(t, theirs)
}

func TestRevoke_ClosesThatKeyWith4403AndNobodyElse(t *testing.T) {
	url, svc := startHub(t, time.Second)
	revoked, _ := connectAs(t, url, testController)
	kept, _ := connectAs(t, url, testController2)
	ended := keepReading(revoked)
	svc.Revoke([]string{keyText(testController), "not-connected"})
	select {
	case err := <-ended:
		if code := websocket.CloseStatus(err); code != protocol.CloseRevoked {
			t.Fatalf("want close %d, got %d (%v)", protocol.CloseRevoked, code, err)
		}
	case <-time.After(time.Second):
		t.Fatal("the revoked session stayed open")
	}
	send(t, kept, envelope(testController2, `"to":"machine-1"`, "still", "b"))
	receiveError(t, kept, protocol.CodeMachineOffline, "still")
}

// Linking hands a new device its Machines over the Member's own route.
func TestRoute_ControllerReachesItsOwnOtherDevicesNotItself(t *testing.T) {
	url, _ := startHub(t, time.Second)
	machine, _ := connectAs(t, url, testMachine)
	sender, _ := connectAs(t, url, testController)
	other, _ := connectAs(t, url, testController2)
	theirs, _ := connectAs(t, url, otherController) // also "member-1", in w-2

	frame := envelope(testController, `"recipients":["member-1","member-1"]`, "handoff", "b")
	send(t, sender, frame)
	if got := receive(t, other); !bytes.Equal(got, frame) {
		t.Fatalf("got %s", got)
	}
	expectNothing(t, other) // a repeated name delivers once
	expectNothing(t, sender)
	expectNothing(t, machine)
	expectNothing(t, theirs)
}

func TestRoute_ControllerNamingAnotherMemberIsRefused(t *testing.T) {
	url, _ := startHub(t, time.Second)
	sender, _ := connectAs(t, url, testController)
	other, _ := connectAs(t, url, testController2)
	send(t, sender, envelope(testController, `"recipients":["member-1","member-2"]`, "mixed", "b"))
	receiveError(t, sender, protocol.CodeRouteNotAllowed, "mixed")
	expectNothing(t, other)
}
