package protocol

import (
	"strings"
	"testing"
)

// The request packages/protocol builds is one the Hub forwards, and a changed
// shape is one it refuses.
func TestLinkRequestVectorIsValid(t *testing.T) {
	var file struct {
		Request LinkRequest `json:"request"`
	}
	readJSON(t, "vectors/linkings.json", &file)
	if !file.Request.Valid() {
		t.Fatalf("vector refused: %+v", file.Request)
	}
	for name, change := range map[string]func(*LinkRequest){
		"no name":        func(r *LinkRequest) { r.Name = "" },
		"a long name":    func(r *LinkRequest) { r.Name = strings.Repeat("ก", 81) },
		"a short id":     func(r *LinkRequest) { r.ID = r.ID[:10] },
		"a padded proof": func(r *LinkRequest) { r.Proof += "=" },
		"a short key":    func(r *LinkRequest) { r.Key = r.Key[:20] },
	} {
		r := file.Request
		change(&r)
		if r.Valid() {
			t.Fatalf("%s: valid", name)
		}
	}
}
