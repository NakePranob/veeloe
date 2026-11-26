package httpadapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hub/internal/shared/middleware"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
)

type never struct{ t *testing.T }

func (n never) Link(context.Context, protocol.Certificate) error {
	n.t.Fatal("a body that cannot be read must not reach the service")
	return nil
}

func (n never) Revoke(ctx context.Context, c protocol.Certificate) error { return n.Link(ctx, c) }

func (n never) Request(ctx context.Context, _ protocol.LinkRequest) error {
	return n.Link(ctx, protocol.Certificate{})
}

func TestUnreadableBodyIsTheInvalidCodeOfItsRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Error(false))
	NewHandler(never{t}).Register(r)
	for path, code := range map[string]string{"/links": "hub.link_invalid", "/revocations": "hub.revocation_invalid", "/link-requests": "hub.link_request_invalid"} {
		for _, body := range []string{"not json", `{"signed":1,"name":1}`, `{"signed":"` + strings.Repeat("A", maxBodyBytes) + `"}`} {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"`+code+`"`) {
				t.Fatalf("%s %.20q: %d %s", path, body, rec.Code, rec.Body.String())
			}
		}
	}
}
