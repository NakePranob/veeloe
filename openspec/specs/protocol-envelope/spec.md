# protocol-envelope Specification

## Purpose
The signed envelope that carries every Veeloe message, and the checks a receiver makes before trusting it, so that a compromised Hub can neither forge, redirect nor replay a message that someone else signed.

## Requirements

### Requirement: The sender signs the exact bytes it sends
The sender SHALL serialize the signed part of an envelope to bytes once, sign those bytes with its Ed25519 key, and carry the same bytes in the envelope unchanged. A receiver SHALL verify the signature over the bytes as carried, never over a re-serialization of a parsed object.

#### Scenario: Bytes verify as carried
- **WHEN** a receiver gets an envelope whose carried bytes and signature are untouched
- **THEN** the signature verifies, whatever key order or whitespace those bytes use

#### Scenario: A changed byte is rejected
- **WHEN** any byte of the carried signed part differs from what the sender signed
- **THEN** the receiver rejects the envelope

### Requirement: An envelope is routed by one destination or by a recipient list
An envelope header SHALL name exactly one of a single destination or a non-empty list of recipient Member ids. A message to a Runtime SHALL use the destination, and a message from a Runtime to Controllers SHALL use the recipient list.

#### Scenario: Message to Controllers
- **WHEN** a Runtime sends a message to the Members allowed to see it
- **THEN** the header carries those Member ids as the recipient list and no destination

#### Scenario: Both routes present
- **WHEN** an envelope names both a destination and a recipient list
- **THEN** the receiver rejects it as malformed

#### Scenario: No route present
- **WHEN** an envelope names neither a destination nor any recipient
- **THEN** the receiver rejects it as malformed

### Requirement: The signed part copies the routing header
The signed part SHALL contain copies of the header's message type, destination, recipient list, Task id and originating Member (each when the header has it) and a per-sender sequence number. The receiver SHALL reject an envelope when any of those header values differs from its signed copy, including the order of the recipient list.

#### Scenario: Redirected envelope
- **WHEN** an envelope signed for one destination arrives with a header naming a different destination
- **THEN** the receiver rejects it

#### Scenario: Changed recipient list
- **WHEN** the header's recipient list differs from the signed copy
- **THEN** the receiver rejects it

#### Scenario: Swapped originating Member
- **WHEN** the header names a different originating Member than the signed part
- **THEN** the receiver rejects it

### Requirement: A receiver accepts only what is addressed to it
The receiver SHALL reject a validly signed envelope when its destination is not one the receiver answers for, or when its recipient list does not include the receiver's Member.

#### Scenario: Delivered to the wrong Runtime
- **WHEN** a Hub delivers an unmodified, validly signed envelope to a Runtime that does not host its destination
- **THEN** that Runtime rejects it

#### Scenario: Delivered to the wrong Controller
- **WHEN** a Controller receives a validly signed envelope whose recipient list leaves out its Member
- **THEN** that Controller rejects it

### Requirement: Verify before parsing
The receiver SHALL check that the sender key named in the header is one it trusts and that the signature verifies, before it parses the signed part. Only then SHALL it parse the signed part and check its shape.

#### Scenario: Untrusted sender key
- **WHEN** the header names a sender key the receiver does not trust
- **THEN** the receiver rejects the envelope without parsing the signed part

#### Scenario: Invalid signature
- **WHEN** the signature does not verify with the named sender key
- **THEN** the receiver rejects the envelope without parsing the signed part

### Requirement: Sequence numbers only go up per sender
The receiver SHALL accept an envelope only when its sequence number is greater than the last one it accepted from the same sender key, and SHALL remember the new number. A rejected envelope SHALL NOT change the remembered number. This SHALL NOT depend on any clock.

#### Scenario: Replayed envelope
- **WHEN** an envelope arrives with the same sequence number as one already accepted from that sender key
- **THEN** the receiver rejects it

#### Scenario: Older envelope
- **WHEN** an envelope arrives with a lower sequence number than the last one accepted from that sender key
- **THEN** the receiver rejects it

#### Scenario: Gap in sequence numbers
- **WHEN** an envelope arrives with a sequence number more than one above the last accepted
- **THEN** the receiver accepts it

#### Scenario: Rejected envelope leaves the number alone
- **WHEN** an envelope with a high sequence number is rejected for any other reason
- **THEN** a later valid envelope with a lower sequence number is still accepted

### Requirement: Receivers skip what they do not know
A receiver SHALL accept and ignore fields it does not know in the header and in the signed part, and SHALL skip a message type it does not know without failing or closing the connection.

#### Scenario: Unknown field
- **WHEN** a correctly signed envelope carries a field the receiver does not know
- **THEN** the signature verifies and the receiver handles the message as if the field were absent

#### Scenario: Unknown message type
- **WHEN** a receiver gets a correctly signed envelope whose message type it does not know
- **THEN** it reports that type as unknown and keeps handling the envelopes that follow

### Requirement: Errors are codes, not sentences
An `error` message SHALL carry a machine-readable code and optional parameters made of strings, numbers and booleans. It SHALL NOT rely on a human-readable sentence, because the Controller renders the words in the Member's language.

#### Scenario: Known error
- **WHEN** a receiver gets an `error` message with a code and parameters
- **THEN** it gets that code and those parameters as sent

#### Scenario: Error code from a newer sender
- **WHEN** a receiver gets an `error` message whose code it has never seen
- **THEN** the message still parses, with the unfamiliar code preserved so the Controller can show a general message with that code

#### Scenario: Malformed error
- **WHEN** an `error` message has no code, or a code that is not lowercase words separated by dots
- **THEN** the receiver treats that message as invalid and keeps handling the envelopes that follow

### Requirement: Published header schema and shared test vectors
The Protocol SHALL publish a JSON Schema of the envelope header and a set of test vectors (test keys, signed bytes, signatures and expected results) that cover every rejection reason. Every implementation of the Protocol in this repository SHALL check itself against them in CI.

#### Scenario: Published files drift from the code
- **WHEN** the header schema or the vectors no longer match what the Protocol code produces
- **THEN** the CI check fails

#### Scenario: Vectors reach their expected results
- **WHEN** the TypeScript implementation checks the published vectors
- **THEN** every vector reaches its expected result
