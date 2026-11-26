//! The first-party tools a worker offers the model: a shell in the Workdir, and
//! the files inside it, then Memory itself, and one web page under the Egress.

pub mod bash;
pub mod files;
pub mod memory;
pub mod web_fetch;
