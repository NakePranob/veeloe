//! The rules a worker runs under, and everything it starts with it (ADR 0008,
//! 0068, 0069). Two shapes, because the two systems say it differently: an SBPL
//! profile for macOS `sandbox-exec`, and arguments for Linux `bwrap`.
//!
//! Reads are an allow-list on both: what is not named here is not seen, so the
//! owner's home, `VEELOE_HOME` and every other Agent's folder need no rule.

use std::path::Path;

/// What one Agent may touch. Every field is absolute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    /// The Agent's own folder: the only place it may write. It holds the Task
    /// log, the Workdir, the TMPDIR and the Agent's own home.
    pub folder: String,
    /// Where a command starts.
    pub workdir: String,
    /// Its own TMPDIR, inside the folder, so a cache lands there too.
    pub tmp: String,
    /// The folder the worker binary lives in, read only.
    pub bin: String,
    /// The port of the local proxy every command reaches the network through;
    /// the proxy is what checks the Egress. Without one, nothing gets out: a
    /// domain list the kernel cannot check is not a rule (ADR 0008, 0029).
    pub proxy: Option<u16>,
}

/// What a program on macOS needs to read to run at all, and the toolchains in
/// the places the OS and its package managers put them. Read only.
const MACOS_READ: &[&str] = &[
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library/Apple",
    "/Library/Preferences",
    "/Library/Developer/CommandLineTools",
    "/private/etc",
    "/private/var/db/dyld",
    "/private/var/db/timezone",
    "/private/var/select",
    "/dev",
    "/opt/homebrew",
    "/usr/local",
];

/// The same on Linux, as read-only binds. A path a distro does not have is
/// skipped (`--ro-bind-try`).
const LINUX_READ: &[&str] = &["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"];

impl Policy {
    /// `workdir` and `tmp` sit in the Agent's folder, which is their parent.
    pub fn new(workdir: &Path, tmp: &Path, bin: &Path) -> Self {
        // The kernel sees the real path, so a `/var` that is really `/private/var`
        // must be written as the real one or the rule never matches.
        let workdir = real(workdir);
        let tmp = real(tmp);
        let bin = real(bin);
        let folder = workdir
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
            .unwrap_or_else(|| workdir.to_string_lossy().to_string());
        Self {
            folder,
            workdir: workdir.to_string_lossy().to_string(),
            tmp: tmp.to_string_lossy().to_string(),
            bin: bin.to_string_lossy().to_string(),
            proxy: None,
        }
    }
}

/// The SBPL profile `sandbox-exec -p` takes on macOS: nothing by default, then
/// exactly what the Policy names.
pub fn sandbox_exec_profile(policy: &Policy) -> String {
    let mut profile = String::from("(version 1)\n(deny default)\n");
    profile.push_str("(allow process*)\n(allow sysctl-read)\n(allow mach-lookup)\n");
    // Walking a path needs its metadata; this gives no file's contents and no
    // folder's listing.
    profile.push_str("(allow file-read-metadata)\n");
    profile.push_str("(allow file-read* (literal \"/\"))\n");
    for path in MACOS_READ {
        profile.push_str(&format!("(allow file-read* (subpath {}))\n", quote(path)));
    }
    // Xcode wherever it was dropped in /Applications, beta included.
    profile.push_str("(allow file-read* (regex #\"^/Applications/Xcode[^/]*\\.app/\"))\n");
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
    let mut args: Vec<String> = vec!["--unshare-all".into(), "--die-with-parent".into()];
    for path in LINUX_READ {
        args.extend(["--ro-bind-try".into(), path.to_string(), path.to_string()]);
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

/// Whether this system has a sandbox at all. Without one no worker starts
/// (ADR 0008, 0069).
pub const AVAILABLE: bool = cfg!(any(target_os = "macos", target_os = "linux"));

/// Runs a command inside the rules. On macOS that is `sandbox-exec -p`; on
/// Linux, `bwrap`. Nothing else about the command changes.
pub struct Sandbox {
    policy: Option<Policy>,
}

impl Sandbox {
    pub fn new(policy: Policy) -> Self {
        Self {
            policy: Some(policy),
        }
    }

    /// For a process already inside a sandbox: what it starts inherits the
    /// rules, and Seatbelt refuses to nest a second one, so nothing is added.
    pub fn inherited() -> Self {
        Self { policy: None }
    }

    pub fn policy(&self) -> Option<&Policy> {
        self.policy.as_ref()
    }

    /// The whole argv to run: the wrapper, its rules, then the command.
    pub fn wrap(&self, command: &[String]) -> Vec<String> {
        match &self.policy {
            Some(policy) => wrap_for(policy, command),
            None => command.to_vec(),
        }
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
    let mut argv = vec!["bwrap".to_string()];
    argv.extend(bwrap_args(policy));
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
