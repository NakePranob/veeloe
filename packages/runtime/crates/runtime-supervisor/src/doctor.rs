//! `veeloe doctor --fix-apparmor`: installing Veeloe's AppArmor profile so
//! `/usr/bin/bwrap` may create user namespaces on a kernel that restricts them
//! (Ubuntu 24.04 and later; issue #49, ADR 0008, 0069).
//!
//! The profile is ours, not Ubuntu's `bwrap-userns-restrict`: a release is one
//! binary and must not need a file from the repository or from
//! `apparmor-profiles`. It allows `userns` for `/usr/bin/bwrap` only; the sysctl
//! stays at 1 for every other program.
//!
//! Everything the fix touches the Machine with is a [`Host`], so a test can run
//! it on macOS without AppArmor, root or a real `bwrap`.

use std::path::Path;
use std::process::Command;

use veeloe_runtime_core::preflight::{Platform, APPARMOR_PROFILE, APPARMOR_RESTRICT};

/// The same file as `packaging/apparmor/veeloe-bwrap`, so a release installs
/// the profile without a repository beside it.
pub const PROFILE: &str = include_str!("../../../../../packaging/apparmor/veeloe-bwrap");

/// Where `apparmor_parser -r` reads the profile. Nothing else is written: a
/// profile of another name is never replaced.
pub fn profile_path() -> String {
    format!("/etc/apparmor.d/{APPARMOR_PROFILE}")
}

/// The mode of the installed profile: every reader may see it, only root writes.
pub const PROFILE_MODE: u32 = 0o644;

/// What the fix needs from the Machine. A test answers from a table and records
/// what would have been written and run.
pub trait Host {
    /// The system this binary runs on, `None` where there is no sandbox.
    fn platform(&self) -> Option<Platform>;
    /// The effective user id; only 0 may install a profile.
    fn uid(&self) -> u32;
    /// [`APPARMOR_RESTRICT`]'s value, or `None` when this Machine has no such
    /// file (macOS, an older Linux).
    fn restriction(&self) -> Option<String>;
    /// Writes the profile atomically with `mode`, replacing the file at `path`.
    fn write_profile(&self, path: &Path, contents: &str, mode: u32) -> Result<(), String>;
    /// Runs `program` with `args`; a non-zero exit is an `Err` with its stderr.
    fn run(&self, program: &str, args: &[&str]) -> Result<(), String>;
}

/// This Machine, as root would see it.
pub struct SystemHost;

impl Host for SystemHost {
    fn platform(&self) -> Option<Platform> {
        Platform::current()
    }

    fn uid(&self) -> u32 {
        // Safe: `geteuid` has no arguments and no failure.
        unsafe { libc::geteuid() }
    }

    fn restriction(&self) -> Option<String> {
        std::fs::read_to_string(APPARMOR_RESTRICT)
            .ok()
            .map(|value| value.trim().to_string())
    }

    fn write_profile(&self, path: &Path, contents: &str, mode: u32) -> Result<(), String> {
        // The Runtime's one atomic writer, so a release never writes half a
        // profile (it is the one `json_file` uses for its own files).
        crate::json_file::write_atomic(path, contents, mode).map_err(|error| error.to_string())
    }

    fn run(&self, program: &str, args: &[&str]) -> Result<(), String> {
        let output = Command::new(program)
            .args(args)
            .output()
            .map_err(|error| format!("could not run {program}: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr = stderr.trim();
        Err(if stderr.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            format!("{program} exited with {}: {stderr}", output.status)
        })
    }
}

/// Install the profile, load it, and prove that `bwrap` can now create a user
/// namespace. `Ok(lines)` is what the CLI prints, one fact per line; an `Err` is
/// the whole message it prints before exiting non-zero.
///
/// The not-needed answers come first: on macOS, on a Machine without the
/// AppArmor rule, and on a kernel where the rule is off, there is nothing to fix
/// and nothing is touched, root or not.
pub fn fix_apparmor(host: &dyn Host) -> Result<Vec<String>, String> {
    match host.platform() {
        Some(Platform::Linux) => {}
        Some(Platform::MacOs) => {
            return Ok(vec![not_needed(
                "this is macOS: the OS sandbox uses sandbox-exec, so there is no AppArmor profile to install",
            )])
        }
        None => {
            return Ok(vec![not_needed(
                "this system has no OS sandbox yet, so there is no AppArmor profile to install",
            )])
        }
    }
    let Some(value) = host.restriction() else {
        return Ok(vec![not_needed(&format!(
            "this Machine has no {APPARMOR_RESTRICT}, so unprivileged user namespaces are not restricted by AppArmor"
        ))]);
    };
    // A `/proc` file ends in a newline; an unreadable or empty one is no rule.
    let value = value.trim();
    if value != "1" {
        return Ok(vec![not_needed(&format!(
            "{APPARMOR_RESTRICT} is {value}, not 1, so unprivileged user namespaces are not restricted; nothing to do"
        ))]);
    }
    if host.uid() != 0 {
        return Err(format!(
            "installing the AppArmor profile needs root: run it with sudo:\n\
             \x20 sudo veeloe doctor --fix-apparmor\n\
             Nothing was changed."
        ));
    }

    let path = profile_path();
    let path = Path::new(&path);
    host.write_profile(path, PROFILE, PROFILE_MODE)
        .map_err(|error| {
            format!(
                "could not write {}: {error}\n\
                 Nothing else was changed; fix the file or its folder and run this again.",
                path.display()
            )
        })?;
    let installed = path.to_string_lossy().to_string();
    host.run("apparmor_parser", &["-r", &installed])
        .map_err(|error| {
            format!(
                "wrote {} but could not load it: {error}\n\
                 The profile is on disk; run `sudo apparmor_parser -r {}` to see the parser's message.",
                path.display(),
                path.display()
            )
        })?;
    host.run("bwrap", &["--unshare-user", "--", "/bin/true"])
        .map_err(|error| {
            format!(
                "loaded {APPARMOR_PROFILE} but bwrap still cannot create a user namespace: {error}\n\
                 Check that bwrap is /usr/bin/bwrap (the profile matches that path only) and that \
                 {APPARMOR_RESTRICT} is still 1."
            )
        })?;

    Ok(vec![
        format!(
            "installed {APPARMOR_PROFILE} at {} ({:04o}): userns for /usr/bin/bwrap only",
            path.display(),
            PROFILE_MODE
        ),
        format!("loaded it with `apparmor_parser -r {}`", path.display()),
        "bwrap --unshare-user -- /bin/true succeeded: the OS sandbox can start".to_string(),
    ])
}

fn not_needed(why: &str) -> String {
    format!("nothing to do: {why}.")
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::path::PathBuf;

    use super::*;

    /// A Machine described by a table, recording what would have been written
    /// and run: every OS state is testable without root or AppArmor.
    struct Fake {
        platform: Option<Platform>,
        uid: u32,
        restriction: Option<String>,
        written: RefCell<Vec<(PathBuf, String, u32)>>,
        ran: RefCell<Vec<(String, Vec<String>)>>,
        run_fails: Option<&'static str>,
    }

    impl Fake {
        fn restricted() -> Self {
            Self {
                platform: Some(Platform::Linux),
                uid: 0,
                restriction: Some("1\n".into()),
                written: RefCell::new(Vec::new()),
                ran: RefCell::new(Vec::new()),
                run_fails: None,
            }
        }

        fn macos() -> Self {
            Self {
                platform: Some(Platform::MacOs),
                uid: 0,
                restriction: None,
                ..Self::restricted()
            }
        }
    }

    impl Host for Fake {
        fn platform(&self) -> Option<Platform> {
            self.platform
        }

        fn uid(&self) -> u32 {
            self.uid
        }

        fn restriction(&self) -> Option<String> {
            self.restriction.clone()
        }

        fn write_profile(&self, path: &Path, contents: &str, mode: u32) -> Result<(), String> {
            self.written
                .borrow_mut()
                .push((path.to_path_buf(), contents.to_string(), mode));
            Ok(())
        }

        fn run(&self, program: &str, args: &[&str]) -> Result<(), String> {
            self.ran.borrow_mut().push((
                program.to_string(),
                args.iter().map(|arg| arg.to_string()).collect(),
            ));
            match self.run_fails {
                Some(message) if program == "apparmor_parser" => Err(message.into()),
                _ => Ok(()),
            }
        }
    }

    fn parsed(host: &Fake) -> Vec<(String, Vec<String>)> {
        host.ran.borrow().clone()
    }

    #[test]
    fn the_profile_allows_userns_for_bwrap_and_for_nothing_else() {
        // The file in `packaging/` and the text in the binary are one, by
        // `include_str!`; the release has no other copy.
        assert!(PROFILE.contains("profile veeloe-bwrap /usr/bin/bwrap flags=(unconfined)"));
        assert!(PROFILE.contains("userns,"));
        assert!(PROFILE.contains("abi <abi/4.0>,"));
        assert!(PROFILE.contains("include <tunables/global>"));
        // Only one program is named, and it is the one the sandbox wraps.
        assert_eq!(PROFILE.matches("/usr/").count(), 1, "{PROFILE}");
        assert!(!PROFILE.contains("flags=(enforce)"), "{PROFILE}");
    }

    #[test]
    fn the_profile_is_installed_loaded_and_checked_as_root() {
        let host = Fake::restricted();
        let lines = fix_apparmor(&host).expect("fixed");

        let written = host.written.borrow();
        assert_eq!(written.len(), 1);
        let (path, contents, mode) = &written[0];
        assert_eq!(path, Path::new("/etc/apparmor.d/veeloe-bwrap"));
        assert_eq!(contents, PROFILE);
        assert_eq!(*mode, 0o644);

        let ran = parsed(&host);
        assert_eq!(
            ran[0],
            (
                "apparmor_parser".to_string(),
                vec!["-r".to_string(), "/etc/apparmor.d/veeloe-bwrap".to_string()]
            )
        );
        assert_eq!(
            ran[1],
            (
                "bwrap".to_string(),
                vec![
                    "--unshare-user".to_string(),
                    "--".to_string(),
                    "/bin/true".to_string()
                ]
            )
        );
        assert!(
            lines.iter().any(|line| line.contains("apparmor_parser -r")),
            "{lines:?}"
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains("the OS sandbox can start")),
            "{lines:?}"
        );
    }

