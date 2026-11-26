package composition

import (
	"context"
	"encoding/base64"

	"hub/internal/app/controller"
	"hub/internal/app/machine"
	"hub/internal/app/relay"
)

// RelayIdentities answers relay's Identities port from the machine and
// controller modules, so none of them import each other (ADR 0022).
func RelayIdentities(m machine.Lookup, c controller.Lookup) relay.Identities {
	return relayIdentities{m, c}
}

type relayIdentities struct {
	m machine.Lookup
	c controller.Lookup
}

func (a relayIdentities) ByKey(ctx context.Context, key []byte) (relay.Identity, bool, error) {
	encoded := base64.RawURLEncoding.EncodeToString(key)
	id, workspace, ok, err := a.m.MachineByPublicKey(ctx, key)
	if err != nil {
		return relay.Identity{}, false, err
	}
	if ok {
		return relay.Identity{Kind: relay.KindMachine, ID: id.String(), Workspace: workspace.String(), Key: encoded}, true, nil
	}
	member, workspace, ok, err := a.c.ControllerByPublicKey(ctx, key)
	if err != nil || !ok {
		return relay.Identity{}, false, err
	}
	return relay.Identity{Kind: relay.KindController, ID: member, Workspace: workspace.String(), Key: encoded}, true, nil
}
