-- one schema per domain — see adapters/outbound/postgres/model.go's TableName for why
CREATE SCHEMA IF NOT EXISTS controller_svc;

CREATE TABLE controller_svc.controllers (
    id           UUID PRIMARY KEY,
    -- the Workspace the Controller belongs to; its foreign key comes with the
    -- workspace table
    workspace_id UUID NOT NULL,
    -- the Member who holds this Controller; recipient lists name Members by it
    member_id    TEXT NOT NULL CHECK (member_id <> ''),
    -- the Controller's Ed25519 public key, which is its identity at the Hub
    -- (ADR 0013)
    public_key   BYTEA NOT NULL UNIQUE CHECK (octet_length(public_key) = 32),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- bumped on every update; an update that carries an older value is refused
    version      INTEGER NOT NULL DEFAULT 1
);
