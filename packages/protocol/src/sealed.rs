//! A small sealed box for Provider keys: X25519 from the Machine's Ed25519
//! identity, HKDF-SHA256, and AES-256-GCM (ADR 0005, 0042).

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use ed25519_dalek::{SigningKey, VerifyingKey};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey as XPublicKey, StaticSecret};

use crate::base64url::{from_base64url, to_base64url};

const INFO: &[u8] = b"veeloe-provider-key-v1";
const EPK: usize = 32;
const NONCE: usize = 12;

#[derive(Debug, thiserror::Error)]
pub enum SealedError {
    #[error("sealed key is not base64url")]
    Encoding,
    #[error("sealed key is too short")]
    Short,
    #[error("sealed key did not decrypt")]
    Decrypt,
}

/// The X25519 public key that belongs to an Ed25519 Machine identity.
pub fn box_public(ed25519_public: &[u8; 32]) -> Result<[u8; 32], SealedError> {
    let key = VerifyingKey::from_bytes(ed25519_public).map_err(|_| SealedError::Decrypt)?;
    Ok(key.to_montgomery().to_bytes())
}

/// Decrypt with the Machine's Ed25519 seed, never with a separate key file.
pub fn open(ed25519_seed: &[u8; 32], sealed: &str) -> Result<Vec<u8>, SealedError> {
    let bytes = from_base64url(sealed).map_err(|_| SealedError::Encoding)?;
    if bytes.len() < EPK + NONCE + 16 {
        return Err(SealedError::Short);
    }
    let (epk, rest) = bytes.split_at(EPK);
    let (nonce, ciphertext) = rest.split_at(NONCE);
    let ephemeral: [u8; 32] = epk.try_into().map_err(|_| SealedError::Short)?;
    let secret = StaticSecret::from(SigningKey::from_bytes(ed25519_seed).to_scalar_bytes());
    let shared = secret.diffie_hellman(&XPublicKey::from(ephemeral));
    let own = XPublicKey::from(&secret);
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(&ephemeral);
    salt.extend_from_slice(own.as_bytes());
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes())
        .expand(INFO, &mut key)
        .map_err(|_| SealedError::Decrypt)?;
    Aes256Gcm::new_from_slice(&key)
        .map_err(|_| SealedError::Decrypt)?
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| SealedError::Decrypt)
}

/// Used by tests and by a Controller; the Machine only opens.
pub fn seal(recipient_x25519: &[u8; 32], plaintext: &[u8]) -> Result<String, SealedError> {
    let ephemeral = StaticSecret::random_from_rng(OsRng);
    let public = XPublicKey::from(&ephemeral);
    let shared = ephemeral.diffie_hellman(&XPublicKey::from(*recipient_x25519));
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(public.as_bytes());
    salt.extend_from_slice(recipient_x25519);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes())
        .expand(INFO, &mut key)
        .map_err(|_| SealedError::Decrypt)?;
    let mut nonce = [0u8; NONCE];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| SealedError::Decrypt)?
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| SealedError::Decrypt)?;
    let mut out = Vec::with_capacity(EPK + NONCE + ciphertext.len());
    out.extend_from_slice(public.as_bytes());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(to_base64url(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_sealed_to_a_machine_opens_with_its_identity() {
        let seed = [7u8; 32];
        let public = VerifyingKey::from(&SigningKey::from_bytes(&seed)).to_bytes();
        let boxed = box_public(&public).expect("box public");
        let sealed = seal(&boxed, b"sk-test").expect("seal");
        assert_eq!(open(&seed, &sealed).expect("open"), b"sk-test");
    }

    #[test]
    fn another_machine_cannot_open_it() {
        let seed = [7u8; 32];
        let public = VerifyingKey::from(&SigningKey::from_bytes(&seed)).to_bytes();
        let sealed = seal(&box_public(&public).expect("box public"), b"sk-test").expect("seal");
        assert!(open(&[8u8; 32], &sealed).is_err());
    }

    #[test]
    fn a_key_sealed_by_the_controller_opens_in_rust() {
        let seed = [7u8; 32];
        // Produced by `sealFor` with the same seed's Ed25519 public key.
        let sealed = "m0StehZqGCnEgevxiGdyLzh-XHXf_j5b6csAywiwD17PUx7BoP_4xSQP-kHZQ-LB6nUGFOH8522WIij-HSck7TeEzg";
        assert_eq!(open(&seed, sealed).expect("open"), b"sk-test");
    }
}
