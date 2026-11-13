//! The supervisor process: hub-link, trust, provider key custody and worker
//! lifecycle (ADR 0020, 0042). The port fills this in one service at a time.

pub mod agents;
pub mod providers;
pub mod egress;
pub mod help;
pub mod hub_link;
pub mod json_file;
pub mod pair;
pub mod proxy;
pub mod push;
pub mod push_tokens;
pub mod service;
pub mod tasks;
pub mod toolchain;
pub mod uploads;
pub mod task_routes;
pub mod trust;
pub mod usage;
pub mod workers;
pub mod llm;
pub mod logs;
pub mod memory;
pub mod models;
pub mod status;
