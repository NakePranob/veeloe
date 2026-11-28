package domain

import (
	"time"

	"github.com/google/uuid"
)

// Invitation is a link a Controller opened for up to Max people until Expires
// (ADR 0059). The Hub counts and closes it; the inviter vouches for each key.
type Invitation struct {
	ID        []byte
	Workspace uuid.UUID
	By        []byte
	Max       int
	Joined    int
	Expires   time.Time
	Closed    bool
}

// Open says whether it still takes someone at now.
func (i Invitation) Open(now time.Time) bool {
	return !i.Closed && now.Before(i.Expires) && i.Joined < i.Max
}

// Handoff is what the inviter left for one person let in: HandoffData as JSON,
// and its HMAC under the link's secret, which the new device checks.
type Handoff struct {
	Data  string `json:"data"`
	Proof string `json:"proof"`
}

// MaxInvitationAge is the longest an Invitation may stay open.
const MaxInvitationAge = 7 * 24 * time.Hour
