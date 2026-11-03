-- one schema per domain — see adapters/outbound/postgres/model.go's TableName for why
CREATE SCHEMA IF NOT EXISTS workspace_svc;

CREATE TABLE workspace_svc.workspaces (
    id         UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE machine_svc.machines
    ADD CONSTRAINT machines_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspace_svc.workspaces (id);

ALTER TABLE controller_svc.controllers
    ADD CONSTRAINT controllers_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspace_svc.workspaces (id);
