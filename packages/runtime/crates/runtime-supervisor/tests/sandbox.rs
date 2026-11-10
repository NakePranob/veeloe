//! The sandbox rules a worker's commands will run under (task 4.4 builds them).

use std::path::Path;

use veeloe_runtime_core::sandbox::{bwrap_args, sandbox_exec_profile, Policy};

fn policy(egress: &[&str]) -> Policy {
    Policy::new(
        Path::new("/Users/o/.veeloe/agents/a1/workdir"),
        Path::new("/Users/o/.veeloe/agents/a1/tmp"),
        Path::new("/Applications/Veeloe/bin"),
        egress.iter().map(|domain| domain.to_string()).collect(),
        Path::new("/Users/o"),
        Path::new("/Users/o/.veeloe"),
    )
}

#[test]
fn the_profile_denies_by_default_and_opens_only_the_agents_own_folder() {
    let profile = sandbox_exec_profile(&policy(&["api.anthropic.com"]));
    assert!(profile.starts_with("(version 1)\n(deny default)\n"), "{profile}");
    // The Agent's folder holds the Task log, the Workdir and the TMPDIR.
    assert!(profile.contains("(allow file-write* (subpath \"/Users/o/.veeloe/agents/a1\"))"));
    // The Runtime's folder and the owner's secrets are never read, whatever
    // else says otherwise; the rest of the Machine stays readable.
    assert!(profile.contains("(deny file-read* (subpath \"/Users/o/.veeloe\"))"));
    assert!(profile.contains("(deny file-read* (subpath \"/Users/o/.ssh\"))"));
    assert!(!profile.contains("(deny file-read* (subpath \"/Users/o\"))"));
    // Nothing outside the folder is writable.
    assert!(!profile.contains("(allow file-write* (subpath \"/usr\"))"));
    // Writing to /dev/null is not a way out; every command may do it.
    assert!(profile.contains("(allow file-write* (literal \"/dev/null\"))"));
}

#[test]
fn the_only_way_out_is_the_local_proxy() {
    // Seatbelt cannot match a domain, so a worker without a proxy gets no
    // network at all, and one with a proxy reaches only that port.
    let none = sandbox_exec_profile(&policy(&[]));
    assert!(none.contains("(deny network*)"));
    assert!(!none.contains("(allow network"));

    let mut with_proxy = policy(&["api.anthropic.com"]);
    with_proxy.proxy = Some(41_234);
    let one = sandbox_exec_profile(&with_proxy);
    assert!(one.contains("(deny network*)"));
    assert!(one.contains("(allow network-outbound (remote ip \"localhost:41234\"))"));
    assert!(!one.contains("api.anthropic.com"));
}

#[test]
fn a_quote_in_a_path_cannot_break_out_of_the_profile() {
    let mut policy = policy(&[]);
    policy.folder = "/tmp/a\" (allow file-write* (subpath \"/\")".into();
    let profile = sandbox_exec_profile(&policy);
    assert!(profile.contains("\\\""), "{profile}");
    // The injected text stays inside the quoted literal.
    assert!(!profile.contains("(subpath \"/\")"));
}

#[test]
fn the_linux_arguments_unshare_everything_and_bind_only_the_agents_folder() {
    let args = bwrap_args(&policy(&["api.anthropic.com"]));
    assert!(args.contains(&"--unshare-all".to_string()));
    assert!(args.contains(&"--die-with-parent".to_string()));
    let folder = "/Users/o/.veeloe/agents/a1";
    let at = args.iter().position(|arg| arg == folder).expect("folder");
    assert_eq!(args[at - 1], "--bind");
    // A denied path is replaced by /dev/null, not left readable.
    assert!(args.windows(3).any(|window| window
        == ["--ro-bind".to_string(), "/dev/null".to_string(), "/Users/o/.ssh".to_string()]));
}

#[cfg(target_os = "macos")]
mod running {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::tempdir;
    use veeloe_runtime_core::sandbox::{Policy, Sandbox};

    fn run(sandbox: &Sandbox, command: &str) -> std::process::Output {
        run_in(sandbox, &sandbox.policy().workdir, command)
    }

    fn run_in(sandbox: &Sandbox, dir: &str, command: &str) -> std::process::Output {
        let argv = sandbox.wrap(&["/bin/bash".to_string(), "-c".to_string(), command.to_string()]);
        Command::new(&argv[0])
            .args(&argv[1..])
            .current_dir(dir)
            .output()
            .expect("run under sandbox-exec")
    }

    #[test]
    fn a_command_may_write_in_its_own_folder_and_nowhere_else() {
        let root = tempdir().expect("root");
        let workdir = root.path().join("workdir");
        let tmp = root.path().join("tmp");
        fs::create_dir_all(&workdir).expect("workdir");
        fs::create_dir_all(&tmp).expect("tmp");
        // Somewhere that is not the Agent's folder at all.
        let elsewhere = tempdir().expect("elsewhere");
        let outside = elsewhere.path().join("outside.txt");
        let sandbox = Sandbox::new(Policy::new(
            &workdir,
            &tmp,
            Path::new("/bin"),
            Vec::new(),
            root.path(),
            root.path(),
        ));

        let inside = run(&sandbox, "echo hi > a.txt; cat a.txt");
        assert!(
            inside.status.success(),
            "a write inside the folder was refused: {}",
            String::from_utf8_lossy(&inside.stderr)
        );
        assert_eq!(
            fs::read_to_string(workdir.join("a.txt")).expect("a.txt"),
            "hi\n"
        );

        let in_tmp = run(&sandbox, &format!("echo hi > {}/b.txt", tmp.display()));
        assert!(
            in_tmp.status.success(),
            "a write in the Agent's own tmp was refused: {}",
            String::from_utf8_lossy(&in_tmp.stderr)
        );

        let refused = run(&sandbox, &format!("echo hi > {}", outside.display()));
        assert!(
            !refused.status.success(),
            "a write outside the folder was allowed"
        );
        assert!(!outside.exists(), "the file was written anyway");
    }

    #[test]
    fn a_command_with_an_empty_egress_cannot_reach_a_domain() {
        let root = tempdir().expect("root");
        let workdir = root.path().join("workdir");
        let tmp = root.path().join("tmp");
        fs::create_dir_all(&workdir).expect("workdir");
        fs::create_dir_all(&tmp).expect("tmp");
        let sandbox = Sandbox::new(Policy::new(
            &workdir,
            &tmp,
            Path::new("/bin"),
            Vec::new(),
            root.path(),
            root.path(),
        ));
        // A connection to a port nothing listens on must fail for the network
        // rule, not for the missing listener: the profile denies network first.
        let out = run(&sandbox, "exec 3<>/dev/tcp/93.184.216.34/80 && echo opened");
        assert!(
            !out.status.success(),
            "network was allowed with an empty egress: {}",
            String::from_utf8_lossy(&out.stdout)
        );
    }
}
