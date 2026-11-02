package httpadapter

import (
	"context"
	"testing"

	"hub/internal/app/relay/ports"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
)

type serviceStub struct{}

func (serviceStub) Identify(context.Context, []byte) (ports.Identity, bool, error) {
	return ports.Identity{}, false, nil
}
func (serviceStub) Connected(ports.Identity, ports.Session)      {}
func (serviceStub) Disconnected(ports.Identity, ports.Session)   {}
func (serviceStub) Online(string, string) bool                   { return false }
func (serviceStub) Route(ports.Identity, []byte) *protocol.Error { return nil }

func TestHandler_RegistersConnect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewHandler(serviceStub{}, Config{}).Register(r)
	if routes := r.Routes(); len(routes) != 1 || routes[0].Path != "/connect" || routes[0].Method != "GET" {
		t.Fatalf("routes %+v", routes)
	}
}
