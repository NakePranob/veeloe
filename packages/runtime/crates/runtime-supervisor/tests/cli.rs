//! The `veeloe` command itself: what an owner sees before anything is paired,
//! what the Machine looks like once it is, and what `help`/`provider` say
//! (ported from `packages/runtime-legacy/src/help.ts` and `supervisor/status.ts`).

mod support;

use std::fs;
use std::process::Command;

use serde_json::json;
use support::ModelsStub;
use tempfile::tempdir;

fn veeloe_home(home: &std::path::Path, args: &[&str]) -> (i32, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_veeloe"))
        .args(args)
        .env("VEELOE_HOME", home)
        .output()
        .expect("run veeloe");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
    )
}

fn veeloe(home: &std::path::Path, args: &[&str]) -> (i32, String) {
    veeloe_home(home, args)
}

fn stderr_of(home: &std::path::Path, args: &[&str]) -> (i32, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_veeloe"))
        .args(args)
        .env("VEELOE_HOME", home)
        .output()
        .expect("run veeloe");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

/// A Machine that looks set up, written the way the Runtime writes it.
fn paired_home(home: &std::path::Path) {
    fs::create_dir_all(home.join("runtime")).expect("runtime");
    fs::write(
        home.join("runtime/trust.json"),
        json!({ "owners": [{ "member": "member-1", "keys": ["k"] }] }).to_string(),
    )
    .expect("trust");
    fs::write(home.join("config.json"), json!({ "hubUrl": "wss://hub.test" }).to_string())
        .expect("config");
    fs::write(
        home.join("runtime/agents.json"),
        json!([{ "id": "a1", "name": "Deployer", "provider": "main", "model": "model-a" }]).to_string(),
    )
    .expect("agents");
}

#[test]
fn help_names_every_command_and_each_command_has_its_own_text() {
    let home = tempdir().expect("home");
    let (code, out) = veeloe(home.path(), &["help"]);
    assert_eq!(code, 0);
    assert!(
        out.starts_with("Veeloe Runtime: your Agents, on this Machine."),
        "{out}"
    );
    for phrase in [
        "Start the Runtime: it connects to the Hub",
        "Pair this Machine with the Veeloe app",
        "Forget every Controller",
        "Show whether this Machine is paired",
        "Set up the LLMs (Providers)",
    ] {
        assert!(out.contains(phrase), "{phrase}: {out}");
    }
    assert!(
        out.trim_end()
            .ends_with("More on one command: veeloe help <command>"),
        "{out}"
    );

    // `help <command>` prints that command alone, as the legacy `help.ts` did.
    let (code, out) = veeloe(home.path(), &["help", "provider"]);
    assert_eq!(code, 0);
    assert!(out.starts_with("veeloe provider add [--preset <id>"), "{out}");
    assert!(out.contains("Built-in: anthropic, opencode-go, openrouter"), "{out}");

    let (code, out) = veeloe(home.path(), &["status", "--help"]);
    assert_eq!(code, 0);
    assert!(out.contains("Show whether this Machine is paired"), "{out}");

    let (code, stderr) = stderr_of(home.path(), &["help", "deploy"]);
    assert_eq!(code, 2);
    assert!(stderr.contains("no command deploy"), "{stderr}");
}

#[test]
fn an_unknown_command_is_refused() {
    let home = tempdir().expect("home");
    let (code, stderr) = stderr_of(home.path(), &["deploy"]);
    assert_eq!(code, 2);
    assert!(stderr.contains("unknown command: deploy"), "{stderr}");
    assert!(stderr.contains("run veeloe --help"), "{stderr}");
}

/// `unpair` asks a person first, as the legacy CLI did: with no terminal to
/// answer, nothing is removed.
#[test]
fn unpair_without_a_terminal_changes_nothing() {
    let home = tempdir().expect("home");
    fs::create_dir_all(home.path().join("runtime")).expect("runtime");
    fs::write(
        home.path().join("runtime/trust.json"),
        json!({ "owners": [{ "member": "member-1", "keys": ["k"] }] }).to_string(),
    )
    .expect("trust");
    fs::write(home.path().join("machine.key"), [7u8; 32]).expect("key");

    let (code, out) = veeloe(home.path(), &["unpair"]);
    // The question is asked anyway; a closed stdin is a no, and a no exits 1.
    assert_eq!(code, 1, "{out}");
    assert!(
        out.contains("This Machine will stop trusting every Controller and get a new key. Continue? [y/N] "),
        "{out}"
    );
    assert!(out.contains("nothing was changed"), "{out}");
    assert!(home.path().join("runtime/trust.json").exists());
    assert!(home.path().join("machine.key").exists());
}

#[test]
fn status_says_what_the_machine_is_before_and_after_pairing() {
    let home = tempdir().expect("home");
    let (code, out) = veeloe(home.path(), &["status"]);
    assert_eq!(code, 0);
    assert!(out.contains("Machine     not paired"), "{out}");
    assert!(out.contains("Runtime     not running"), "{out}");
    assert!(out.contains("Providers   none"), "{out}");
    assert!(out.contains("Agents      none"), "{out}");
    assert!(
        out.trim_end()
            .ends_with("Next: run veeloe to pair this Machine and add a Provider"),
        "{out}"
    );

    paired_home(home.path());
    fs::write(
        home.path().join("runtime/providers.json"),
        json!([{ "name": "main", "url": "https://api.anthropic.test", "key": "sk-secret", "auth": "x-api-key", "preset": "anthropic" }])
            .to_string(),
    )
    .expect("providers");

    let (code, out) = veeloe(home.path(), &["status"]);
    assert_eq!(code, 0);
    assert!(out.contains("Machine     paired as "), "{out}");
    assert!(out.contains("with hub wss://hub.test"), "{out}");
    assert!(out.contains("Runtime     not running"), "{out}");
    assert!(
        out.contains("  main  anthropic  https://api.anthropic.test"),
        "{out}"
    );
    assert!(out.contains("  Deployer  main  model-a"), "{out}");
    assert!(
        out.trim_end().ends_with("Next: start the Runtime with veeloe"),
        "{out}"
    );
    // A key is never printed.
    assert!(!out.contains("sk-secret"), "{out}");
}

fn veeloe_stdin(home: &std::path::Path, args: &[&str], stdin: &str) -> (i32, String) {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new(env!("CARGO_BIN_EXE_veeloe"))
        .args(args)
        .env("VEELOE_HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("run veeloe");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(stdin.as_bytes())
        .expect("write the key");
    let output = child.wait_with_output().expect("wait");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
    )
}

#[test]
fn a_provider_is_checked_saved_listed_and_removed_without_ever_printing_its_key() {
    let home = tempdir().expect("home");
    let stub = ModelsStub::start();

    // Nothing set up yet reads as the legacy `provider list` did.
    let (code, out) = veeloe(home.path(), &["provider", "list"]);
    assert_eq!(code, 0);
    assert!(out.contains("no Provider yet. Add one with: veeloe provider add"), "{out}");

    let (code, out) = veeloe_stdin(
        home.path(),
        &["provider", "add", "--name", "main", "--url", &stub.url],
        "sk-the-key\n",
    );
    assert_eq!(code, 0, "{out}");
    assert!(out.contains(&format!("checking {} ...", stub.url)), "{out}");
    assert!(out.contains("saved main with 2 models"), "{out}");
    assert!(out.contains("Next: create an Agent with it in the Veeloe app."), "{out}");

    let (code, out) = veeloe(home.path(), &["provider", "list"]);
    assert_eq!(code, 0);
    assert!(out.contains(&format!("main\t{}", stub.url)), "{out}");
    assert!(!out.contains("sk-the-key"), "the key was printed: {out}");

    // A key in an argument is refused before anything is read.
    let (code, _) = veeloe_stdin(
        home.path(),
        &["provider", "add", "--name", "other", "--url", "https://x.test", "--key", "sk"],
        "",
    );
    assert_eq!(code, 2);

    let (code, out) = veeloe(home.path(), &["provider", "remove", "main", "--yes"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("no Agent uses main."), "{out}");
    assert!(
        out.contains("removed main. Next: add another with veeloe provider add, or see what is left with veeloe status"),
        "{out}"
    );
    let (_, out) = veeloe(home.path(), &["provider", "list"]);
    assert!(out.contains("no Provider yet."), "{out}");
}

#[test]
fn a_key_the_provider_refuses_is_not_saved() {
    let home = tempdir().expect("home");
    let stub = ModelsStub::start();
    let (code, out) = veeloe_stdin(
        home.path(),
        &["provider", "add", "--name", "main", "--url", &stub.url],
        "wrong\n",
    );
    assert_eq!(code, 1, "{out}");
    assert!(
        out.contains("not saved: the Provider refused this key. Check the key and run veeloe provider add again"),
        "{out}"
    );
    assert!(!home.path().join("runtime/providers.json").exists());
}

#[test]
fn without_a_terminal_the_missing_flag_is_named_and_no_preset_url_can_be_overridden() {
    let home = tempdir().expect("home");
    let (code, stderr) = stderr_of(home.path(), &["provider", "add"]);
    assert_eq!(code, 1, "{stderr}");
    assert!(
        stderr.contains("missing --name: veeloe provider add --name <name> --url <base url>"),
        "{stderr}"
    );

    let (code, stderr) = stderr_of(home.path(), &["provider", "add", "--preset", "deploy"]);
    assert_eq!(code, 1, "{stderr}");
    assert!(
        stderr.contains("no built-in Provider deploy. Pick one of: anthropic, opencode-go, openrouter"),
        "{stderr}"
    );

    let (code, stderr) = stderr_of(
        home.path(),
        &["provider", "add", "--preset", "openrouter", "--url", "https://x.test"],
    );
    assert_eq!(code, 1, "{stderr}");
    assert!(
        stderr.contains("--preset openrouter sets its own URL; drop --url"),
        "{stderr}"
    );

    // Removing needs a name and, without a terminal to confirm on, `--yes`.
    let stub = ModelsStub::start();
    let (code, _) = veeloe_stdin(
        home.path(),
        &["provider", "add", "--name", "main", "--url", &stub.url],
        "sk\n",
    );
    assert_eq!(code, 0);
    let (code, stderr) = stderr_of(home.path(), &["provider", "remove"]);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("missing the Provider's name"), "{stderr}");
    let (code, stderr) = stderr_of(home.path(), &["provider", "remove", "main"]);
    assert_eq!(code, 1, "{stderr}");
    assert!(
        stderr.contains("not removed: there is no terminal to confirm on. Run it again with --yes: veeloe provider remove main --yes"),
        "{stderr}"
    );
}

/// The one failed preflight the compiled binary can be made to reach without a
/// hook into its Probe: Linux without `bwrap` on `PATH`. It must name the
/// package, exit non-zero, and leave no supervisor behind — no pid file and no
/// Hub link, which would otherwise keep the process running until Ctrl-C.
///
/// The other OS states are unit tests in `runtime-core/src/preflight.rs`, where
/// the Probe is a table instead of this Machine.
#[cfg(target_os = "linux")]
#[test]
fn a_linux_without_bwrap_says_what_is_missing_and_starts_nothing() {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let home = tempdir().expect("home");
    paired_home(home.path());
    let mut child = Command::new(env!("CARGO_BIN_EXE_veeloe"))
        .env("VEELOE_HOME", home.path())
        .env("PATH", "")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("run veeloe");
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if child.try_wait().expect("wait").is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("veeloe kept running on a Machine without bwrap");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().expect("output");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("bwrap is not on PATH"), "{stderr}");
    assert!(stderr.contains("bubblewrap"), "{stderr}");
    assert!(
        !home.path().join("runtime/supervisor.pid").exists(),
        "a supervisor that cannot sandbox must not write its pid file"
    );
}
