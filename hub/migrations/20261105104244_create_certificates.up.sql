-- The device.link and device.revoke certificates a Controller signed. The Hub
-- keeps them as metadata and hands them to every Machine and Controller of the
-- Workspace, which check each signature themselves (ADR 0005, 0031). A revoked
-- key's certificates stay, so a Machine paired later still learns of it.
CREATE TABLE controller_svc.certificates (
    -- the order they were made, which is the order they are handed out in
    id           BIGSERIAL PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace_svc.workspaces (id),
    member_id    TEXT NOT NULL CHECK (member_id <> ''),
    type         TEXT NOT NULL CHECK (type IN ('device.link', 'device.revoke')),
    -- the key linked or revoked, and the key that signed
    key          BYTEA NOT NULL CHECK (octet_length(key) = 32),
    by_key       BYTEA NOT NULL CHECK (octet_length(by_key) = 32),
    -- exactly as signed and sent, since the signature is over these bytes
    signed       TEXT NOT NULL,
    sig          TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a key is linked once and revoked once
    UNIQUE (type, key)
);

CREATE INDEX certificates_workspace_idx ON controller_svc.certificates (workspace_id, id);
