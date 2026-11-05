package protocol

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"math"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Certificate is a key change one Controller signed apart from any envelope
// (ADR 0031): Ed25519 over the UTF-8 of Signed, by the key in its `by`.
type Certificate struct {
	Signed string `json:"signed"`
	Sig    string `json:"sig"`
}

// The certificate types.
const (
	DeviceLink   = "device.link"
	DeviceRevoke = "device.revoke"
)

// Certified is what a certificate says. Keys are base64url text, as signed.
type Certified struct {
	Type      string
	Workspace string
	Member    string
	Key       string
	By        string
	// Name is set on a device.link, Keep on a device.revoke.
	Name string
	Keep []string
}

// Certificates is the frame the Hub sends after hub.ready, and again with each
// new certificate, in the order they were made.
type Certificates struct {
	Type         string        `json:"type"` // "hub.certificates"
	Certificates []Certificate `json:"certificates"`
}

// CertificatesFrame is the hub.certificates frame carrying certs.
func CertificatesFrame(certs []Certificate) []byte {
	frame, _ := json.Marshal(Certificates{Type: "hub.certificates", Certificates: certs})
	return frame
}

// VerifyCertificate answers what c says when the key in its `by` really signed
// it, as verifyCertificate in packages/protocol does. Whether that key is one to
// believe is the caller's question. Fields are read by their exact names, so
// the Hub never reads a field every other side ignores (ADR 0023).
func VerifyCertificate(c Certificate) (Certified, bool) {
	var out Certified
	if c.Signed == "" || utf16Len(c.Signed) > 4096 || c.Sig == "" {
		return out, false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(c.Signed), &fields) != nil {
		return out, false
	}
	for name, field := range map[string]*string{"type": &out.Type, "workspace": &out.Workspace, "member": &out.Member, "key": &out.Key, "by": &out.By} {
		if json.Unmarshal(fields[name], field) != nil || *field == "" {
			return out, false
		}
	}
	var v, at float64
	if json.Unmarshal(fields["v"], &v) != nil || v != 1 ||
		json.Unmarshal(fields["at"], &at) != nil || at < 0 || at != math.Trunc(at) ||
		len(out.Key) > 64 || len(out.By) > 64 {
		return out, false
	}
	switch out.Type {
	case DeviceLink:
		if json.Unmarshal(fields["name"], &out.Name) != nil {
			return out, false
		}
		out.Name = strings.TrimFunc(out.Name, isJSSpace)
		if n := utf16Len(out.Name); n < 1 || n > 80 {
			return out, false
		}
	case DeviceRevoke:
		if json.Unmarshal(fields["keep"], &out.Keep) != nil || out.Keep == nil || len(out.Keep) > 100 {
			return out, false
		}
		for _, k := range out.Keep {
			if k == "" || len(k) > 64 {
				return out, false
			}
		}
	default:
		return out, false
	}
	by, ok := DecodeKey(out.By)
	sig, err := base64.RawURLEncoding.DecodeString(c.Sig)
	if !ok || err != nil || !ed25519.Verify(by, []byte(c.Signed), sig) {
		return out, false
	}
	return out, true
}

// DecodeKey reads a public key from its base64url text, and only from its one
// canonical spelling, so two texts never name the same key.
func DecodeKey(text string) (ed25519.PublicKey, bool) {
	key, err := base64.RawURLEncoding.DecodeString(text)
	if err != nil || len(key) != ed25519.PublicKeySize || base64.RawURLEncoding.EncodeToString(key) != text {
		return nil, false
	}
	return key, true
}

// Link is one device.link as the fallout of a revocation needs it.
type Link struct{ Key, By string }

// RevokedWith is every key that stops being trusted when revoked is: it, what
// it linked, and so on down, except the keys kept. It matches revokedWith in
// packages/protocol, which the Runtime and the Controller run too.
func RevokedWith(revoked string, links []Link, keep []string) []string {
	out := []string{revoked}
	for i := 0; i < len(out); i++ {
		for _, l := range links {
			if l.By == out[i] && !slices.Contains(keep, l.Key) && !slices.Contains(out, l.Key) {
				out = append(out, l.Key)
			}
		}
	}
	return out
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// isJSSpace is what String.prototype.trim strips: Unicode white space plus the
// byte order mark, which unicode.IsSpace leaves out.
func isJSSpace(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }
