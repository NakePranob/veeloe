//! Whether this Machine can run the OS sandbox at all, said before the
//! supervisor starts anything (ADR 0008, 0069; issue #46).
//!
//! A Machine without `bwrap` or with user namespaces turned off cannot start a
//! worker, and a worker that cannot be wrapped is never started (ADR 0069). The
//! old behaviour stopped there, with no word about what was missing. This module
//! names the missing program or the exact file and value that refuses, and the
//! fix that does not turn a protection off for the whole Machine.
//!
//! Every check goes through [`Probe`], so the answers are the Machine's on a
//! real start and a test's when it is one: no test reads the host's `PATH` or
//! `/proc`.

use std::path::Path;

/// The file Ubuntu 24.04 and later use to restrict unprivileged user
/// namespaces to programs with an AppArmor profile. `1` means restricted.
pub const APPARMOR_RESTRICT: &str = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/// The file Debian uses for the same rule. `0` means unprivileged user
/// namespaces are off.
pub const USERNS_CLONE: &str = "/proc/sys/kernel/unprivileged_userns_clone";

/// Where macOS keeps the sandbox wrapper, read-only and outside the Agent's
/// folder (ADR 0008).
pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// Where the distribution names itself. Never guessed beyond this file: a name
/// that is not here gets the generic instruction, not a wrong package manager.
const OS_RELEASE: &str = "/etc/os-release";

/// The two systems this Runtime has a sandbox for. A system that is neither is
/// refused elsewhere: no sandbox, no worker (ADR 0008, 0069).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    MacOs,
}

impl Platform {
    /// The system this binary runs on, or `None` where there is no sandbox yet.
    pub fn current() -> Option<Self> {
        #[cfg(target_os = "macos")]
        {
            Some(Self::MacOs)
        }
        #[cfg(target_os = "linux")]
        {
            Some(Self::Linux)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            None
        }
    }
}

/// What the preflight may ask the Machine. The real start reads the system; a
/// test answers from a table, so a Linux-only state can be checked on macOS.
pub trait Probe {
    /// Whether `bwrap` is an executable file on `PATH`, the same lookup the
    /// supervisor's own `Wrap` will need.
    fn has_bwrap(&self) -> bool;
    /// Whether [`SANDBOX_EXEC`] is an executable file.
    fn has_sandbox_exec(&self) -> bool;
    /// A sysctl's contents, trimmed, or `None` when the file cannot be read.
    fn read_sysctl(&self, path: &str) -> Option<String>;
    /// `/etc/os-release`, for the install command only.
    fn os_release(&self) -> Option<String>;
}

/// The Machine itself.
pub struct SystemProbe;

impl Probe for SystemProbe {
    fn has_bwrap(&self) -> bool {
        std::env::var("PATH")
            .map(|path| on_path(&path, "bwrap"))
            .unwrap_or(false)
    }

    fn has_sandbox_exec(&self) -> bool {
        executable(Path::new(SANDBOX_EXEC))
    }

    fn read_sysctl(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(path)
            .ok()
            .map(|value| value.trim().to_string())
    }

    fn os_release(&self) -> Option<String> {
        std::fs::read_to_string(OS_RELEASE).ok()
    }
}

/// Check this Machine before the supervisor starts its Hub link or a worker.
/// `Ok(())` says nothing on a Machine that can run the sandbox; an `Err` is the
/// whole message the CLI prints before it exits non-zero.
///
/// The `worker` mode never calls this: a worker already runs inside the sandbox
/// (ADR 0069), and the supervisor is the one that must not start without one.
pub fn check_this_system() -> Result<(), String> {
    match Platform::current() {
        // A system with no sandbox has no worker to start either; the wrap
        // refuses it on its own, and there is nothing to install here.
        None => Ok(()),
        Some(platform) => check(platform, &SystemProbe),
    }
}

/// The same check for a named system and an injected [`Probe`].
pub fn check(platform: Platform, probe: &dyn Probe) -> Result<(), String> {
    match platform {
        Platform::Linux => check_linux(probe),
        Platform::MacOs => check_macos(probe),
    }
}

fn check_linux(probe: &dyn Probe) -> Result<(), String> {
    // Without the wrapper nothing else matters: this is the first thing a
    // Linux Machine installs, and the other two checks only make `bwrap` fail.
    if !probe.has_bwrap() {
        return Err(missing_bwrap(probe.os_release().as_deref()));
    }
    // Ubuntu 24.04's AppArmor rule: restricted user namespaces, unless the
    // program has a profile. Turning the sysctl off machine-wide would be the
    // wrong fix, so the message names the profile instead (ADR 0069).
    if value(probe, APPARMOR_RESTRICT).as_deref() == Some("1") {
        return Err(apparmor_restricted());
    }
    // Debian's older switch, off means no unprivileged user namespace at all.
    if value(probe, USERNS_CLONE).as_deref() == Some("0") {
        return Err(userns_clone_off());
    }
    Ok(())
}

