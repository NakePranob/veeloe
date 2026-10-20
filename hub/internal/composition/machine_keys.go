package composition

import (
	"context"

	"hub/internal/app/machine"
	"hub/internal/app/relay"
)

// RelayMachineKeys answers relay's MachineKeys port from the machine module,
// so the two never import each other (ADR 0022).
func RelayMachineKeys(m machine.Lookup) relay.MachineKeys {
	return relayMachineKeys{m}
}

type relayMachineKeys struct{ m machine.Lookup }

func (a relayMachineKeys) MachineByKey(ctx context.Context, key []byte) (string, bool, error) {
	id, ok, err := a.m.MachineByPublicKey(ctx, key)
	if err != nil || !ok {
		return "", false, err
	}
	return id.String(), true, nil
}
