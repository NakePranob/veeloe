-- Invitations (ADR 0059): a link one Controller opened for up to max_members
-- people until expires_at. The Hub counts who joined and closes the link; it is
-- never who vouches for a key: the inviter signs each member.add after
-- comparing a short code.
CREATE TABLE controller_svc.invitations (
    id           BYTEA PRIMARY KEY CHECK (octet_length(id) = 16),
    workspace_id UUID NOT NULL REFERENCES workspace_svc.workspaces (id),
    -- the Controller that opened it, and the only one that can let people in
    by_key       BYTEA NOT NULL CHECK (octet_length(by_key) = 32),
    max_members  INT NOT NULL CHECK (max_members BETWEEN 1 AND 100),
    joined       INT NOT NULL DEFAULT 0 CHECK (joined >= 0 AND joined <= max_members),
    expires_at   TIMESTAMPTZ NOT NULL,
    closed_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the inviter left for each person let in: where the Machines are, under
-- an HMAC the new device checks with the link's secret. Kept so the new device
-- can pick it up after the link closes.
CREATE TABLE controller_svc.invitation_handoffs (
    invitation_id BYTEA NOT NULL REFERENCES controller_svc.invitations (id) ON DELETE CASCADE,
    key           BYTEA NOT NULL CHECK (octet_length(key) = 32),
    data          TEXT NOT NULL,
    proof         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (invitation_id, key)
);

-- A member.add is kept and handed out like the device certificates.
ALTER TABLE controller_svc.certificates DROP CONSTRAINT certificates_type_check;
ALTER TABLE controller_svc.certificates ADD CONSTRAINT certificates_type_check
    CHECK (type IN ('device.link', 'device.revoke', 'member.add'));