fn check_macos(probe: &dyn Probe) -> Result<(), String> {
    if probe.has_sandbox_exec() {
        return Ok(());
    }
    Err(format!(
        "the OS sandbox cannot start: {SANDBOX_EXEC} is missing or not an executable file.\n\
         It ships with macOS, so repair macOS (or restore the file from a backup) before starting the Runtime:\n\
         without it no worker can run in the sandbox."
    ))
}

/// A sysctl's value, with the newline a `/proc` file ends in removed. An empty
/// or unreadable file is `None`: an absent rule is not a refusal.
fn value(probe: &dyn Probe, path: &str) -> Option<String> {
    probe
        .read_sysctl(path)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The distribution families whose package managers this message can name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Apt,
    Dnf,
    Pacman,
    Unknown,
}

/// `bubblewrap` where this family installs it. Only the family `/etc/os-release`
/// names gets a command; anything else gets the package name, not a guess.
fn install_line(os_release: Option<&str>) -> &'static str {
    match family(os_release) {
        Family::Apt => "  sudo apt install bubblewrap",
        Family::Dnf => "  sudo dnf install bubblewrap",
        Family::Pacman => "  sudo pacman -S bubblewrap",
        Family::Unknown => {
            "  install the bubblewrap package with your distribution's package manager"
        }
    }
}

fn missing_bwrap(os_release: Option<&str>) -> String {
    format!(
        "the OS sandbox needs bubblewrap, but bwrap is not on PATH.\n\
         Install it, then start the Runtime again:\n{}",
        install_line(os_release)
    )
}

fn apparmor_restricted() -> String {
    format!(
        "the OS sandbox cannot start: {APPARMOR_RESTRICT} is 1, so this kernel restricts unprivileged user namespaces (Ubuntu 24.04 and later).\n\
         Fix it for bubblewrap only, not for the whole machine: install an AppArmor profile that lets /usr/bin/bwrap create user namespaces.\n\
         Ubuntu ships one as bwrap-userns-restrict:\n\
         \x20 sudo cp /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/\n\
         \x20 sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict\n\
         Do not set kernel.apparmor_restrict_unprivileged_userns=0: that removes the protection for every program, not just the sandbox."
    )
}

fn userns_clone_off() -> String {
    format!(
        "the OS sandbox cannot start: {USERNS_CLONE} is 0, so unprivileged user namespaces are off.\n\
         Set the file to 1, now and after a reboot:\n\
         \x20 sudo sysctl -w kernel.unprivileged_userns_clone=1\n\
         \x20 echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/99-veeloe-userns.conf"
    )
}

/// The family named by `ID`/`ID_LIKE`, lowercased and without quotes. A name
/// not in these lists is `Unknown`: the Runtime never guesses a package
/// manager, because the wrong command is worse than a general one.
fn family(os_release: Option<&str>) -> Family {
    let Some(text) = os_release else {
        return Family::Unknown;
    };
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        if key != "ID" && key != "ID_LIKE" {
            continue;
        }
        let value = value.trim().trim_matches('"').trim_matches('\'');
        names.extend(
            value
                .split_whitespace()
                .map(|name| name.to_ascii_lowercase()),
        );
    }
    let has = |family: &[&str]| names.iter().any(|name| family.contains(&name.as_str()));
    if has(&[
        "debian",
        "ubuntu",
        "linuxmint",
        "pop",
        "elementary",
        "raspbian",
    ]) {
        Family::Apt
    } else if has(&[
        "fedora",
        "rhel",
        "centos",
        "rocky",
        "almalinux",
        "ol",
        "amzn",
    ]) {
        Family::Dnf
    } else if has(&["arch", "archlinux", "manjaro", "endeavouros"]) {
        Family::Pacman
    } else {
        Family::Unknown
    }
}

/// `tool` as the first executable file in one of `path`'s folders, the lookup
/// the supervisor's `PATH` needs for the bare `bwrap` it passes to workers.
fn on_path(path: &str, tool: &str) -> bool {
    path.split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(tool))
        .any(|candidate| executable(&candidate))
}

