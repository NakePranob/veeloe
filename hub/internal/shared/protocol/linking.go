package protocol

import (
	"encoding/base64"
	"encoding/json"
)

// LinkRequest is what a new device posts to /link-requests, as
// LinkRequestSchema in packages/protocol has it. The Hub cannot check Proof: it
// is an HMAC under the secret in the QR, which the Hub never sees. It checks
// the shape, and hands it to the live connection of To.
type LinkRequest struct {
	To    string `json:"to"`
	ID    string `json:"id"`
	Key   string `json:"key"`
	Name  string `json:"name"`
	Proof string `json:"proof"`
}

// Valid says whether r is shaped like a request: two keys, a 128-bit id, a
// 256-bit proof and a name of 1 to 80 UTF-16 units.
func (r LinkRequest) Valid() bool {
	_, toOK := DecodeKey(r.To)
	_, keyOK := DecodeKey(r.Key)
	n := utf16Len(r.Name)
	return toOK && keyOK && decodedLen(r.ID) == 16 && decodedLen(r.Proof) == 32 && n >= 1 && n <= 80
}

func decodedLen(text string) int {
	// The round trip refuses the line breaks the decoder skips, as DecodeKey does.
	raw, err := base64.RawURLEncoding.DecodeString(text)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != text {
		return -1
	}
	return len(raw)
}

// LinkRequestFrame is the hub.link_request frame the device that showed the QR
// gets: the request as posted, less To.
func LinkRequestFrame(r LinkRequest) []byte {
	frame, _ := json.Marshal(map[string]string{"type": "hub.link_request", "id": r.ID, "key": r.Key, "name": r.Name, "proof": r.Proof})
	return frame
}
