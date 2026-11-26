package pairing

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"hub/internal/shared/middleware"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const hubURL = "wss://hub.test"

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

func router(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Error(false))
	NewHandlerFromDB(db, hubURL).Register(r)
	return r
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

func request(machine, controller ed25519.PrivateKey, expires int64) map[string]any {
	return map[string]any{
		"machine":       text(public(machine)),
		"controller":    text(public(controller)),
		"expires":       expires,
		"machineSig":    text(ed25519.Sign(machine, protocol.PairingLinkBytes(hubURL, public(machine), expires))),
		"controllerSig": text(ed25519.Sign(controller, protocol.PairingRequestBytes(hubURL, public(machine), public(controller), expires))),
	}
}

type answer struct {
	Workspace string `json:"workspace"`
	Member    string `json:"member"`
	Machine   string `json:"machine"`
	Error     struct {
		Code string `json:"code"`
	} `json:"error"`
}

func post(t *testing.T, r *gin.Engine, body map[string]any) (int, answer) {
	t.Helper()
	raw, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pairings", bytes.NewReader(raw)))
	var got answer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("%d %s: %v", rec.Code, rec.Body.String(), err)
	}
	return rec.Code, got
}

func count(t *testing.T, db *gorm.DB, table string) int64 {
	t.Helper()
	var n int64
	if err := db.Table(table).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func soon() int64 { return time.Now().Add(10 * time.Minute).Unix() }

func TestFirstControllerGetsANewWorkspaceAndTheHubKnowsBothKeys(t *testing.T) {
	db := testDB(t)
	machine, controller := newKey(t), newKey(t)
	before := count(t, db, "workspace_svc.workspaces")

	status, got := post(t, router(db), request(machine, controller, soon()))
	if status != http.StatusOK || got.Workspace == "" || got.Machine == "" || len(got.Member) < 3 || got.Member[:2] != "m_" {
		t.Fatalf("%d %+v", status, got)
	}
	if after := count(t, db, "workspace_svc.workspaces"); after != before+1 {
		t.Fatalf("workspaces %d -> %d", before, after)
	}
	var workspace string
	db.Table("machine_svc.machines").Select("workspace_id").Where("public_key = ?", public(machine)).Scan(&workspace)
	if workspace != got.Workspace {
		t.Fatalf("machine in %q, answered %q", workspace, got.Workspace)
	}
	db.Table("controller_svc.controllers").Select("workspace_id").Where("public_key = ? AND member_id = ?", public(controller), got.Member).Scan(&workspace)
	if workspace != got.Workspace {
		t.Fatalf("controller in %q, answered %q", workspace, got.Workspace)
	}
}

func TestSecondMachineJoinsTheControllersWorkspace(t *testing.T) {
	db := testDB(t)
	r := router(db)
	controller := newKey(t)
	_, first := post(t, r, request(newKey(t), controller, soon()))
	before := count(t, db, "workspace_svc.workspaces")

	status, second := post(t, r, request(newKey(t), controller, soon()))
	if status != http.StatusOK || second.Workspace != first.Workspace || second.Member != first.Member || second.Machine == first.Machine {
		t.Fatalf("%d first %+v second %+v", status, first, second)
	}
	if after := count(t, db, "workspace_svc.workspaces"); after != before {
		t.Fatalf("a second Machine made a Workspace: %d -> %d", before, after)
	}
}

func TestTheSameRequestAgainAnswersTheSameAndWritesNothing(t *testing.T) {
	db := testDB(t)
	r := router(db)
	body := request(newKey(t), newKey(t), soon())
	_, first := post(t, r, body)
	machines := count(t, db, "machine_svc.machines")

	status, again := post(t, r, body)
	if status != http.StatusOK || again != first {
		t.Fatalf("%d first %+v again %+v", status, first, again)
	}
	if after := count(t, db, "machine_svc.machines"); after != machines {
		t.Fatalf("machines %d -> %d", machines, after)
	}
}

func TestRequestsThatDoNotCheckOutWriteNothing(t *testing.T) {
	db := testDB(t)
	r := router(db)
	machine, controller, stranger := newKey(t), newKey(t), newKey(t)
	exp := soon()
	expired := time.Now().Add(-3 * time.Minute).Unix()

	cases := map[string]map[string]any{
		"Machine did not consent": func() map[string]any {
			b := request(machine, controller, exp)
			b["machineSig"] = text(ed25519.Sign(stranger, protocol.PairingLinkBytes(hubURL, public(machine), exp)))
			return b
		}(),
		"Controller does not hold the key": func() map[string]any {
			b := request(machine, controller, exp)
			b["controllerSig"] = text(ed25519.Sign(stranger, protocol.PairingRequestBytes(hubURL, public(machine), public(controller), exp)))
			return b
		}(),
		"Controller signed for another Hub": func() map[string]any {
			b := request(machine, controller, exp)
			b["controllerSig"] = text(ed25519.Sign(controller, protocol.PairingRequestBytes("wss://other.test", public(machine), public(controller), exp)))
			return b
		}(),
		"expired":     request(machine, controller, expired),
		"short key":   {"machine": "AAAA", "controller": "AAAA", "expires": exp, "machineSig": "AAAA", "controllerSig": "AAAA"},
		"empty":       {},
		"longer life": func() map[string]any { b := request(machine, controller, exp); b["expires"] = exp + 1000; return b }(),
	}
	workspaces := count(t, db, "workspace_svc.workspaces")
	for name, body := range cases {
		status, got := post(t, r, body)
		if status != http.StatusBadRequest || got.Error.Code != "hub.pairing_invalid" {
			t.Errorf("%s: %d %+v", name, status, got)
		}
	}
	if after := count(t, db, "workspace_svc.workspaces"); after != workspaces {
		t.Fatalf("a refused request left Workspaces: %d -> %d", workspaces, after)
	}
}

func TestAMachineInAnotherWorkspaceIsTakenAndLeavesNoWorkspace(t *testing.T) {
	db := testDB(t)
	r := router(db)
	machine := newKey(t)
	_, owner := post(t, r, request(machine, newKey(t), soon()))
	workspaces, controllers := count(t, db, "workspace_svc.workspaces"), count(t, db, "controller_svc.controllers")

	status, got := post(t, r, request(machine, newKey(t), soon()))
	if status != http.StatusConflict || got.Error.Code != "hub.machine_taken" {
		t.Fatalf("%d %+v", status, got)
	}
	if w, c := count(t, db, "workspace_svc.workspaces"), count(t, db, "controller_svc.controllers"); w != workspaces || c != controllers {
		t.Fatalf("left behind: workspaces %d -> %d, controllers %d -> %d", workspaces, w, controllers, c)
	}
	var workspace string
	db.Table("machine_svc.machines").Select("workspace_id").Where("public_key = ?", public(machine)).Scan(&workspace)
	if workspace != owner.Workspace {
		t.Fatalf("machine moved to %q", workspace)
	}
}

// On real commits, because the race is between two transactions.
func TestTwoRequestsAtOnceBothGetTheOneAnswer(t *testing.T) {
	db := openDB(t)
	machine, controller := newKey(t), newKey(t)
	body := request(machine, controller, soon())
	r := router(db)

	var wg sync.WaitGroup
	answers := make([]answer, 8)
	for i := range answers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, _ := json.Marshal(body)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pairings", bytes.NewReader(raw)))
			if rec.Code != http.StatusOK {
				t.Errorf("request %s: %d %s", strconv.Itoa(i), rec.Code, rec.Body.String())
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &answers[i])
		}()
	}
	wg.Wait()
	t.Cleanup(func() {
		db.Exec("DELETE FROM machine_svc.machines WHERE workspace_id = ?", answers[0].Workspace)
		db.Exec("DELETE FROM controller_svc.controllers WHERE workspace_id = ?", answers[0].Workspace)
		db.Exec("DELETE FROM workspace_svc.workspaces WHERE id = ?", answers[0].Workspace)
	})
	for _, a := range answers {
		if a != answers[0] {
			t.Fatalf("%+v differs from %+v", a, answers[0])
		}
	}
}