fn executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Machine described by a table, so every OS state is testable from one.
    struct Fake {
        bwrap: bool,
        sandbox_exec: bool,
        files: Vec<(&'static str, &'static str)>,
        os_release: Option<&'static str>,
    }

    impl Fake {
        fn linux() -> Self {
            Self {
                bwrap: true,
                sandbox_exec: false,
                files: vec![(APPARMOR_RESTRICT, "0\n"), (USERNS_CLONE, "1\n")],
                os_release: Some("ID=ubuntu\nID_LIKE=debian\n"),
            }
        }

        fn macos() -> Self {
            Self {
                bwrap: false,
                sandbox_exec: true,
                files: Vec::new(),
                os_release: None,
            }
        }

        fn with(mut self, path: &'static str, value: &'static str) -> Self {
            self.files.retain(|(name, _)| *name != path);
            self.files.push((path, value));
            self
        }

        fn os_release(mut self, text: &'static str) -> Self {
            self.os_release = Some(text);
            self
        }
    }

    impl Probe for Fake {
        fn has_bwrap(&self) -> bool {
            self.bwrap
        }

        fn has_sandbox_exec(&self) -> bool {
            self.sandbox_exec
        }

        fn read_sysctl(&self, path: &str) -> Option<String> {
            self.files
                .iter()
                .find(|(name, _)| *name == path)
                .map(|(_, value)| value.to_string())
        }

        fn os_release(&self) -> Option<String> {
            self.os_release.map(str::to_string)
        }
    }

    fn linux(probe: &Fake) -> Result<(), String> {
        check(Platform::Linux, probe)
    }

    fn macos(probe: &Fake) -> Result<(), String> {
        check(Platform::MacOs, probe)
    }

    #[test]
    fn linux_without_bwrap_names_the_package_and_the_install_command() {
        let probe = Fake {
            bwrap: false,
            ..Fake::linux()
        }
        .with(APPARMOR_RESTRICT, "1\n");
        let message = linux(&probe).expect_err("bwrap is missing");
        assert!(message.contains("bwrap is not on PATH"), "{message}");
        assert!(message.contains("bubblewrap"), "{message}");
        assert!(message.contains("sudo apt install bubblewrap"), "{message}");
        // The namespace rules are not the first fix when there is no wrapper.
        assert!(!message.contains(APPARMOR_RESTRICT), "{message}");
    }

    #[test]
    fn the_install_command_follows_os_release_and_never_guesses() {
        let fedora = Fake {
            bwrap: false,
            ..Fake::linux()
        }
        .os_release("ID=fedora\n");
        assert!(linux(&fedora)
            .expect_err("no bwrap")
            .contains("sudo dnf install bubblewrap"));

        let arch = Fake {
            bwrap: false,
            ..Fake::linux()
        }
        .os_release("ID=arch\nID_LIKE=archlinux\n");
        assert!(linux(&arch)
            .expect_err("no bwrap")
            .contains("sudo pacman -S bubblewrap"));

        let unknown = Fake {
            bwrap: false,
            ..Fake::linux()
        }
        .os_release("ID=nixos\n");
        let message = linux(&unknown).expect_err("no bwrap");
        assert!(
            message.contains("distribution's package manager"),
            "{message}"
        );
        for guessed in ["apt ", "dnf ", "pacman "] {
            assert!(!message.contains(guessed), "{guessed}: {message}");
        }
    }

    #[test]
    fn linux_with_restricted_user_namespaces_names_the_file_and_the_bwrap_only_fix() {
        let probe = Fake::linux().with(APPARMOR_RESTRICT, "1\n");
        let message = linux(&probe).expect_err("user namespaces are restricted");
        assert!(message.contains(APPARMOR_RESTRICT), "{message}");
        assert!(message.contains("is 1"), "{message}");
        assert!(message.contains("bwrap-userns-restrict"), "{message}");
        assert!(message.contains("apparmor_parser"), "{message}");
        assert!(message.contains("not for the whole machine"), "{message}");
        // The other switch is not what refuses here, and the message is one fix.
        assert!(!message.contains(USERNS_CLONE), "{message}");
    }

    #[test]
    fn linux_with_user_namespaces_off_names_the_file_and_the_value_to_set() {
        let probe = Fake::linux().with(USERNS_CLONE, "0\n");
        let message = linux(&probe).expect_err("user namespaces are off");
        assert!(message.contains(USERNS_CLONE), "{message}");
        assert!(message.contains("is 0"), "{message}");
        assert!(
            message.contains("sysctl -w kernel.unprivileged_userns_clone=1"),
            "{message}"
        );
    }

    #[test]
    fn a_linux_machine_that_can_run_the_sandbox_is_ready() {
        assert_eq!(linux(&Fake::linux()), Ok(()));
        // An older kernel has neither file; an absent rule is not a refusal.
        let older = Fake {
            files: Vec::new(),
            ..Fake::linux()
        };
        assert_eq!(linux(&older), Ok(()));
    }

    #[test]
    fn macos_without_sandbox_exec_says_which_file_is_missing() {
        let probe = Fake {
            sandbox_exec: false,
            ..Fake::macos()
        };
        let message = macos(&probe).expect_err("sandbox-exec is missing");
        assert!(message.contains(SANDBOX_EXEC), "{message}");
        assert!(message.contains("executable file"), "{message}");
    }

    #[test]
    fn a_macos_machine_that_can_run_the_sandbox_is_ready() {
        assert_eq!(macos(&Fake::macos()), Ok(()));
    }
}
