-- one schema per domain — see adapters/outbound/postgres/model.go's TableName for why
CREATE SCHEMA IF NOT EXISTS machine_svc;

CREATE TABLE machine_svc.machines (
    id           UUID PRIMARY KEY,
    -- the Workspace the Machine belongs to; its foreign key comes with the
    -- workspace table (#8)
    workspace_id UUID NOT NULL,
    -- the Machine's Ed25519 public key, which is its identity at the Hub
    -- (ADR 0013)
    public_key   BYTEA NOT NULL UNIQUE CHECK (octet_length(public_key) = 32),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- bumped on every update; an update that carries an older value is refused
    version      INTEGER NOT NULL DEFAULT 1
);
