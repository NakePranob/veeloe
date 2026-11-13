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
    /// The Agent's own folder: the only place it may write. It holds the
    /// Workdir, the TMPDIR and the Agent's own home. The Task log is **not**
    /// here: the supervisor keeps it at `<home>/task-logs/<id>`, outside what a
    /// command inside this folder can write (ADR 0069).
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
    /// The proxy's Unix socket on the Machine, which `bwrap` binds into the
    /// network namespace at [`PROXY_SOCKET`]. Linux has no loopback route to
    /// the supervisor, so this file is the one way out; macOS has no namespace
    /// and ignores it (ADR 0069).
    pub proxy_socket: Option<String>,
    /// The localhost ports this Agent owns and no other Agent does. macOS has
    /// no network namespace to give a worker, so its localhost is a range: the
    /// profile allows these ports in and out, and nothing else on the Machine
    /// (ADR 0069). Empty means the Agent may listen on nothing.
    pub ports: Vec<u16>,
}

/// Where the proxy's Unix socket appears inside a Linux worker's namespace: a
/// fixed path, under the `/run` only this namespace has. The worker's bridge
/// listens on loopback and forwards to it, so a command reaches the network
/// through the supervisor and nowhere else (ADR 0069).
pub const PROXY_SOCKET: &str = "/run/veeloe/egress.sock";

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
    // The vendor installers, python.org among them, put a toolchain here and
    // the binary it installs links against it. Which layout a Machine has is
    // not the Agent's problem.
    "/Library/Frameworks",
    "/Library/Python",
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

/// The macOS system services a worker may look up, each named one by one, with
/// where the need comes from (ADR 0069). A blanket `(allow mach-lookup)` is a
/// way out of every file rule: a service accepts requests a path cannot.
///
/// A name is only here when a worker or a toolchain asked for it under the
/// narrowed profile (issue #37); a missing name is added from the Runtime log,
/// one at a time, never by opening the profile again.
///
/// What is deliberately **not** here, although the toolchains ask:
/// `com.apple.lsd.modifydb` (it writes the Launch Services database, a way out
/// of the file rules), `com.apple.bsd.dirhelper` (it hands out the owner's
/// per-user folders) and `com.apple.diagnosticd` (it files crash reports that
/// carry the owner's paths).
///
/// A headless browser needed no system service of the owner's session: it
/// runs with its own Mach name only, see [`BROWSER_RENDEZVOUS`] (issue #50).
const MACOS_SERVICES: &[(&str, Reason)] = &[
    // Every toolchain writes its diagnostics through `os_log`; without this the
    // messages vanish, and a broken tool looks like a silent one.
    ("com.apple.logd", Reason::Os),
    // libsystem registers each process with the notification centre while it
    // starts. `bash`, `git`, `bun` and `python3` all ask before they run, so
    // denying it leaves a refusal on every command for nothing.
    ("com.apple.system.notification_center", Reason::Os),
    // Every process asks who it is running as while it starts; `bash` and
    // `git` do it before they read a single file.
    ("com.apple.system.opendirectoryd.libinfo", Reason::Os),
    // `git` checks group membership to decide who owns a repository, so a
    // checkout it is allowed to read is not refused as someone else's.
    ("com.apple.system.opendirectoryd.membership", Reason::Toolchain),
];

/// The one Mach name a headless browser registers for the processes it starts.
/// The browser puts its own pid in the name
/// (`<bundle>.MachPortRendezvousServer.<pid>`), so it cannot be written as a
/// literal service name; the profile matches only that shape, under the two
/// bundles' own namespaces. The rules are profile-wide, so every sandboxed
/// command gets this name shape (not only the browser), and the Mach namespace
/// is machine-wide: another sandboxed process can squat a same-shape name of a
/// different instance. The names are pid-suffixed and guessable, so this is a
/// narrow cross-instance channel, not a claim that nothing else is reachable.
///
/// Measured on macOS 27 with `chrome-headless-shell` 156 under this profile
/// (issue #50): with these two rules the browser prints a page's DOM, and every
/// `com.apple.*` lookup it still makes (`diagnosticd`, `windowserver.active`,
/// `tccd.system`, `pasteboard.1`) is refused and not needed for that. The full
/// `/Applications/Google Chrome.app` does not run headless here: it registers
/// with Launch Services and opens a real window, so it asks for the owner's
/// `windowserver.active`, `CARenderServer`, `windowmanager.server` and
/// `tccd.system` — services of the owner's GUI session, which stay refused
/// (ADR 0069). An Agent's browser therefore lives in the Agent's own folder,
/// not in `/Applications`.
const BROWSER_RENDEZVOUS: &[(&str, Reason)] = &[
    ("com.google.Chrome", Reason::Browser),
    ("org.chromium.Chromium", Reason::Browser),
];

