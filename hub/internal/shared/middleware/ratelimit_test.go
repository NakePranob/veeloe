package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRateLimitRefusesPastTheMinute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RateLimit(2))
	r.POST("/pairings", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	call := func() int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/pairings", nil)
		req.RemoteAddr = "203.0.113.9:1234"
		r.ServeHTTP(w, req)
		return w.Code
	}

	if got := call(); got != http.StatusNoContent {
		t.Fatalf("first call answered %d, want 204", got)
	}
	if got := call(); got != http.StatusNoContent {
		t.Fatalf("second call answered %d, want 204", got)
	}
	if got := call(); got != http.StatusTooManyRequests {
		t.Fatalf("third call answered %d, want 429", got)
	}
}
