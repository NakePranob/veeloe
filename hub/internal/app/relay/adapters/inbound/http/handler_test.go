package httpadapter

import (
	"context"
	"testing"

	"hub/internal/app/relay/ports"

	"github.com/gin-gonic/gin"
)

type serviceStub struct{}

func (serviceStub) MachineByKey(context.Context, []byte) (string, bool, error) { return "", false, nil }
func (serviceStub) Connected(string, ports.Session)                            {}
func (serviceStub) Disconnected(string, ports.Session)                         {}
func (serviceStub) Online(string) bool                                         { return false }

func TestHandler_RegistersConnect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewHandler(serviceStub{}, Config{}).Register(r)
	if routes := r.Routes(); len(routes) != 1 || routes[0].Path != "/connect" || routes[0].Method != "GET" {
		t.Fatalf("routes %+v", routes)
	}
}
