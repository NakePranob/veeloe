//! Task attachments that the Controller sends as `file.chunk` (ADR 0050).
//! Chunks are held in memory only until the whole file matches its declared
//! hash; then the file is moved into the Agent's Workdir.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sha2::{Digest, Sha256};

const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Default)]
struct Upload {
    total: usize,
    seen: Vec<Option<Vec<u8>>>,
    size: usize,
}

#[derive(Debug, Default)]
pub struct Uploads {
    files: Mutex<HashMap<String, Upload>>,
    done: Mutex<HashMap<String, Vec<u8>>>,
}

#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    #[error("bad chunk")]
    BadChunk,
    #[error("file is too large")]
    TooLarge,
    #[error("file hash did not match")]
    Hash,
    #[error("io")]
    Io,
}

impl Uploads {
    /// Add one chunk. Returns the finished bytes once every chunk is present
    /// and the hash matches.
    pub fn add(&self, file: &str, index: usize, total: usize, data: &[u8]) -> Result<Option<Vec<u8>>, UploadError> {
        if total == 0 || index >= total || data.is_empty() {
            return Err(UploadError::BadChunk);
        }
        let mut files = self.files.lock().expect("uploads");
        let upload = files.entry(file.to_string()).or_insert_with(|| Upload {
            total,
            seen: vec![None; total],
            size: 0,
        });
        if upload.total != total {
            return Err(UploadError::BadChunk);
        }
        if upload.seen[index].is_none() {
            upload.size += data.len();
            if upload.size > MAX_FILE_BYTES {
                files.remove(file);
                return Err(UploadError::TooLarge);
            }
            upload.seen[index] = Some(data.to_vec());
        }
        if upload.seen.iter().any(Option::is_none) {
            return Ok(None);
        }
        let bytes: Vec<u8> = upload.seen.iter().flatten().flatten().copied().collect();
        let digest = Sha256::digest(&bytes);
        if veeloe_protocol::base64url::to_base64url(&digest) != file {
            files.remove(file);
            return Err(UploadError::Hash);
        }
        files.remove(file);
        self.done.lock().expect("uploads").insert(file.to_string(), bytes.clone());
        Ok(Some(bytes))
    }

    /// Take a completed upload by the hash the message declared.
    pub fn take(&self, file: &str) -> Option<Vec<u8>> {
        self.done.lock().expect("uploads").remove(file)
    }

    /// Write a completed upload into `workdir/attachments/<task>/<name>`.
    pub fn place(&self, bytes: &[u8], workdir: &Path, task: &str, name: &str) -> Result<PathBuf, UploadError> {
        let dir = workdir.join("attachments").join(task);
        fs::create_dir_all(&dir).map_err(|_| UploadError::Io)?;
        let safe: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
            .collect();
        let path = dir.join(if safe.is_empty() { "file" } else { &safe });
        fs::write(&path, bytes).map_err(|_| UploadError::Io)?;
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use veeloe_protocol::base64url::to_base64url;

    fn hash(bytes: &[u8]) -> String {
        to_base64url(&Sha256::digest(bytes))
    }

    #[test]
    fn chunks_reassemble_only_when_the_hash_matches() {
        let uploads = Uploads::default();
        let bytes = b"hello attachment";
        let file = hash(bytes);
        assert!(uploads.add(&file, 0, 2, &bytes[..5]).expect("chunk").is_none());
        assert_eq!(uploads.add(&file, 1, 2, &bytes[5..]).expect("chunk"), Some(bytes.to_vec()));
    }

    #[test]
    fn a_wrong_hash_is_rejected() {
        let uploads = Uploads::default();
        assert!(uploads.add("not-the-hash", 0, 1, b"hello").is_err());
    }
}
