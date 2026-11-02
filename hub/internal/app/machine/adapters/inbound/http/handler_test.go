package httpadapter

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHandler_Register(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(nil)
	h.Register(r)
}