/// Where an allowed service is needed, so the next person can tell a
/// requirement from an accident (issue #37). Three sources exist today: the OS
/// the process runs on, a toolchain a Task cannot be done without, and a
/// headless browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// A toolchain a Task cannot be done without: `git`, `node`, `bun`, `python3`.
    Toolchain,
    /// What the OS itself needs under the rules, for the process to run at all.
    Os,
    /// A Mach name a browser registers and looks up for its own child
    /// processes, measured from the system log under this profile rather than
    /// guessed (issue #50).
    Browser,
}

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
            proxy_socket: None,
            ports: Vec::new(),
        }
    }
}

/// The SBPL profile `sandbox-exec -p` takes on macOS: nothing by default, then
/// exactly what the Policy names.
pub fn sandbox_exec_profile(policy: &Policy) -> String {
    let mut profile = String::from("(version 1)\n(deny default)\n");
    profile.push_str("(allow process*)\n(allow sysctl-read)\n");
    // A Stop, a timeout or a cancel ends the command by signal. Only what this
    // sandbox started can be signalled: the supervisor and another Agent are
    // outside it (ADR 0008, 0017, 0069).
    profile.push_str("(allow signal (target same-sandbox))\n");
    // Named one by one: what is not here is refused, and the refusal is what
    // the Runtime log shows when a tool needs a service a Task cannot run
    // without (issue #37). An empty list says nothing at all, because
    // `(allow mach-lookup)` with no name allows every service on the Machine.
    if !MACOS_SERVICES.is_empty() {
        profile.push_str("(allow mach-lookup\n");
        for (service, _) in MACOS_SERVICES {
            profile.push_str(&format!("  (global-name {})\n", quote(service)));
        }
        profile.push_str(")\n");
    }
    // The browser's own rendezvous name, the one thing a headless browser
    // cannot run without: it registers the name for its children and the
    // children look it up. Matched by shape because the pid is in it, and only
    // within the browsers' own namespaces (issue #50).
    if !BROWSER_RENDEZVOUS.is_empty() {
        let names = BROWSER_RENDEZVOUS
            .iter()
            .map(|(prefix, _)| prefix.replace('.', "\\."))
            .collect::<Vec<_>>()
            .join("|");
        let name = format!("(global-name-regex #\"^({names})\\.MachPortRendezvousServer\\.[0-9]+$\")");
        profile.push_str(&format!("(allow mach-register {name})\n"));
        profile.push_str(&format!("(allow mach-lookup {name})\n"));
    }
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
    // The Agent's own localhost, one port at a time: a dev server, a database
    // and a cache it starts are reachable to it and to nothing else. `local`
    // is a bind, `remote` is a connect; a host service on any other port is
    // refused by the deny above (ADR 0069).
    if !policy.ports.is_empty() {
        profile.push_str("(allow network-inbound\n");
        for port in &policy.ports {
            profile.push_str(&format!("  (local ip \"localhost:{port}\")\n"));
        }
        profile.push_str(")\n");
        profile.push_str("(allow network-outbound\n");
        for port in &policy.ports {
            profile.push_str(&format!("  (remote ip \"localhost:{port}\")\n"));
        }
        profile.push_str(")\n");
    }
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
    // `--unshare-all` gives the command its own network namespace. Its loopback
    // is up, so a dev server, a database and the tests beside them work and
    // nothing outside the namespace answers. The one way out is the proxy's
    // Unix socket, bound in at a fixed path: the worker's bridge forwards
    // `HTTP_PROXY` there and the proxy checks the Egress on every connection
    // (ADR 0069). Without a socket the namespace has no route out at all.
    if let Some(socket) = &policy.proxy_socket {
        args.extend(["--dir".into(), "/run".into()]);
        args.extend(["--dir".into(), "/run/veeloe".into()]);
        args.extend(["--bind".into(), socket.clone(), PROXY_SOCKET.into()]);
    }
    args
}

/// The real path, or the one given when it does not exist yet.
fn real(path: &Path) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// The services the profile allows, with the reason each is there. A test picks
/// a name to ask for that the list does not hold, so the refusal it checks is
/// the profile's and not a service that happens to be absent (issue #37).
/// The literal service names only; the browser's pid-suffixed rendezvous names
/// live in [`BROWSER_RENDEZVOUS`] and are not part of this list.
pub fn allowed_services() -> &'static [(&'static str, Reason)] {
    MACOS_SERVICES
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
