DELETE FROM controller_svc.certificates WHERE type = 'member.title';
-- One member.remove per signing key, as the old constraint allowed.
DELETE FROM controller_svc.certificates a USING controller_svc.certificates b
    WHERE a.type = 'member.remove' AND b.type = 'member.remove' AND a.key = b.key AND a.id > b.id;
ALTER TABLE controller_svc.certificates DROP CONSTRAINT certificates_type_check;
ALTER TABLE controller_svc.certificates ADD CONSTRAINT certificates_type_check
    CHECK (type IN ('device.link', 'device.revoke', 'member.add', 'member.remove'));
DROP INDEX controller_svc.certificates_type_key_once;
ALTER TABLE controller_svc.certificates ADD CONSTRAINT certificates_type_key_key UNIQUE (type, key);
