package application

import "context"

// FindByPublicKey answers the Machine that holds this public key, or
// domain.ErrNotFound. The relay uses it to tell who is connecting (ADR 0013).
func (s *Service) FindByPublicKey(ctx context.Context, key []byte) (Response, error) {
	m, err := s.repo.FindByPublicKey(ctx, key)
	if err != nil {
		return Response{}, err
	}
	return ToResponse(m), nil
}
