DELETE FROM controller_svc.certificates WHERE type = 'member.remove';
ALTER TABLE controller_svc.certificates DROP CONSTRAINT certificates_type_check;
ALTER TABLE controller_svc.certificates ADD CONSTRAINT certificates_type_check
    CHECK (type IN ('device.link', 'device.revoke', 'member.add'));
