ALTER TABLE controller_svc.controllers DROP CONSTRAINT IF EXISTS controllers_workspace_fk;
ALTER TABLE machine_svc.machines DROP CONSTRAINT IF EXISTS machines_workspace_fk;
DROP TABLE IF EXISTS workspace_svc.workspaces;
-- the schema itself is left in place, as the machine migration explains
