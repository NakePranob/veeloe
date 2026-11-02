package application

import (
	"time"

	"hub/internal/app/controller/domain"

	"github.com/google/uuid"
)

// A lean module starts with no use-case input type. `generate method` adds
// the exact input beside the endpoint that needs it.
// Response is a transport-neutral application output. The inbound adapter
// maps it to its protocol response before serialization.
type Response struct {
	ID          uuid.UUID
	CreatedAt   time.Time
	Version     int
	WorkspaceID uuid.UUID
	MemberID    string
}

func ToResponse(m *domain.Controller) Response {
	return Response{ID: m.ID, CreatedAt: m.CreatedAt, Version: m.Version, WorkspaceID: m.WorkspaceID, MemberID: m.MemberID}
}

// go-scaffold:dto
