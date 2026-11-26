package domain

import "errors"

var (
	// ErrLinkInvalid is a device.link that is not signed by a Controller of the
	// same Member in the same Workspace, or not a device.link at all.
	ErrLinkInvalid = errors.New("link certificate is not valid")
	// ErrKeyTaken is a key that is already a Controller, or was revoked once.
	ErrKeyTaken = errors.New("key is taken")
	// ErrRevocationInvalid is a device.revoke whose signer or key is not a
	// Controller of that Member.
	ErrRevocationInvalid = errors.New("revocation certificate is not valid")
	// ErrLastDevice is a revocation that would leave the Member no Controller.
	ErrLastDevice = errors.New("revocation would leave no device")
	// ErrLinkRequestInvalid is a link request not shaped like one.
	ErrLinkRequestInvalid = errors.New("link request is not valid")
	// ErrDeviceOffline is a link request for a key with no live Controller
	// connection: nobody is showing that QR any more.
	ErrDeviceOffline = errors.New("device is not connected")
)
