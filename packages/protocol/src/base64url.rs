use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// Keys, signatures and nonces travel as base64url without padding.
pub fn to_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Strictly base64url without padding: no `=`, no `+`, no `/`, and no length
/// that could only come from a truncated group.
pub fn from_base64url(text: &str) -> Result<Vec<u8>, Base64UrlError> {
    if !text
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(Base64UrlError);
    }
    if text.len() % 4 == 1 {
        return Err(Base64UrlError);
    }
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| Base64UrlError)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("not base64url")]
pub struct Base64UrlError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for bytes in [vec![], vec![0], vec![0, 1, 2], vec![255; 32]] {
            assert_eq!(from_base64url(&to_base64url(&bytes)).unwrap(), bytes);
        }
    }

    #[test]
    fn rejects_anything_but_unpadded_base64url() {
        for text in ["=", "a=", "ab==", "a+b", "a/b", "a b", "a"] {
            assert!(from_base64url(text).is_err(), "{text}");
        }
    }
}
