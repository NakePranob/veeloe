## Purpose

The signed envelope that carries every Veeloe message, and the checks a receiver makes before trusting it, so that a compromised Hub can neither forge, redirect nor replay a message that was signed by someone else.

## ADDED Requirements

### Requirement: The sender signs the exact bytes it sends
The sender SHALL serialize the signed part of an envelope to bytes once, sign those bytes with its Ed25519 key, and carry the same bytes in the envelope unchanged. A receiver SHALL verify the signature over the bytes as carried, never over a re-serialization of a parsed object.

#### Scenario: Bytes verify as carried
- **WHEN** a receiver gets an envelope whose carried bytes and signature are untouched
- **THEN** the signature verifies, whatever key order or whitespace those bytes use

#### Scenario: A changed byte is rejected
- **WHEN** any byte of the carried signed part differs from what the sender signed
- **THEN** the receiver rejects the envelope

### Requirement: The signed part copies the routing header
The signed part SHALL contain copies of the header's message type, destination, Task id and originating Member (each when the header has it) and a per-sender sequence number. The receiver SHALL reject an envelope when any of those header values differs from its signed copy.

#### Scenario: Redirected envelope
- **WHEN** an envelope signed for one destination arrives with a header naming a different destination
- **THEN** the receiver rejects it

#### Scenario: Swapped originating Member
- **WHEN** the header names a different originating Member than the signed part
- **THEN** the receiver rejects it

### Requirement: Verify before parsing
The receiver SHALL check that the sender key named in the header is one it trusts and that the signature verifies, before it parses the signed part. Only then SHALL it parse the signed part and check its shape.

#### Scenario: Untrusted sender key
- **WHEN** the header names a sender key the receiver does not trust
- **THEN** the receiver rejects the envelope without parsing the signed part

#### Scenario: Invalid signature
- **WHEN** the signature does not verify with the named sender key
- **THEN** the receiver rejects the envelope without parsing the signed part

### Requirement: Sequence numbers only go up per sender
The receiver SHALL accept an envelope only when its sequence number is greater than the last one it accepted from the same sender key, and SHALL remember the new number. This SHALL NOT depend on any clock.

#### Scenario: Replayed envelope
- **WHEN** an envelope arrives with the same sequence number as one already accepted from that sender key
- **THEN** the receiver rejects it

#### Scenario: Older envelope
- **WHEN** an envelope arrives with a lower sequence number than the last one accepted from that sender key
- **THEN** the receiver rejects it

#### Scenario: Gap in sequence numbers
- **WHEN** an envelope arrives with a sequence number more than one above the last accepted
- **THEN** the receiver accepts it

### Requirement: Receivers skip what they do not know
A receiver SHALL accept and ignore fields it does not know in the header and in the signed part, and SHALL skip a message type it does not know without failing or closing the connection.

#### Scenario: Unknown field
- **WHEN** a correctly signed envelope carries a field the receiver does not know
- **THEN** the signature verifies and the receiver handles the message as if the field were absent

#### Scenario: Unknown message type
- **WHEN** a receiver gets a frame whose message type it does not know
- **THEN** it skips that frame and keeps handling the frames that follow

### Requirement: Published header schema and shared test vectors
The Protocol SHALL publish a JSON Schema of the envelope header and a set of test vectors (test keys, signed bytes, signatures and expected results). Every implementation of the Protocol in this repository SHALL check itself against both in CI.

#### Scenario: An implementation's header type drifts
- **WHEN** an implementation's header type no longer matches the published JSON Schema
- **THEN** its CI check fails

#### Scenario: Vectors agree across languages
- **WHEN** the TypeScript and the Go implementations check the same test vectors
- **THEN** both reach the expected result for every vector
