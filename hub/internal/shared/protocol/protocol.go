// Package protocol is the Hub's half of the Veeloe Protocol: the envelope
// header it routes by and the handshake it authenticates with. The source of
// truth is packages/protocol; protocol_test.go checks this package against
// the JSON Schema and test vectors published there.
package protocol

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/netip"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
)

// Header is what the Hub reads of an envelope (ADR 0005, 0007). The signed
// part travels on as an opaque string; only Runtimes and Controllers parse it.
type Header struct {
	V          int      `json:"v"`
	Type       string   `json:"type"`
	From       string   `json:"from"`
	To         string   `json:"to,omitempty"`
	Recipients []string `json:"recipients,omitempty"`
	Task       string   `json:"task,omitempty"`
	Member     string   `json:"member,omitempty"`
	Signed     string   `json:"signed"`
	Sig        string   `json:"sig"`
}

// UnmarshalJSON reads each field by its exact name. encoding/json alone also
// takes `FROM` for `from`, so the Hub would route by a field every receiver
// ignores as unknown (ADR 0023).
func (h *Header) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for name, field := range map[string]any{
		"v": &h.V, "type": &h.Type, "from": &h.From, "to": &h.To, "recipients": &h.Recipients,
		"task": &h.Task, "member": &h.Member, "signed": &h.Signed, "sig": &h.Sig,
	} {
		if raw, ok := fields[name]; ok {
			if err := json.Unmarshal(raw, field); err != nil {
				return err
			}
		}
	}
	return nil
}

// IsEnvelope says whether the frame carries what an envelope must have to be
// routed. Hub frames and anything a newer client invents do not.
func (h Header) IsEnvelope() bool {
	return h.V == 1 && h.Type != "" && h.From != "" && h.Signed != "" && h.Sig != ""
}

// RouteKind is how a header says where it goes.
type RouteKind int

const (
	// RouteNone is a header naming both routes or neither, which cannot be routed.
	RouteNone RouteKind = iota
	RouteTo
	RouteRecipients
)

// Route answers which single route the header names. A present but empty
// recipient list still counts as present, as it does in packages/protocol.
func (h Header) Route() RouteKind {
	switch {
	case h.To != "" && h.Recipients == nil:
		return RouteTo
	case h.To == "" && len(h.Recipients) > 0:
		return RouteRecipients
	}
	return RouteNone
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
	Type string `json:"type"` // "hub.ready"
	// One of these: the Machine connected, or the Member who holds the Controller.
	Machine string `json:"machine,omitempty"`
	Member  string `json:"member,omitempty"`
}

// Error tells a sender what became of a frame (ADR 0065). It is not signed, so
// a client treats it as a hint about delivery and nothing more. Ref is the sig
// of the envelope it is about.
type Error struct {
	Type string `json:"type"` // "hub.error"
	Code string `json:"code"`
	Ref  string `json:"ref,omitempty"`
}

// NewError builds the frame for a code about the envelope signed with ref.
func NewError(code, ref string) *Error { return &Error{Type: "hub.error", Code: code, Ref: ref} }

// The codes a Hub answers with.
const (
	CodeMachineOffline  = "hub.machine_offline"
	CodeSenderMismatch  = "hub.sender_mismatch"
	CodeRouteNotAllowed = "hub.route_not_allowed"
	CodePairingInvalid  = "hub.pairing_invalid"
	CodeMachineTaken    = "hub.machine_taken"
)

// Close codes the Hub ends a connection with.
const (
	CloseAuthFailed       = 4401
	CloseHandshakeTimeout = 4408
	CloseReplaced         = 4409
	// A receiver fell too far behind and its queue overflowed.
	CloseSlowReceiver = 4429
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
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Hostname() == "" {
		return "", errors.New("hub URL must be just scheme, host and port")
	}
	host, err := normalizeHost(u.Hostname())
	if err != nil {
		return "", err
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port > 65535 {
			return "", errors.New("hub URL has an invalid port")
		}
		isDefault := (scheme == "ws" && port == 80) || (scheme == "wss" && port == 443)
		if !isDefault {
			host += ":" + strconv.Itoa(port)
		}
	}
	return scheme + "://" + host, nil
}

// normalizeHost writes a host as the WHATWG URL parser does, which is what a
// client's normalizeHubUrl sees: IPv6 compressed in brackets, a non-ASCII name
// in punycode.
//
// ponytail: an IPv4-mapped address, a zone and the odd IPv4 forms like 0x7f.1
// are not worth porting that parser. The first two refuse the boot; the last
// fails handshakes. Port the rest if a Hub ever needs them.
func normalizeHost(host string) (string, error) {
	if strings.Contains(host, ":") {
		addr, err := netip.ParseAddr(host)
		if err != nil || addr.Zone() != "" || addr.Is4In6() {
			return "", errors.New("hub URL has an IPv6 address it cannot sign")
		}
		return "[" + addr.String() + "]", nil
	}
	for _, r := range host {
		if r >= 0x80 {
			return idna.Lookup.ToASCII(host)
		}
	}
	return strings.ToLower(host), nil
}

// HandshakeBytes is what a client signs to answer a challenge. hubURL must
// already be normalized; the nonce goes in as its base64url text.
func HandshakeBytes(hubURL, nonce string) []byte {
	return []byte("veeloe-hub-auth/1\n" + hubURL + "\n" + nonce)
}

// PairingLinkBytes is what a Machine signs to consent to a Pairing. hubURL must
// already be normalized. It leaves out the secret in the link, which a Hub
// never sees.
func PairingLinkBytes(hubURL string, machineKey []byte, expires int64) []byte {
	return []byte("veeloe-pairing-link/1\n" + hubURL + "\n" + base64.RawURLEncoding.EncodeToString(machineKey) + "\n" + strconv.FormatInt(expires, 10))
}

// PairingRequestBytes is what a Controller signs to ask for the same Pairing.
func PairingRequestBytes(hubURL string, machineKey, controllerKey []byte, expires int64) []byte {
	return []byte("veeloe-pairing-request/1\n" + hubURL + "\n" + base64.RawURLEncoding.EncodeToString(machineKey) + "\n" + base64.RawURLEncoding.EncodeToString(controllerKey) + "\n" + strconv.FormatInt(expires, 10))
}
