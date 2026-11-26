package linking

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"hub/internal/shared/middleware"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var text = base64.RawURLEncoding.EncodeToString

func openDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		if os.Getenv("REQUIRE_TEST_DB") == "true" {
			t.Fatal("TEST_DB_DSN is required when REQUIRE_TEST_DB=true")
		}
		t.Skip("skipped: set TEST_DB_DSN to a migrated PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	return db
}

// A transaction that is rolled back, so tests leave nothing and count only their own rows.
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	tx := openDB(t).Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	return tx
}

// notes records what the Hub told the live connections.
type notes struct {
	published []string
	revoked   [][]string
}

func (n *notes) Publish(workspace string, frame []byte) {
	n.published = append(n.published, workspace+" "+string(frame))
}
func (n *notes) Revoke(keys []string)                              { n.revoked = append(n.revoked, keys) }
func (n *notes) ToController(context.Context, string, []byte) bool { return false }

type hub struct {
	t     *testing.T
	db    *gorm.DB
	r     *gin.Engine
	notes *notes
}

func newHub(t *testing.T) *hub {
	gin.SetMode(gin.TestMode)
	h := &hub{t: t, db: testDB(t), r: gin.New(), notes: &notes{}}
	h.r.Use(middleware.Error(false))
	NewHandlerFromDB(h.db, h.notes).Register(h.r)
	return h
}

func newKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func public(key ed25519.PrivateKey) []byte { return key.Public().(ed25519.PublicKey) }

// member is a Workspace with one Member whose first Controller came from a Pairing.
type member struct {
	workspace, id string
	first         ed25519.PrivateKey
}

func (h *hub) member() member {
	m := member{workspace: uuid.NewString(), id: "m_" + strings.ToLower(rand.Text()), first: newKey(h.t)}
	if err := h.db.Exec("INSERT INTO workspace_svc.workspaces (id) VALUES (?)", m.workspace).Error; err != nil {
		h.t.Fatal(err)
	}
	h.controller(m, m.first)
	return m
}

// controller registers key the way a Pairing does, with no certificate.
func (h *hub) controller(m member, key ed25519.PrivateKey) {
	if err := h.db.Exec("INSERT INTO controller_svc.controllers (id, workspace_id, member_id, public_key) VALUES (?, ?, ?, ?)",
		uuid.New(), m.workspace, m.id, public(key)).Error; err != nil {
		h.t.Fatal(err)
	}
}

func sign(fields map[string]any, by ed25519.PrivateKey) protocol.Certificate {
	fields["v"], fields["at"], fields["by"] = 1, 1800000000000, text(public(by))
	signed, _ := json.Marshal(fields)
	return protocol.Certificate{Signed: string(signed), Sig: text(ed25519.Sign(by, signed))}
}

func link(m member, key, by ed25519.PrivateKey) protocol.Certificate {
	return sign(map[string]any{"type": "device.link", "workspace": m.workspace, "member": m.id, "key": text(public(key)), "name": "Chrome"}, by)
}

func revoke(m member, key, by ed25519.PrivateKey, keep ...ed25519.PrivateKey) protocol.Certificate {
	kept := []string{}
	for _, k := range keep {
		kept = append(kept, text(public(k)))
	}
	return sign(map[string]any{"type": "device.revoke", "workspace": m.workspace, "member": m.id, "key": text(public(key)), "keep": kept}, by)
}

// post answers the status and the error code, if any.
func (h *hub) post(path string, c protocol.Certificate) (int, string) {
	h.t.Helper()
	raw, _ := json.Marshal(c)
	rec := httptest.NewRecorder()
	h.r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw)))
	var got struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		h.t.Fatalf("%d %s: %v", rec.Code, rec.Body.String(), err)
	}
	if rec.Code == http.StatusOK && rec.Body.String() != "{}" {
		h.t.Fatalf("answered %s", rec.Body.String())
	}
	return rec.Code, got.Error.Code
}

func (h *hub) must(path string, c protocol.Certificate) {
	h.t.Helper()
	if status, code := h.post(path, c); status != http.StatusOK {
		h.t.Fatalf("%s: %d %s", path, status, code)
	}
}

