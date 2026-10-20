package protocol

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

const published = "../../../../packages/protocol/"

func readJSON(t *testing.T, path string, v any) {
	t.Helper()
	data, err := os.ReadFile(published + path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, v); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}

// Header must have exactly the schema's properties, with matching JSON types,
// and treat exactly the schema's optional properties as omitempty.
func TestHeaderMatchesPublishedSchema(t *testing.T) {
	var schema struct {
		Properties map[string]struct {
			Type string `json:"type"`
		} `json:"properties"`
		Required []string `json:"required"`
	}
	readJSON(t, "schema/envelope-header.schema.json", &schema)

	jsonType := map[reflect.Kind]string{reflect.String: "string", reflect.Int: "number"}
	var fields, optional []string
	rt := reflect.TypeOf(Header{})
	for i := range rt.NumField() {
		f := rt.Field(i)
		name, opts, _ := strings.Cut(f.Tag.Get("json"), ",")
		fields = append(fields, name)
		if opts == "omitempty" {
			optional = append(optional, name)
		}
		prop, ok := schema.Properties[name]
		if !ok {
			t.Errorf("Header.%s (%q) is not in the published schema", f.Name, name)
			continue
		}
		if jsonType[f.Type.Kind()] != prop.Type {
			t.Errorf("Header.%s is %s in Go but %s in the schema", f.Name, f.Type.Kind(), prop.Type)
		}
	}
	var props []string
	for name := range schema.Properties {
		props = append(props, name)
	}
	sort.Strings(fields)
	sort.Strings(props)
	if !reflect.DeepEqual(fields, props) {
		t.Errorf("Header fields %v, schema properties %v", fields, props)
	}

	required := map[string]bool{}
	for _, name := range schema.Required {
		required[name] = true
	}
	for _, name := range optional {
		if required[name] {
			t.Errorf("%q is required in the schema but omitempty in Go", name)
		}
	}
	if len(optional)+len(schema.Required) != len(props) {
		t.Errorf("optional %v and required %v do not cover %v", optional, schema.Required, props)
	}
}

func b64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("base64url %q: %v", s, err)
	}
	return b
}

// The Hub only reads headers, but checking the signatures here as well proves
// Go sees the very bytes TypeScript signed — escapes, Thai text and all.
func TestEnvelopeVectors(t *testing.T) {
	var file struct {
		Vectors []struct {
			Name           string `json:"name"`
			Frame          string `json:"frame"`
			SignatureValid bool   `json:"signatureValid"`
		} `json:"vectors"`
	}
	readJSON(t, "vectors/envelopes.json", &file)
	if len(file.Vectors) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range file.Vectors {
		var h Header
		if err := json.Unmarshal([]byte(v.Frame), &h); err != nil {
			t.Errorf("%s: %v", v.Name, err)
			continue
		}
		if h.V != 1 || h.Type == "" || h.To == "" {
			t.Errorf("%s: header read as %+v", v.Name, h)
		}
		ok := ed25519.Verify(b64(t, h.From), []byte(h.Signed), b64(t, h.Sig))
		if ok != v.SignatureValid {
			t.Errorf("%s: signature valid = %v, want %v", v.Name, ok, v.SignatureValid)
		}
	}
}

func TestHandshakeVectors(t *testing.T) {
	var file struct {
		HubURL     string `json:"hubUrl"`
		Nonce      string `json:"nonce"`
		SignedText string `json:"signedText"`
		Vectors    []struct {
			Name  string `json:"name"`
			Frame string `json:"frame"`
			Valid bool   `json:"valid"`
		} `json:"vectors"`
	}
	readJSON(t, "vectors/handshakes.json", &file)
	hubURL, err := NormalizeHubURL(file.HubURL)
	if err != nil {
		t.Fatal(err)
	}
	signed := HandshakeBytes(hubURL, file.Nonce)
	if string(signed) != file.SignedText {
		t.Fatalf("handshake bytes %q, want %q", signed, file.SignedText)
	}
	for _, v := range file.Vectors {
		var a Auth
		if err := json.Unmarshal([]byte(v.Frame), &a); err != nil || a.Type != "hub.auth" {
			t.Errorf("%s: %+v, %v", v.Name, a, err)
			continue
		}
		if ok := ed25519.Verify(b64(t, a.Key), signed, b64(t, a.Sig)); ok != v.Valid {
			t.Errorf("%s: valid = %v, want %v", v.Name, ok, v.Valid)
		}
	}
}

func TestHubURLVectors(t *testing.T) {
	var file struct {
		Vectors []struct {
			Input      string `json:"input"`
			Normalized string `json:"normalized"`
			Error      bool   `json:"error"`
		} `json:"vectors"`
	}
	readJSON(t, "vectors/hub-urls.json", &file)
	for _, v := range file.Vectors {
		got, err := NormalizeHubURL(v.Input)
		if v.Error {
			if err == nil {
				t.Errorf("%q: want an error, got %q", v.Input, got)
			}
			continue
		}
		if err != nil || got != v.Normalized {
			t.Errorf("%q: got %q, %v; want %q", v.Input, got, err, v.Normalized)
		}
	}
}
