-- A member.remove is kept and handed out like the other certificates (ADR 0059).
ALTER TABLE controller_svc.certificates DROP CONSTRAINT certificates_type_check;
ALTER TABLE controller_svc.certificates ADD CONSTRAINT certificates_type_check
    CHECK (type IN ('device.link', 'device.revoke', 'member.add', 'member.remove'));
