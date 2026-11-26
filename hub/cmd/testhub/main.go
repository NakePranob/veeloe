// Command testhub runs the real relay with fixed test identities and no
// database, for the tests in e2e/. It is never deployed: the image builds
// cmd/api only.
//
// ponytail: the keys are TEST-ONLY public seeds; a full stack test with Postgres
// comes with machine-pairing, which is what writes real identities.
package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"hub/internal/app/relay"
	"hub/internal/shared/protocol"

	"github.com/gin-gonic/gin"
)

type identities map[string]relay.Identity

func (known identities) ByKey(_ context.Context, key []byte) (relay.Identity, bool, error) {
	who, ok := known[base64.RawURLEncoding.EncodeToString(key)]
	return who, ok, nil
}

// noCertificates is a Workspace nobody has linked or revoked a device in.
type noCertificates struct{}

func (noCertificates) ForWorkspace(context.Context, string) ([]protocol.Certificate, error) {
	return nil, nil
}

func (noCertificates) Revoked(context.Context, []byte) (bool, error) { return false, nil }

func keyOf(seed byte) string {
	public := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, 32)).Public().(ed25519.PublicKey)
	return base64.RawURLEncoding.EncodeToString(public)
}

func main() {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	machine, controller := keyOf(0x33), keyOf(0x44)
	known := identities{
		machine:    {Kind: relay.KindMachine, ID: "machine-1", Workspace: "w-1", Key: machine},
		controller: {Kind: relay.KindController, ID: "member-1", Workspace: "w-1", Key: controller},
	}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	url := "ws://" + listener.Addr().String()
	relay.New(known, noCertificates{}, relay.Config{PublicURL: url, HandshakeTimeout: 5 * time.Second, HeartbeatInterval: 5 * time.Second}).Register(r)
	fmt.Println(url) // the test reads this line to know where to connect
	server := &http.Server{Handler: r, ReadHeaderTimeout: 5 * time.Second}
	if err := server.Serve(listener); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