func (h *hub) refused(path string, c protocol.Certificate, status int, code string) {
	h.t.Helper()
	if s, got := h.post(path, c); s != status || got != code {
		h.t.Fatalf("%s: want %d %s, got %d %s", path, status, code, s, got)
	}
}

// registered answers the Member's Controller keys.
func (h *hub) registered(m member) []string {
	var keys [][]byte
	h.db.Table("controller_svc.controllers").Where("member_id = ?", m.id).Order("public_key").Pluck("public_key", &keys)
	out := []string{}
	for _, k := range keys {
		out = append(out, text(k))
	}
	return out
}

func (h *hub) rows() (controllers, certificates int64) {
	h.db.Table("controller_svc.controllers").Count(&controllers)
	h.db.Table("controller_svc.certificates").Count(&certificates)
	return controllers, certificates
}

func keysOf(keys ...ed25519.PrivateKey) []string {
	out := []string{}
	for _, k := range keys {
		out = append(out, text(public(k)))
	}
	for i := range out { // the order registered() reads them in: by the raw bytes
		for j := i + 1; j < len(out); j++ {
			a, _ := base64.RawURLEncoding.DecodeString(out[i])
			b, _ := base64.RawURLEncoding.DecodeString(out[j])
			if bytes.Compare(a, b) > 0 {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func TestLinkRegistersTheKeyAndHandsTheCertificateToTheWorkspace(t *testing.T) {
	h := newHub(t)
	m := h.member()
	phone := newKey(t)
	cert := link(m, phone, m.first)

	h.must("/links", cert)
	if got, want := h.registered(m), keysOf(m.first, phone); !reflect.DeepEqual(got, want) {
		t.Fatalf("registered %v, want %v", got, want)
	}
	if want := m.workspace + " " + string(protocol.CertificatesFrame([]protocol.Certificate{cert})); !reflect.DeepEqual(h.notes.published, []string{want}) {
		t.Fatalf("published %v", h.notes.published)
	}
	stored, err := NewCertificatesFromDB(h.db).ForWorkspace(t.Context(), m.workspace)
	if err != nil || !reflect.DeepEqual(stored, []protocol.Certificate{cert}) {
		t.Fatalf("stored %v, %v", stored, err)
	}
}

func TestTheSameLinkAgainAnswersTheSameAndChangesNothing(t *testing.T) {
	h := newHub(t)
	m := h.member()
	cert := link(m, newKey(t), m.first)
	h.must("/links", cert)
	controllers, certificates := h.rows()

	h.must("/links", cert)
	if c, k := h.rows(); c != controllers || k != certificates || len(h.notes.published) != 1 {
		t.Fatalf("controllers %d -> %d, certificates %d -> %d, published %d", controllers, c, certificates, k, len(h.notes.published))
	}
}

func TestALinkNotSignedByThatMembersControllerWritesNothing(t *testing.T) {
	h := newHub(t)
	m, other := h.member(), h.member()
	sibling := newKey(t) // another Member in m's Workspace
	h.controller(member{workspace: m.workspace, id: "m_sibling"}, sibling)
	phone, stranger := newKey(t), newKey(t)

	cases := map[string]protocol.Certificate{
		"signer not registered":        link(m, phone, stranger),
		"signer of another Member":     link(m, phone, sibling),
		"signer in another Workspace":  link(m, phone, other.first),
		"claims another Workspace":     link(member{workspace: other.workspace, id: m.id}, phone, m.first),
		"a revocation sent as a link":  revoke(m, phone, m.first),
		"signature by another key":     {Signed: link(m, phone, m.first).Signed, Sig: link(m, phone, stranger).Sig},
		"workspace that is not a uuid": link(member{workspace: "w-1", id: m.id}, phone, m.first),
	}
	controllers, certificates := h.rows()
	for name, cert := range cases {
		if status, code := h.post("/links", cert); status != http.StatusBadRequest || code != "hub.link_invalid" {
			t.Errorf("%s: %d %s", name, status, code)
		}
	}
	if c, k := h.rows(); c != controllers || k != certificates || len(h.notes.published) != 0 {
		t.Fatalf("controllers %d -> %d, certificates %d -> %d, published %v", controllers, c, certificates, k, h.notes.published)
	}
}

func TestAKeyThatIsAControllerOrWasRevokedIsTaken(t *testing.T) {
	h := newHub(t)
	m, other := h.member(), h.member()
	h.refused("/links", link(m, other.first, m.first), http.StatusConflict, "hub.key_taken")

	// Linked, then revoked: neither the same certificate nor a new one brings it back.
	phone := newKey(t)
	cert := link(m, phone, m.first)
	h.must("/links", cert)
	h.must("/revocations", revoke(m, phone, m.first))
	h.refused("/links", cert, http.StatusConflict, "hub.key_taken")
	h.refused("/links", link(m, phone, m.first), http.StatusConflict, "hub.key_taken")
	if got, want := h.registered(m), keysOf(m.first); !reflect.DeepEqual(got, want) {
		t.Fatalf("registered %v, want %v", got, want)
	}
}

func TestRevocationDropsWhatTheKeyLinkedExceptWhatIsKept(t *testing.T) {
	h := newHub(t)
	m := h.member()
	laptop, phone, tablet, watch := newKey(t), newKey(t), newKey(t), newKey(t)
	h.must("/links", link(m, laptop, m.first))
	h.must("/links", link(m, phone, laptop))
	h.must("/links", link(m, tablet, phone))
	h.must("/links", link(m, watch, m.first))

	cert := revoke(m, laptop, m.first, tablet)
	h.must("/revocations", cert)
	if want := [][]string{{text(public(laptop)), text(public(phone))}}; !reflect.DeepEqual(h.notes.revoked, want) {
		t.Fatalf("revoked %v, want %v", h.notes.revoked, want)
	}
	if got, want := h.registered(m), keysOf(m.first, tablet, watch); !reflect.DeepEqual(got, want) {
		t.Fatalf("registered %v, want %v", got, want)
	}
	if last := h.notes.published[len(h.notes.published)-1]; last != m.workspace+" "+string(protocol.CertificatesFrame([]protocol.Certificate{cert})) {
		t.Fatalf("published %s", last)
	}

	// The same revocation again answers the same and changes nothing.
	h.must("/revocations", cert)
	if len(h.notes.revoked) != 1 {
		t.Fatalf("revoked again: %v", h.notes.revoked)
	}
}

func TestARevocationThatLeavesNoDeviceIsRefused(t *testing.T) {
	h := newHub(t)
	m := h.member()
	h.refused("/revocations", revoke(m, m.first, m.first), http.StatusConflict, "hub.last_device")

	// The phone was linked by the first device, so it falls with it unless kept.
	phone := newKey(t)
	h.must("/links", link(m, phone, m.first))
	controllers, certificates := h.rows()
	h.refused("/revocations", revoke(m, m.first, phone), http.StatusConflict, "hub.last_device")
	if c, k := h.rows(); c != controllers || k != certificates || len(h.notes.revoked) != 0 {
		t.Fatalf("controllers %d -> %d, certificates %d -> %d, revoked %v", controllers, c, certificates, k, h.notes.revoked)
	}
	h.must("/revocations", revoke(m, m.first, phone, phone))
	if got, want := h.registered(m), keysOf(phone); !reflect.DeepEqual(got, want) {
		t.Fatalf("registered %v, want %v", got, want)
	}
}

func TestARevocationNotByThatMembersControllerChangesNothing(t *testing.T) {
	h := newHub(t)
	m, other := h.member(), h.member()
	phone := newKey(t)
	h.must("/links", link(m, phone, m.first))
	controllers, certificates := h.rows()

	cases := map[string]protocol.Certificate{
		"signer of another Member":  revoke(m, phone, other.first),
		"key of another Member":     revoke(m, other.first, m.first),
		"key that is not a device":  revoke(m, newKey(t), m.first),
		"a link sent as revocation": link(m, newKey(t), m.first),
	}
	for name, cert := range cases {
		if status, code := h.post("/revocations", cert); status != http.StatusBadRequest || code != "hub.revocation_invalid" {
			t.Errorf("%s: %d %s", name, status, code)
		}
	}
	if c, k := h.rows(); c != controllers || k != certificates || len(h.notes.revoked) != 0 {
		t.Fatalf("controllers %d -> %d, certificates %d -> %d, revoked %v", controllers, c, certificates, k, h.notes.revoked)
	}
}
