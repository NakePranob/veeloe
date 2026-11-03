package httpadapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hub/internal/app/pairing/domain"
	"hub/internal/shared/middleware"

	"github.com/gin-gonic/gin"
)

type never struct{ t *testing.T }

func (n never) Pair(context.Context, domain.Request) (domain.Result, error) {
	n.t.Fatal("a request that cannot be read must not reach the service")
	return domain.Result{}, nil
}

func TestPair_UnreadableBodyIsTheInvalidCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{"not json", `{"machine":"***"}`, `{"machine":"` + strings.Repeat("A", maxBodyBytes) + `"}`} {
		r := gin.New()
		r.Use(middleware.Error(false))
		NewHandler(never{t}).Register(r)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pairings", strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"hub.pairing_invalid"`) {
			t.Fatalf("body %.20q: %d %s", body, rec.Code, rec.Body.String())
		}
	}
}
