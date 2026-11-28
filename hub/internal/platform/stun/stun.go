// Package stun answers STUN Binding requests (RFC 8489) on UDP, so a Runtime and
// a Controller behind NAT learn the address the internet sees them at and can
// put it in their direct-link offer (ADR 0090). It only reports the sender's own
// address back: it relays nothing and holds nothing.
package stun

import (
	"context"
	"encoding/binary"
	"errors"
	"log/slog"
	"net"
)

const (
	headerBytes      = 20
	magicCookie      = 0x2112A442
	bindingRequest   = 0x0001
	bindingSuccess   = 0x0101
	xorMappedAddress = 0x0020
)

// Answer returns the Binding success response to req from from, or nil when req
// is not a Binding request. The answer is 32 bytes (44 for IPv6) to a request of
// at least 20, so the Hub is no amplifier worth aiming.
func Answer(req []byte, from *net.UDPAddr) []byte {
	if len(req) < headerBytes || binary.BigEndian.Uint16(req[0:2]) != bindingRequest ||
		binary.BigEndian.Uint32(req[4:8]) != magicCookie ||
		int(binary.BigEndian.Uint16(req[2:4]))+headerBytes != len(req) {
		return nil
	}
	ip, family := from.IP.To4(), byte(0x01)
	if ip == nil {
		ip, family = from.IP.To16(), 0x02
	}
	if ip == nil {
		return nil
	}
	value := make([]byte, 4+len(ip))
	value[1] = family
	binary.BigEndian.PutUint16(value[2:4], uint16(from.Port)^(magicCookie>>16))
	// The address is XORed with the cookie, then (IPv6) the transaction id.
	key := append(binary.BigEndian.AppendUint32(nil, magicCookie), req[8:20]...)
	for i := range ip {
		value[4+i] = ip[i] ^ key[i]
	}
	out := make([]byte, headerBytes, headerBytes+4+len(value))
	binary.BigEndian.PutUint16(out[0:2], bindingSuccess)
	binary.BigEndian.PutUint16(out[2:4], uint16(4+len(value)))
	copy(out[4:20], req[4:20])
	out = binary.BigEndian.AppendUint16(out, xorMappedAddress)
	out = binary.BigEndian.AppendUint16(out, uint16(len(value)))
	return append(out, value...)
}

// Serve answers on conn until ctx ends or conn is closed.
//
// ponytail: no rate limit; the answer is barely bigger than the request. Add a
// per-address limit if the port is ever used to flood someone.
func Serve(ctx context.Context, conn net.PacketConn) {
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	buf := make([]byte, 1500)
	for {
		n, addr, err := conn.ReadFrom(buf)
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				slog.Error("stun read", "error", err)
			}
			return
		}
		from, ok := addr.(*net.UDPAddr)
		if !ok {
			continue
		}
		if out := Answer(buf[:n], from); out != nil {
			_, _ = conn.WriteTo(out, addr)
		}
	}
}