    #[test]
    fn without_root_it_names_sudo_and_writes_nothing() {
        let host = Fake {
            uid: 1000,
            ..Fake::restricted()
        };
        let error = fix_apparmor(&host).expect_err("not root");
        assert!(
            error.contains("sudo veeloe doctor --fix-apparmor"),
            "{error}"
        );
        assert!(error.contains("Nothing was changed"), "{error}");
        assert!(host.written.borrow().is_empty(), "no profile was written");
        assert!(host.ran.borrow().is_empty(), "nothing was run");
    }

    #[test]
    fn a_macos_machine_is_told_it_is_not_needed() {
        let host = Fake::macos();
        let lines = fix_apparmor(&host).expect("nothing to do");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("nothing to do"), "{lines:?}");
        assert!(lines[0].contains("sandbox-exec"), "{lines:?}");
        assert!(host.written.borrow().is_empty());
        assert!(host.ran.borrow().is_empty());
    }

    #[test]
    fn a_linux_without_the_restriction_file_is_told_it_is_not_needed() {
        let host = Fake {
            restriction: None,
            ..Fake::restricted()
        };
        let lines = fix_apparmor(&host).expect("nothing to do");
        assert!(lines[0].contains("nothing to do"), "{lines:?}");
        assert!(lines[0].contains(APPARMOR_RESTRICT), "{lines:?}");
        assert!(host.written.borrow().is_empty());
        assert!(host.ran.borrow().is_empty());
    }

    #[test]
    fn a_kernel_where_the_rule_is_off_needs_no_profile() {
        let host = Fake {
            restriction: Some("0\n".into()),
            ..Fake::restricted()
        };
        let lines = fix_apparmor(&host).expect("nothing to do");
        assert!(lines[0].contains("is 0, not 1"), "{lines:?}");
        assert!(host.written.borrow().is_empty());
        assert!(host.ran.borrow().is_empty());
    }

    #[test]
    fn a_parser_that_refuses_says_what_is_on_disk_and_what_to_run() {
        let host = Fake {
            run_fails: Some("syntax error"),
            ..Fake::restricted()
        };
        let error = fix_apparmor(&host).expect_err("the parser refused");
        assert!(error.contains("could not load it"), "{error}");
        assert!(error.contains("syntax error"), "{error}");
        assert!(error.contains("sudo apparmor_parser -r"), "{error}");
        // The profile stays, so the operator can run the parser themselves.
        assert_eq!(host.written.borrow().len(), 1);
    }

    #[test]
    fn writing_the_profile_is_atomic_and_owner_readable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("veeloe-bwrap");
        // The writer `SystemHost` uses, without root: the same call with the
        // same mode, into a folder a test owns.
        crate::json_file::write_atomic(&path, PROFILE, PROFILE_MODE).expect("write");

        assert_eq!(std::fs::read_to_string(&path).expect("read"), PROFILE);
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o644);
        // No temporary file is left beside it.
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(names, vec!["veeloe-bwrap".to_string()]);
    }
}
