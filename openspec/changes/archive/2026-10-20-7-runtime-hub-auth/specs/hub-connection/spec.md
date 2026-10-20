## Purpose

How a Machine connects to the Hub over WebSocket and proves who it is with its key alone, and how the Hub knows which Machines are online at any moment.

## ADDED Requirements

### Requirement: A challenge in the first frame
On every new WebSocket connection the Hub SHALL send, as the first frame, a challenge carrying a fresh random nonce of at least 32 bytes and the protocol version. Authentication SHALL travel in WebSocket frames only, never in HTTP headers, so a browser can authenticate the same way.

#### Scenario: New connection
- **WHEN** a client opens a WebSocket to the Hub
- **THEN** the first frame it receives is a challenge with a nonce it has not seen on any earlier connection

### Requirement: Only a known key with a valid signature gets in
The client SHALL answer the challenge with its public key and an Ed25519 signature over a fixed context string, the Hub's public URL and the nonce. The Hub SHALL accept the connection only when the key belongs to a known Machine and the signature verifies, and SHALL then answer with a ready frame naming that Machine. Otherwise the Hub SHALL close the connection with an authentication error.

#### Scenario: Known key, valid signature
- **WHEN** a Machine whose key the Hub knows signs the challenge correctly
- **THEN** the Hub answers with a ready frame naming that Machine

#### Scenario: Unknown key
- **WHEN** the answer carries a key that belongs to no Machine
- **THEN** the Hub closes the connection with an authentication error

#### Scenario: Invalid signature
- **WHEN** the signature does not verify with the key in the answer
- **THEN** the Hub closes the connection with an authentication error

#### Scenario: Signature made for another Hub
- **WHEN** the signature covers a Hub URL other than this Hub's public URL
- **THEN** the Hub closes the connection with an authentication error

#### Scenario: Replayed answer
- **WHEN** a client sends an answer that was signed for a nonce from an earlier connection
- **THEN** the Hub closes the connection with an authentication error

### Requirement: The handshake has a deadline
The Hub SHALL close a connection that has not authenticated within the configured handshake timeout, and SHALL close a connection that sends any frame other than an answer before it has authenticated.

#### Scenario: Silent client
- **WHEN** a client sends nothing after the challenge until the timeout passes
- **THEN** the Hub closes the connection

#### Scenario: Frame before authentication
- **WHEN** a client sends some other frame before answering the challenge
- **THEN** the Hub closes the connection

### Requirement: The Hub knows which Machines are online
The Hub SHALL mark a Machine online when its connection authenticates, and offline as soon as that connection closes or fails to answer a heartbeat within the configured interval. When a second connection authenticates with the same key, the Hub SHALL keep the newer one, close the older one, and keep the Machine online.

#### Scenario: Clean disconnect
- **WHEN** an authenticated Machine closes its connection
- **THEN** the Hub marks that Machine offline at once

#### Scenario: Connection that stops answering
- **WHEN** an authenticated connection stops answering heartbeats
- **THEN** the Hub marks that Machine offline within one heartbeat interval, and closes the connection

#### Scenario: Reconnect while the old connection lingers
- **WHEN** a Machine authenticates on a new connection while its old one is still open
- **THEN** the Hub closes the old connection, and the Machine stays online on the new one

### Requirement: Unknown frames after authentication are skipped
After a connection authenticates, the Hub SHALL skip a frame whose message type it does not know, without closing the connection.

#### Scenario: Newer Runtime sends a new frame type
- **WHEN** an authenticated Machine sends a frame type the Hub does not know
- **THEN** the Hub skips it and the connection stays open
