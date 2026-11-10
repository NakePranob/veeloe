use ed25519_dalek::{Signature, Signer as _, SigningKey, VerifyingKey};
use rand_core::OsRng;

use crate::base64url::{from_base64url, to_base64url};

/// A new Ed25519 secret key: the 32-byte RFC 8032 seed, from the OS CSPRNG.
///
/// The Controller's keystore keeps a key made here rather than making one in
/// Dart, so a key is born in the same crate as the rules that use it (ADR 0012).
pub fn generate_secret_key() -> [u8; 32] {
    SigningKey::generate(&mut OsRng).to_bytes()
}

pub fn public_key_of(secret_key: &[u8; 32]) -> [u8; 32] {
    *SigningKey::from_bytes(secret_key).verifying_key().as_bytes()
}

pub fn public_key_base64url(secret_key: &[u8; 32]) -> String {
    to_base64url(&public_key_of(secret_key))
}

pub fn sign(secret_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
    SigningKey::from_bytes(secret_key).sign(message).to_bytes()
}

pub fn sign_base64url(secret_key: &[u8; 32], message: &[u8]) -> String {
    to_base64url(&sign(secret_key, message))
}

/// False, never a throw, for a malformed key or signature.
pub fn verify_signature(signature: &str, message: &[u8], public_key: &str) -> bool {
    let signature = match from_base64url(signature) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let key = match from_base64url(public_key) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let key: [u8; 32] = match key.as_slice().try_into() {
        Ok(key) => key,
        Err(_) => return false,
    };
    let verifying_key = match VerifyingKey::from_bytes(&key) {
        Ok(key) => key,
        Err(_) => return false,
    };
    let signature = match Signature::from_slice(&signature) {
        Ok(signature) => signature,
        Err(_) => return false,
    };
    verifying_key.verify_strict(message, &signature).is_ok()
}
