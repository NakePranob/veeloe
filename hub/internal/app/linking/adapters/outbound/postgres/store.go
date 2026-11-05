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
