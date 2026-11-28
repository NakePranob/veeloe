// Package postgres is the linking outbound adapter. It owns
// controller_svc.certificates, and adds and removes rows of the Controller
// table, because a certificate and the key it changes are one write.
package postgres

import (
	"context"
	"encoding/base64"
	"errors"
	"slices"
	"time"

	"hub/internal/app/linking/domain"
	"hub/internal/app/linking/ports"
	"hub/internal/shared/dberr"
	"hub/internal/shared/id"
	"hub/internal/shared/protocol"
	"hub/internal/shared/tx"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ ports.Store = (*Store)(nil)

var text = base64.RawURLEncoding.EncodeToString

type certificateRow struct {
	ID          int64     `gorm:"primaryKey"`
	WorkspaceID uuid.UUID `gorm:"type:uuid"`
	MemberID    string
	Type        string
	Key         []byte
	ByKey       []byte
	Signed      string
	Sig         string
	CreatedAt   time.Time `gorm:"->"`
}

func (certificateRow) TableName() string { return "controller_svc.certificates" }

// controllerRow is this module's view of controller_svc.controllers. Writers:
// pairing inserts a Pairing's first Controller and linking inserts and removes
// linked ones, each inside its own transaction. The controller module only reads.
// Module isolation (ADR 0070) keeps each its own struct: sharing one would mean
// a table row in internal/shared or one module importing another.
type controllerRow struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	WorkspaceID uuid.UUID `gorm:"type:uuid"`
	MemberID    string
	PublicKey   []byte
}

func (controllerRow) TableName() string { return "controller_svc.controllers" }

type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

func row(c domain.Certificate) certificateRow {
	return certificateRow{WorkspaceID: c.Workspace, MemberID: c.Member, Type: c.Type, Key: c.Key, ByKey: c.By, Signed: c.Signed, Sig: c.Sig}
}

// Link holds the signer's row while it writes, so a revocation of the signer
// cannot land in between and leave a key linked by a removed one. Two requests
// racing on one key cannot both insert it: the loser fails on a unique key, and
// its second try answers from the winner's rows.
func (s *Store) Link(ctx context.Context, c domain.Certificate) (bool, error) {
	created, err := s.link(ctx, c)
	if err != nil && dberr.IsDuplicate(err) {
		created, err = s.link(ctx, c)
	}
	return created, err
}

func (s *Store) link(ctx context.Context, c domain.Certificate) (created bool, err error) {
	err = tx.Do(ctx, s.db, func(ctx context.Context) error {
		db := tx.From(ctx, s.db).WithContext(ctx)

		var by controllerRow
		err := db.Clauses(clause.Locking{Strength: "SHARE"}).Take(&by, "public_key = ?", c.By).Error
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && (by.WorkspaceID != c.Workspace || by.MemberID != c.Member)) {
			return domain.ErrLinkInvalid
		}
		if err != nil {
			return err
		}

		var existing []certificateRow
		if err := db.Where("key = ?", c.Key).Find(&existing).Error; err != nil {
			return err
		}
		var owners int64
		if err := db.Model(&controllerRow{}).Where("public_key = ?", c.Key).Count(&owners).Error; err != nil {
			return err
		}
		// The same certificate again, for a key it still holds, is done already.
		for _, e := range existing {
			if e.Type == protocol.DeviceLink && e.Signed == c.Signed && owners == 1 {
				return nil
			}
		}
		if len(existing) > 0 || owners > 0 {
			return domain.ErrKeyTaken
		}

		if err := db.Create(&controllerRow{ID: id.New(), WorkspaceID: c.Workspace, MemberID: c.Member, PublicKey: c.Key}).Error; err != nil {
			return err
		}
		cert := row(c)
		if err := db.Create(&cert).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	return created, err
}

// Revoke locks the Member's Controller rows first, so a link signed by a key
// being dropped waits, then finds its signer gone.
func (s *Store) Revoke(ctx context.Context, c domain.Certificate) (dropped []string, err error) {
	err = tx.Do(ctx, s.db, func(ctx context.Context) error {
		db := tx.From(ctx, s.db).WithContext(ctx)

		var rows []controllerRow
		if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("workspace_id = ? AND member_id = ?", c.Workspace, c.Member).Find(&rows).Error; err != nil {
			return err
		}
		// The same certificate again is done already. Checked first, since a
		// key that revoked itself is no longer there to sign.
		var same int64
		if err := db.Model(&certificateRow{}).
			Where("type = ? AND key = ? AND signed = ?", protocol.DeviceRevoke, c.Key, c.Signed).Count(&same).Error; err != nil {
			return err
		}
		if same > 0 {
			return nil
		}

		registered := make([]string, len(rows))
		for i, r := range rows {
			registered[i] = text(r.PublicKey)
		}
		if !slices.Contains(registered, text(c.By)) || !slices.Contains(registered, text(c.Key)) {
			return domain.ErrRevocationInvalid
		}

		var links []certificateRow
		if err := db.Where("workspace_id = ? AND member_id = ? AND type = ?", c.Workspace, c.Member, protocol.DeviceLink).
			Order("id").Find(&links).Error; err != nil {
			return err
		}
		fallout := make([]protocol.Link, len(links))
		for i, l := range links {
			fallout[i] = protocol.Link{Key: text(l.Key), By: text(l.ByKey)}
		}
		drops, err := domain.Drops(protocol.RevokedWith(text(c.Key), fallout, c.Keep), registered)
		if err != nil {
			return err
		}

		keys := make([][]byte, len(drops))
		for i, d := range drops {
			keys[i], _ = base64.RawURLEncoding.DecodeString(d)
		}
		if err := db.Where("public_key IN ?", keys).Delete(&controllerRow{}).Error; err != nil {
			return err
		}
		cert := row(c)
		if err := db.Create(&cert).Error; err != nil {
			return err
		}
		dropped = drops
		return nil
	})
	if err != nil {
		return nil, err
	}
	return dropped, nil
}

func (s *Store) ForWorkspace(ctx context.Context, workspace uuid.UUID) ([]protocol.Certificate, error) {
	var rows []certificateRow
	if err := s.db.WithContext(ctx).Select("signed", "sig").Where("workspace_id = ?", workspace).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	certs := make([]protocol.Certificate, len(rows))
	for i, r := range rows {
		certs[i] = protocol.Certificate{Signed: r.Signed, Sig: r.Sig}
	}
	return certs, nil
}

// Revoked answers whether a key that is no Controller now ever was one through a
// certificate: revoked itself, or dropped with the key that linked it. A new device
// still waiting to be linked has no certificate, and keeps getting 4401.
func (s *Store) Revoked(ctx context.Context, key []byte) (bool, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&certificateRow{}).
		Where("key = ? AND NOT EXISTS (SELECT 1 FROM controller_svc.controllers c WHERE c.public_key = ?)", key, key).
		Count(&n).Error
	return n > 0, err
}

