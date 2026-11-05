package protocol

import (
	"encoding/json"
	"reflect"
	"testing"
)

// The Hub must accept exactly the certificates TypeScript does, and work out
// the same fallout of a revocation.
func TestCertificateVectors(t *testing.T) {
	var file struct {
		Vectors []struct {
			Name        string      `json:"name"`
			Certificate Certificate `json:"certificate"`
			Valid       bool        `json:"valid"`
		} `json:"vectors"`
		Fallout struct {
			Revoked string   `json:"revoked"`
			Links   []Link   `json:"links"`
			Keep    []string `json:"keep"`
			Drops   []string `json:"drops"`
		} `json:"fallout"`
	}
	readJSON(t, "vectors/certificates.json", &file)
	if len(file.Vectors) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range file.Vectors {
		if _, ok := VerifyCertificate(v.Certificate); ok != v.Valid {
			t.Errorf("%s: valid = %v, want %v", v.Name, ok, v.Valid)
		}
	}
	f := file.Fallout
	if got := RevokedWith(f.Revoked, f.Links, f.Keep); !reflect.DeepEqual(got, f.Drops) {
		t.Errorf("fallout %v, want %v", got, f.Drops)
	}
}

// A field spelled in another case is one every other side ignores, so the Hub
// must not read it either.
func TestCertificateReadsExactNames(t *testing.T) {
	var file struct {
		Vectors []struct {
			Certificate Certificate `json:"certificate"`
		} `json:"vectors"`
	}
	readJSON(t, "vectors/certificates.json", &file)
	got, ok := VerifyCertificate(file.Vectors[0].Certificate)
	if !ok || got.Type != DeviceLink || got.Name != "Chrome บน Mac" {
		t.Fatalf("%+v %v", got, ok)
	}
	var fields map[string]any
	_ = json.Unmarshal([]byte(file.Vectors[0].Certificate.Signed), &fields)
	fields["KEY"] = fields["key"]
	delete(fields, "key")
	signed, _ := json.Marshal(fields)
	if _, ok := VerifyCertificate(Certificate{Signed: string(signed), Sig: "x"}); ok {
		t.Fatal("read KEY as key")
	}
}
