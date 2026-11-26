//! One module per Hub message the Machine answers (ADR 0071). `tasks::dispatch`
//! routes each kind here; a handler never uses another handler.

pub(crate) mod agent_config;
pub(crate) mod egress_set;
pub(crate) mod file_transfer;
pub(crate) mod machine_status;
pub(crate) mod memory_get;
pub(crate) mod provider_add;
pub(crate) mod push_register;
pub(crate) mod shared;
pub(crate) mod task_message;
pub(crate) mod trigger;
pub(crate) mod usage_list;