type invitationRow struct {
	ID          []byte    `gorm:"primaryKey"`
	WorkspaceID uuid.UUID `gorm:"type:uuid"`
	ByKey       []byte
	MaxMembers  int
	Joined      int
	ExpiresAt   time.Time
	ClosedAt    *time.Time
}

func (invitationRow) TableName() string { return "controller_svc.invitations" }

type handoffRow struct {
	InvitationID []byte `gorm:"primaryKey"`
	Key          []byte `gorm:"primaryKey"`
	Data         string
	Proof        string
}

func (handoffRow) TableName() string { return "controller_svc.invitation_handoffs" }

func (r invitationRow) domain() domain.Invitation {
	return domain.Invitation{ID: r.ID, Workspace: r.WorkspaceID, By: r.ByKey, Max: r.MaxMembers, Joined: r.Joined, Expires: r.ExpiresAt, Closed: r.ClosedAt != nil}
}

// signer is c.By's row when it is a Controller of c.Member in c's Workspace.
func signer(db *gorm.DB, c domain.Certificate) (bool, error) {
	var by controllerRow
	err := db.Take(&by, "public_key = ?", c.By).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil && by.WorkspaceID == c.Workspace && by.MemberID == c.Member, err
}

func (s *Store) Open(ctx context.Context, c domain.Certificate, inv domain.Invitation) error {
	db := s.db.WithContext(ctx)
	ok, err := signer(db, c)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrInvitationInvalid
	}
	var existing invitationRow
	err = db.Take(&existing, "id = ?", inv.ID).Error
	if err == nil {
		if !slices.Equal(existing.ByKey, c.By) {
			return domain.ErrInvitationInvalid
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	err = db.Create(&invitationRow{ID: inv.ID, WorkspaceID: c.Workspace, ByKey: c.By, MaxMembers: inv.Max, ExpiresAt: inv.Expires}).Error
	if err != nil && dberr.IsDuplicate(err) {
		return domain.ErrInvitationInvalid
	}
	return err
}

func (s *Store) Close(ctx context.Context, c domain.Certificate, invitation []byte) error {
	res := s.db.WithContext(ctx).Model(&invitationRow{}).
		Where("id = ? AND by_key = ? AND workspace_id = ? AND closed_at IS NULL", invitation, c.By, c.Workspace).
		Update("closed_at", time.Now())
	return res.Error
}

func (s *Store) Invitation(ctx context.Context, id []byte) (domain.Invitation, bool, error) {
	var r invitationRow
	err := s.db.WithContext(ctx).Take(&r, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Invitation{}, false, nil
	}
	if err != nil {
		return domain.Invitation{}, false, err
	}
	return r.domain(), true, nil
}

func (s *Store) Handoff(ctx context.Context, invitation, key []byte) (domain.Handoff, bool, error) {
	var r handoffRow
	err := s.db.WithContext(ctx).Take(&r, "invitation_id = ? AND key = ?", invitation, key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Handoff{}, false, nil
	}
	if err != nil {
		return domain.Handoff{}, false, err
	}
	return domain.Handoff{Data: r.Data, Proof: r.Proof}, true, nil
}

// AddMember locks the Invitation, so two people let in at once cannot both take
// its last seat.
func (s *Store) AddMember(ctx context.Context, c domain.Certificate, invitation []byte, handoff domain.Handoff, now time.Time) (created bool, err error) {
	err = tx.Do(ctx, s.db, func(ctx context.Context) error {
		db := tx.From(ctx, s.db).WithContext(ctx)
		var inv invitationRow
		err := db.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&inv, "id = ?", invitation).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrInvitationInvalid
		}
		if err != nil {
			return err
		}
		if !slices.Equal(inv.ByKey, c.By) || inv.WorkspaceID != c.Workspace {
			return domain.ErrInvitationInvalid
		}
		// The opener must still be a Controller here: a device revoked after it
		// opened the link lets no one in.
		var signers int64
		if err := db.Model(&controllerRow{}).Where("public_key = ? AND workspace_id = ?", c.By, c.Workspace).Count(&signers).Error; err != nil {
			return err
		}
		if signers == 0 {
			return domain.ErrInvitationInvalid
		}
		// The same certificate again, for a key it still holds, is done already.
		var same int64
		if err := db.Model(&certificateRow{}).Where("type = ? AND key = ? AND signed = ?", protocol.MemberAdd, c.Key, c.Signed).Count(&same).Error; err != nil {
			return err
		}
		if same > 0 {
			return nil
		}
		if !inv.domain().Open(now) {
			return domain.ErrInvitationClosed
		}
		var taken int64
		if err := db.Model(&controllerRow{}).Where("public_key = ? OR (workspace_id = ? AND member_id = ?)", c.Key, c.Workspace, c.Member).Count(&taken).Error; err != nil {
			return err
		}
		var used int64
		if err := db.Model(&certificateRow{}).Where("key = ?", c.Key).Count(&used).Error; err != nil {
			return err
		}
		if taken > 0 || used > 0 {
			return domain.ErrKeyTaken
		}
		if err := db.Create(&controllerRow{ID: id.New(), WorkspaceID: c.Workspace, MemberID: c.Member, PublicKey: c.Key}).Error; err != nil {
			return err
		}
		cert := row(c)
		if err := db.Create(&cert).Error; err != nil {
			return err
		}
		if err := db.Create(&handoffRow{InvitationID: invitation, Key: c.Key, Data: handoff.Data, Proof: handoff.Proof}).Error; err != nil {
			return err
		}
		if err := db.Model(&inv).Where("id = ?", invitation).Update("joined", inv.Joined+1).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	return created, err
}

// RemoveMember locks the Member's Controller rows, so a link they sign cannot
// land in between.
func (s *Store) RemoveMember(ctx context.Context, c domain.Certificate) (dropped []string, err error) {
	err = tx.Do(ctx, s.db, func(ctx context.Context) error {
		db := tx.From(ctx, s.db).WithContext(ctx)
		var same int64
		if err := db.Model(&certificateRow{}).Where("type = ? AND signed = ?", protocol.MemberRemove, c.Signed).Count(&same).Error; err != nil {
			return err
		}
		if same > 0 {
			return nil
		}
		var by controllerRow
		err := db.Take(&by, "public_key = ? AND workspace_id = ?", c.By, c.Workspace).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.ErrMemberRemoveInvalid
		}
		if err != nil {
			return err
		}
		// An Owner came by Pairing: no member.add names them. The one removed came by an Invitation.
		invited := func(member string) (bool, error) {
			var n int64
			err := db.Model(&certificateRow{}).Where("workspace_id = ? AND member_id = ? AND type = ?", c.Workspace, member, protocol.MemberAdd).Count(&n).Error
			return n > 0, err
		}
		signerInvited, err := invited(by.MemberID)
		if err != nil {
			return err
		}
		targetInvited, err := invited(c.Member)
		if err != nil {
			return err
		}
		if signerInvited || !targetInvited || by.MemberID == c.Member {
			return domain.ErrMemberRemoveInvalid
		}
		var rows []controllerRow
		if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("workspace_id = ? AND member_id = ?", c.Workspace, c.Member).Find(&rows).Error; err != nil {
			return err
		}
		dropped = []string{}
		for _, r := range rows {
			dropped = append(dropped, text(r.PublicKey))
		}
		if err := db.Where("workspace_id = ? AND member_id = ?", c.Workspace, c.Member).Delete(&controllerRow{}).Error; err != nil {
			return err
		}
		cert := row(c)
		return db.Create(&cert).Error
	})
	if err != nil {
		return nil, err
	}
	return dropped, nil
}
