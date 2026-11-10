//! The Veeloe wire protocol, in Rust.
//!
//! `packages/protocol-legacy` is the TypeScript reference and the shared vector
//! source until the Rust implementation replaces it. A wire change lands in
//! both, in the same commit.

pub mod allowlist;
pub mod base64url;
pub mod backoff;
pub mod certificate;
pub mod crypto;
pub mod envelope;
pub mod frame;
pub mod hub_auth;
pub mod linking;
pub mod messages;
pub mod pairing;
pub mod sealed;
pub mod signer;
pub mod uri;

pub use allowlist::{
    entry_covers, is_unsafe_command, matches_allowlist, split_command, ALLOWLIST_MAX,
    READ_ONLY_ALLOWLIST,
};
pub use envelope::{
    verify, Envelope, MemorySeenSequences, Rejection, Route, SeenSequences, SignedPart, Verified,
};
pub use signer::{Outgoing, Signer};
