//! The sandbox an Agent's worker runs under, checked by running real commands
//! inside it (ADR 0008, 0068, 0069): what a command can see and change, not
//! what the profile says.

use veeloe_runtime_core::sandbox::{sandbox_exec_profile, Policy};

#[test]
fn a_quote_in_a_path_cannot_break_out_of_the_profile() {
    let mut policy = Policy::new(
        std::path::Path::new("/tmp/a1/workdir"),
        std::path::Path::new("/tmp/a1/tmp"),
        std::path::Path::new("/bin"),
    );
    policy.folder = "/tmp/a\" (allow file-write* (subpath \"/\")".into();
    let profile = sandbox_exec_profile(&policy);
    assert!(profile.contains("\\\""), "{profile}");
    // The injected text stays inside the quoted literal.
    assert!(!profile.contains("(subpath \"/\")"));
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod running {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use tempfile::{tempdir, TempDir};
    use veeloe_runtime_core::sandbox::{Policy, Sandbox};

    /// A stand-in `VEELOE_HOME` with one Agent's folder in it, a file of the
    /// Runtime's own beside it, and another Agent's folder.
    struct Home {
        _root: TempDir,
        root: PathBuf,
        sandbox: Sandbox,
    }

    fn home() -> Home {
        let root = tempdir().expect("root");
        let real = fs::canonicalize(root.path()).expect("real root");
        let agent = real.join("agents/a1");
        for sub in ["workdir", "tmp", ".home"] {
            fs::create_dir_all(agent.join(sub)).expect("agent folder");
        }
        fs::create_dir_all(real.join("runtime")).expect("runtime");
        fs::write(real.join("runtime/providers.json"), "secret").expect("providers");
        fs::write(
            agent.join(".home/.gitconfig"),
            "[user]\n\tname = A1\n\temail = a1@agents.veeloe.invalid\n",
        )
        .expect("gitconfig");
        fs::create_dir_all(real.join("agents/a2/workdir")).expect("other agent");
        fs::write(real.join("agents/a2/workdir/notes.md"), "theirs").expect("notes");
        // The Task log of the Agent, beside its folder and never inside it: the
        // supervisor is its only writer (ADR 0069).
        fs::create_dir_all(real.join("task-logs/a1")).expect("task log folder");
        fs::write(real.join("task-logs/a1/tasks.db"), "event log\n").expect("task log");
        let sandbox = Sandbox::new(Policy::new(
            &agent.join("workdir"),
            &agent.join("tmp"),
            Path::new("/bin"),
        ));
        Home {
            _root: root,
            root: real,
            sandbox,
        }
    }

    fn run(home: &Home, command: &str) -> std::process::Output {
        let policy = home.sandbox.policy().expect("rules");
        let argv = home.sandbox.wrap(&[
            "/bin/bash".to_string(),
            "-c".to_string(),
            command.to_string(),
        ]);
        // As a worker starts it: with the Agent's own home, not the owner's.
        Command::new(&argv[0])
            .args(&argv[1..])
            .env("HOME", Path::new(&policy.folder).join(".home"))
            .current_dir(&policy.workdir)
            .output()
            .expect("run under the sandbox")
    }

    fn refused(home: &Home, command: &str) {
        let out = run(home, command);
        assert!(
            !out.status.success(),
            "`{command}` was allowed: {}",
            String::from_utf8_lossy(&out.stdout)
        );
    }

    fn allowed(home: &Home, command: &str) -> String {
        let out = run(home, command);
        assert!(
            out.status.success(),
            "`{command}` was refused: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).to_string()
    }

    #[test]
    fn a_command_may_write_in_its_own_folder_and_nowhere_else() {
        let home = home();
        allowed(&home, "echo hi > a.txt && cat a.txt");
        allowed(&home, "echo hi > ../tmp/b.txt");
        let outside = home.root.join("runtime/written.txt");
        refused(&home, &format!("echo hi > {}", outside.display()));
        assert!(!outside.exists(), "the file was written anyway");
    }

    #[test]
    fn the_owners_home_is_not_readable_even_for_a_listing() {
        let home = home();
        // This test's own HOME is the owner's; the command is given the Agent's.
        let owner = std::env::var("HOME").expect("HOME");
        refused(&home, &format!("ls {owner}"));
    }

    #[test]
    fn the_runtimes_folder_and_another_agents_folder_are_not_readable() {
        let home = home();
        refused(
            &home,
            &format!("cat {}", home.root.join("runtime/providers.json").display()),
        );
        refused(
            &home,
            &format!(
                "cat {}",
                home.root.join("agents/a2/workdir/notes.md").display()
            ),
        );
    }

    #[test]
    fn a_symlink_out_of_the_workdir_reads_nothing() {
        let home = home();
        let target = home.root.join("runtime/providers.json");
        allowed(&home, &format!("ln -s {} link", target.display()));
        refused(&home, "cat link");
    }

    #[test]
    fn system_files_and_toolchains_still_work() {
        let home = home();
        allowed(&home, "cat /etc/hosts > /dev/null");
        let version = allowed(&home, "git --version");
        assert!(version.contains("git version"), "{version}");
        allowed(&home, "python3 -c 'print(1)'");
        // A commit takes its identity from the Agent's own home.
        let log = allowed(
            &home,
            "git init -q repo && cd repo && touch a && git add a && git commit -qm first && git log --format=%ae",
        );
        assert_eq!(log.trim(), "a1@agents.veeloe.invalid");
    }

    #[test]
    fn a_command_with_an_empty_egress_cannot_reach_a_domain() {
        let home = home();
        // The profile denies network before a listener is even looked for.
        refused(&home, "exec 3<>/dev/tcp/93.184.216.34/80 && echo opened");
    }

    /// The Task log is not in the folder a command may write, so every command
    /// — not just some tool's own check — is refused it (ADR 0069).
    #[test]
    fn a_command_cannot_read_write_or_delete_the_task_log() {
        let home = home();
        let log = home.root.join("task-logs/a1/tasks.db");
        refused(&home, &format!("cat {}", log.display()));
        refused(&home, &format!("echo hacked >> {}", log.display()));
        refused(&home, &format!("rm {}", log.display()));
        assert_eq!(
            fs::read_to_string(&log).expect("the log is still there"),
            "event log\n"
        );
    }
}
