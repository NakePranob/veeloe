package stun

import (
	"bytes"
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func request(id byte) []byte {
	req := make([]byte, 20)
	binary.BigEndian.PutUint16(req[0:2], bindingRequest)
	binary.BigEndian.PutUint32(req[4:8], magicCookie)
	for i := 8; i < 20; i++ {
		req[i] = id
	}
	return req
}

// mapped decodes XOR-MAPPED-ADDRESS from an answer.
func mapped(t *testing.T, out []byte) (net.IP, int) {
	t.Helper()
	if binary.BigEndian.Uint16(out[0:2]) != bindingSuccess || binary.BigEndian.Uint16(out[20:22]) != xorMappedAddress {
		t.Fatalf("not a Binding success with XOR-MAPPED-ADDRESS: %x", out)
	}
	value := out[24:]
	key := append(binary.BigEndian.AppendUint32(nil, magicCookie), out[8:20]...)
	ip := make(net.IP, len(value)-4)
	for i := range ip {
		ip[i] = value[4+i] ^ key[i]
	}
	return ip, int(binary.BigEndian.Uint16(value[2:4]) ^ (magicCookie >> 16))
}

func TestAnswerTellsTheSenderItsOwnAddress(t *testing.T) {
	for _, from := range []*net.UDPAddr{
		{IP: net.ParseIP("203.0.113.7"), Port: 51234},
		{IP: net.ParseIP("2001:db8::1"), Port: 3478},
	} {
		req := request(0x5a)
		out := Answer(req, from)
		if !bytes.Equal(out[8:20], req[8:20]) {
			t.Fatal("transaction id not echoed")
		}
		ip, port := mapped(t, out)
		if !ip.Equal(from.IP) || port != from.Port {
			t.Fatalf("got %s:%d, want %s", ip, port, from)
		}
	}
}

func TestAnswerIgnoresWhatIsNotABindingRequest(t *testing.T) {
	from := &net.UDPAddr{IP: net.ParseIP("203.0.113.7"), Port: 1}
	noCookie := request(1)
	binary.BigEndian.PutUint32(noCookie[4:8], 0)
	wrongLength := append(request(1), 0, 0, 0, 0)
	notBinding := request(1)
	binary.BigEndian.PutUint16(notBinding[0:2], bindingSuccess)
	for name, req := range map[string][]byte{"short": request(1)[:19], "no cookie": noCookie, "length": wrongLength, "not binding": notBinding, "http": []byte("GET / HTTP/1.1\r\n\r\n123")} {
		if Answer(req, from) != nil {
			t.Errorf("%s: answered", name)
		}
	}
}

func TestServeAnswersOverUDP(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go Serve(ctx, conn)
	client, err := net.DialUDP("udp", nil, conn.LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := client.Write(request(7)); err != nil {
		t.Fatal(err)
	}
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 100)
	n, err := client.Read(buf)
	if err != nil {
		t.Fatal(err)
	}
	ip, port := mapped(t, buf[:n])
	local := client.LocalAddr().(*net.UDPAddr)
	if !ip.Equal(local.IP) || port != local.Port {
		t.Fatalf("got %s:%d, want %s", ip, port, local)
	}
}
