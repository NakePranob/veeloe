//! The rules a worker's commands run under, from
//! `packages/runtime-legacy/src/supervisor/sandbox/sandbox.ts`.
//!
//! This module only builds the rules; starting a worker inside them is task 4.4.
//! Two shapes, because the two systems say it differently: an SBPL profile for
//! macOS `sandbox-exec`, and arguments for Linux `bwrap`.

use std::path::Path;

/// What one Agent's commands may touch. Every field is absolute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    /// The Agent's own folder: the only place it may write. It holds the Task
    /// log, the Workdir and the TMPDIR.
    pub folder: String,
    /// Where a command starts.
    pub workdir: String,
    /// Its own TMPDIR, inside the folder, so a cache lands there too.
    pub tmp: String,
    /// The folder the worker binary lives in, read only.
    pub bin: String,
    /// The domains the Machine allows (ADR 0008, 0029). Empty lets nothing out.
    pub egress: Vec<String>,
    /// The local proxy every command reaches the network through, as
    /// `127.0.0.1:PORT`. Without one, nothing gets out: a domain list the
    /// kernel cannot check is not a rule (ADR 0008, 0029).
    pub proxy: Option<u16>,
    /// Paths never read, whatever else says otherwise: the owner's home and the
    /// places a secret usually sits.
    pub deny_read: Vec<String>,
}

/// Secrets no Agent reads, under the home of the user running the Runtime.
/// Fixed in code, one list, as `packages/runtime-legacy/src/supervisor/sandbox/sandbox.ts`.
/// A path that is not there is listed anyway, so it is covered if it appears.
pub const SECRET_PATHS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".config/gcloud",
    ".kube",
    ".docker",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".git-credentials",
    ".config/gh",
    ".password-store",
    "Library/Keychains",
    // shell and REPL history
    ".bash_history",
    ".zsh_history",
    ".zsh_sessions",
    ".local/share/fish",
    ".python_history",
    ".node_repl_history",
    ".psql_history",
    ".mysql_history",
    // browser profiles
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Chromium",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Microsoft Edge",
    "Library/Application Support/Arc",
    "Library/Application Support/Firefox",
    "Library/Safari",
    "Library/Cookies",
    ".config/google-chrome",
    ".config/chromium",
    ".config/BraveSoftware",
    ".config/microsoft-edge",
    ".mozilla",
];

impl Policy {
    /// `home` is the home of the user running the Runtime, and `runtime_home`
    /// is `VEELOE_HOME`: the folder holding the Machine key, the Providers and
    /// every Agent's folder.
    pub fn new(
        workdir: &Path,
        tmp: &Path,
        bin: &Path,
        egress: Vec<String>,
        home: &Path,
        runtime_home: &Path,
    ) -> Self {
        // The kernel sees the real path, so a `/var` that is really `/private/var`
        // must be written as the real one or the rule never matches.
        let workdir = real(workdir);
        let tmp = real(tmp);
        let bin = real(bin);
        let home = real(home);
        let runtime_home = real(runtime_home);
        let workdir = workdir.as_path();
        let tmp = tmp.as_path();
        let bin = bin.as_path();
        let home = home.as_path();
        let runtime_home = runtime_home.as_path();
        // The Runtime's own folder holds the Machine key, the Providers and
        // every other Agent's Task log. It is not readable, and neither is a
        // secret under the owner's home. Everything else on the Machine is, as
        // a Turn of the Owner may (ADR 0008).
        let mut deny_read = vec![runtime_home.to_string_lossy().to_string()];
        for name in SECRET_PATHS {
            deny_read.push(home.join(name).to_string_lossy().to_string());
        }
        let folder = workdir
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
            .unwrap_or_else(|| workdir.to_string_lossy().to_string());
        Self {
            folder,
            workdir: workdir.to_string_lossy().to_string(),
            tmp: tmp.to_string_lossy().to_string(),
            bin: bin.to_string_lossy().to_string(),
            egress,
            proxy: None,
            deny_read,
        }
    }
}

