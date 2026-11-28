package linking

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"hub/internal/shared/protocol"
)

func invitationID() string {
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return text(id)
}

func open(m member, id string, max int, by ed25519.PrivateKey) protocol.Certificate {
	return sign(map[string]any{"type": "invitation.open", "workspace": m.workspace, "member": m.id, "key": text(public(by)), "invitation": id, "max": max, "expires": time.Now().Add(time.Hour).UnixMilli()}, by)
}

func memberAdd(m member, id, newMember string, key, by ed25519.PrivateKey) protocol.Certificate {
	return sign(map[string]any{"type": "member.add", "workspace": m.workspace, "member": newMember, "key": text(public(key)), "name": "Kai", "invitation": id}, by)
}

// postJSON answers the status, the error code and the raw body.
func (h *hub) postJSON(path string, body any) (int, string, string) {
	h.t.Helper()
	raw, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	h.r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw)))
	var got struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	return rec.Code, got.Error.Code, rec.Body.String()
}

func (h *hub) add(c protocol.Certificate) (int, string) {
	status, code, _ := h.postJSON("/members", map[string]any{"certificate": c, "handoff": map[string]string{"data": `{"machines":[]}`, "proof": text(make([]byte, 32))}})
	return status, code
}

func ask(id string, key ed25519.PrivateKey) map[string]string {
	return map[string]string{"invitation": id, "key": text(public(key)), "name": "Kai", "proof": text(make([]byte, 32))}
}

func TestAnInvitationLetsInOnlyWhomItsOpenerSignsAndClosesWhenFull(t *testing.T) {
	h := newHub(t)
	m := h.member()
	id := invitationID()
	h.must("/invitations", open(m, id, 2, m.first))

	// Someone else in another Workspace cannot open it again, nor let anyone in through it.
	stranger := h.member()
	h.refused("/invitations", open(stranger, id, 2, stranger.first), http.StatusBadRequest, "hub.invitation_invalid")
	kai, lee, mo := newKey(t), newKey(t), newKey(t)
	if status, code := h.add(memberAdd(stranger, id, "m_kai", kai, stranger.first)); status != http.StatusBadRequest || code != "hub.invitation_invalid" {
		t.Fatalf("a stranger's member.add: %d %s", status, code)
	}

	// Asking waits until the opener lets the key in, then answers the hand-off.
	if _, _, body := h.postJSON("/invitation-requests", ask(id, kai)); !strings.Contains(body, `"waiting":true`) {
		t.Fatalf("asking: %s", body)
	}
	if status, code := h.add(memberAdd(m, id, "m_kai", kai, m.first)); status != http.StatusOK {
		t.Fatalf("let in: %d %s", status, code)
	}
	if _, _, body := h.postJSON("/invitation-requests", ask(id, kai)); !strings.Contains(body, `"handoff"`) {
		t.Fatalf("after: %s", body)
	}
	if got := h.registered(member{id: "m_kai"}); len(got) != 1 || got[0] != text(public(kai)) {
		t.Fatalf("registered %v", got)
	}
	if len(h.notes.published) != 1 || !strings.Contains(h.notes.published[0], "member.add") {
		t.Fatalf("published %v", h.notes.published)
	}

	// The same Member id twice is refused; the second seat is the last.
	if status, code := h.add(memberAdd(m, id, "m_kai", lee, m.first)); status != http.StatusConflict || code != "hub.key_taken" {
		t.Fatalf("same member id: %d %s", status, code)
	}
	if status, code := h.add(memberAdd(m, id, "m_lee", lee, m.first)); status != http.StatusOK {
		t.Fatalf("second: %d %s", status, code)
	}
	if status, code := h.add(memberAdd(m, id, "m_mo", mo, m.first)); status != http.StatusGone || code != "hub.invitation_closed" {
		t.Fatalf("full: %d %s", status, code)
	}
	if status, code, _ := h.postJSON("/invitation-requests", ask(id, mo)); status != http.StatusGone || code != "hub.invitation_closed" {
		t.Fatalf("asking a full one: %d %s", status, code)
	}
	// Whoever got in still picks up what was left for them.
	if _, _, body := h.postJSON("/invitation-requests", ask(id, lee)); !strings.Contains(body, `"handoff"`) {
		t.Fatalf("lee after full: %s", body)
	}
}

func TestAClosedInvitationTakesNoOne(t *testing.T) {
	h := newHub(t)
	m := h.member()
	id := invitationID()
	h.must("/invitations", open(m, id, 5, m.first))
	h.must("/invitations/close", sign(map[string]any{"type": "invitation.close", "workspace": m.workspace, "member": m.id, "key": text(public(m.first)), "invitation": id}, m.first))
	if status, code := h.add(memberAdd(m, id, "m_kai", newKey(t), m.first)); status != http.StatusGone || code != "hub.invitation_closed" {
		t.Fatalf("closed: %d %s", status, code)
	}
	if status, code, _ := h.postJSON("/invitation-requests", ask(invitationID(), newKey(t))); status != http.StatusGone || code != "hub.invitation_closed" {
		t.Fatalf("never opened: %d %s", status, code)
	}
}

func TestARevokedOpenerLetsNoOneIn(t *testing.T) {
	h := newHub(t)
	m := h.member()
	second := newKey(t)
	h.must("/links", link(m, second, m.first))
	id := invitationID()
	h.must("/invitations", open(m, id, 5, second))
	h.must("/revocations", revoke(m, second, m.first))
	if status, code := h.add(memberAdd(m, id, "m_kai", newKey(t), second)); status != http.StatusBadRequest || code != "hub.invitation_invalid" {
		t.Fatalf("revoked opener: %d %s", status, code)
	}
}

func TestOnlyAnOwnerRemovesAnInvitedMember(t *testing.T) {
	h := newHub(t)
	m := h.member()
	id := invitationID()
	h.must("/invitations", open(m, id, 2, m.first))
	kai, lee := newKey(t), newKey(t)
	if status, code := h.add(memberAdd(m, id, "m_kai", kai, m.first)); status != http.StatusOK {
		t.Fatalf("kai: %d %s", status, code)
	}
	if status, code := h.add(memberAdd(m, id, "m_lee", lee, m.first)); status != http.StatusOK {
		t.Fatalf("lee: %d %s", status, code)
	}
	remove := func(member string, by ed25519.PrivateKey, signer string) protocol.Certificate {
		return sign(map[string]any{"type": "member.remove", "workspace": m.workspace, "member": member, "key": text(public(by))}, by)
	}
	// An invited Member removes no one, and no one removes the Owner.
	h.refused("/member-removals", remove("m_lee", kai, "m_kai"), http.StatusBadRequest, "hub.member_remove_invalid")
	h.refused("/member-removals", remove(m.id, m.first, m.id), http.StatusBadRequest, "hub.member_remove_invalid")
	// The Owner removes Kai: their key goes and their connection is cut.
	h.must("/member-removals", remove("m_kai", m.first, m.id))
	if got := h.registered(member{id: "m_kai"}); len(got) != 0 {
		t.Fatalf("still registered %v", got)
	}
	if len(h.notes.revoked) != 1 || h.notes.revoked[0][0] != text(public(kai)) {
		t.Fatalf("revoked %v", h.notes.revoked)
	}
}
