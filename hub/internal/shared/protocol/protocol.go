// Package protocol is the Hub's half of the Veeloe Protocol: the envelope
// header it routes by and the handshake it authenticates with. The source of
// truth is packages/protocol; protocol_test.go checks this package against
// the JSON Schema and test vectors published there.
package protocol

import (
	"errors"
	"net/url"
	"strings"
)

// Header is what the Hub reads of an envelope (ADR 0005, 0007). The signed
// part travels on as an opaque string; only Runtimes and Controllers parse it.
type Header struct {
	V      int    `json:"v"`
	Type   string `json:"type"`
	From   string `json:"from"`
	To     string `json:"to"`
	Task   string `json:"task,omitempty"`
	Member string `json:"member,omitempty"`
	Signed string `json:"signed"`
	Sig    string `json:"sig"`
}

// Handshake frames (ADR 0013). Keys, signatures and nonces are base64url
// without padding.
type Challenge struct {
	Type  string `json:"type"` // "hub.challenge"
	V     int    `json:"v"`
	Nonce string `json:"nonce"`
}

type Auth struct {
	Type string `json:"type"` // "hub.auth"
	Key  string `json:"key"`
	Sig  string `json:"sig"`
}

type Ready struct {
	Type    string `json:"type"` // "hub.ready"
	Machine string `json:"machine"`
}

// Close codes the Hub ends a connection with.
const (
	CloseAuthFailed       = 4401
	CloseHandshakeTimeout = 4408
	CloseReplaced         = 4409
)

// NormalizeHubURL is the form of a Hub URL both sides sign: lower-case scheme
// and host, no default port, no path. It matches normalizeHubUrl in
// packages/protocol, which vectors/hub-urls.json pins.
func NormalizeHubURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "ws" && scheme != "wss" {
		return "", errors.New("hub URL must start with ws:// or wss://")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Host == "" {
		return "", errors.New("hub URL must be just scheme, host and port")
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (scheme == "ws" && port == "80") || (scheme == "wss" && port == "443") {
		port = ""
	}
	if port != "" {
		host += ":" + port
	}
	return scheme + "://" + host, nil
}

// HandshakeBytes is what a client signs to answer a challenge. hubURL must
// already be normalized; the nonce goes in as its base64url text.
func HandshakeBytes(hubURL, nonce string) []byte {
	return []byte("veeloe-hub-auth/1\n" + hubURL + "\n" + nonce)
}