/// The SBPL profile `sandbox-exec -p` takes on macOS: nothing by default, then
/// exactly what the Policy names.
pub fn sandbox_exec_profile(policy: &Policy) -> String {
    let mut profile = String::from("(version 1)\n(deny default)\n");
    profile.push_str("(allow process*)\n(allow sysctl-read)\n(allow mach-lookup)\n");
    // Read everything, then take the secrets back: in SBPL the last matching
    // rule wins, so a blanket allow must come before the denies.
    profile.push_str("(allow file-read*)\n");
    for path in &policy.deny_read {
        profile.push_str(&format!("(deny file-read* (subpath {}))\n", quote(path)));
    }
    // The Agent's own folder is inside the owner's home, so it is read again
    // after that deny: the later rule wins.
    for path in [&policy.folder, &policy.bin] {
        profile.push_str(&format!("(allow file-read* (subpath {}))\n", quote(path)));
    }
    // `deny default` already refuses every other write, so these two lines are
    // the whole of what a command may change.
    profile.push_str(&format!(
        "(allow file-write* (subpath {}))\n",
        quote(&policy.folder)
    ));
    // Every command needs to be able to throw output away.
    profile.push_str("(allow file-write* (literal \"/dev/null\"))\n");
    profile.push_str("(deny network*)\n");
    // Seatbelt cannot match a domain, so the only way out is the local proxy;
    // the proxy is what checks the Egress (ADR 0008, 0029).
    if let Some(port) = policy.proxy {
        profile.push_str(&format!(
            "(allow network-outbound (remote ip \"localhost:{port}\"))\n"
        ));
    }
    profile
}

/// The arguments `bwrap` takes on Linux for the same Policy.
pub fn bwrap_args(policy: &Policy) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--unshare-all".into(),
        "--die-with-parent".into(),
        "--ro-bind".into(),
        "/usr".into(),
        "/usr".into(),
        "--ro-bind".into(),
        "/bin".into(),
        "/bin".into(),
        "--ro-bind".into(),
        "/lib".into(),
        "/lib".into(),
        "--ro-bind".into(),
        "/lib64".into(),
        "/lib64".into(),
    ];
    // Denied paths first, then the folders the Agent may read and write: a bind
    // after the /dev/null would put the folder back.
    for path in &policy.deny_read {
        args.push("--ro-bind".into());
        args.push("/dev/null".into());
        args.push(path.clone());
    }
    args.extend([
        "--ro-bind".into(),
        policy.bin.clone(),
        policy.bin.clone(),
        "--bind".into(),
        policy.folder.clone(),
        policy.folder.clone(),
        "--chdir".into(),
        policy.workdir.clone(),
        "--proc".into(),
        "/proc".into(),
        "--dev".into(),
        "/dev".into(),
    ]);
    // `--unshare-all` gives the command its own network namespace with no
    // loopback route to the supervisor's proxy, so on Linux this denies every
    // egress for now. Wiring the proxy into the namespace is follow-up work;
    // until then Linux fails closed rather than claiming Egress parity.
    args
}

/// The real path, or the one given when it does not exist yet.
fn real(path: &Path) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// An SBPL string literal: quotes and backslashes escaped, everything else as is.
fn quote(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Runs a command inside the rules. On macOS that is `sandbox-exec -p`; on
/// Linux, `bwrap`. Nothing else about the command changes.
pub struct Sandbox {
    policy: Policy,
}

impl Sandbox {
    pub fn new(policy: Policy) -> Self {
        Self { policy }
    }

    pub fn policy(&self) -> &Policy {
        &self.policy
    }

    /// The whole argv to run: the wrapper, its rules, then the command.
    pub fn wrap(&self, command: &[String]) -> Vec<String> {
        wrap_for(&self.policy, command)
    }
}

#[cfg(target_os = "macos")]
fn wrap_for(policy: &Policy, command: &[String]) -> Vec<String> {
    let mut argv = vec![
        "/usr/bin/sandbox-exec".to_string(),
        "-p".to_string(),
        sandbox_exec_profile(policy),
    ];
    argv.extend(command.iter().cloned());
    argv
}

#[cfg(target_os = "linux")]
fn wrap_for(policy: &Policy, command: &[String]) -> Vec<String> {
    let mut argv = bwrap_args(policy);
    argv.push("--".to_string());
    argv.extend(command.iter().cloned());
    argv
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn wrap_for(_policy: &Policy, command: &[String]) -> Vec<String> {
    // No sandbox on this system yet: the command runs as it is, and the caller
    // must say so rather than pretend.
    command.to_vec()
}
