-- A member.title is kept and handed out like the other certificates (ADR 0093). Its `key`,
-- like a member.remove's, is the signer's, who signs many: only a link, a revocation and a
-- new Member name a key once.
ALTER TABLE controller_svc.certificates DROP CONSTRAINT certificates_type_key_key;
CREATE UNIQUE INDEX certificates_type_key_once ON controller_svc.certificates (type, key)
    WHERE type IN ('device.link', 'device.revoke', 'member.add');
ALTER TABLE controller_svc.certificates DROP CONSTRAINT certificates_type_check;
ALTER TABLE controller_svc.certificates ADD CONSTRAINT certificates_type_check
    CHECK (type IN ('device.link', 'device.revoke', 'member.add', 'member.remove', 'member.title'));
