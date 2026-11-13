//! Issue #37: a lookup the narrowed profile refuses is visible in the Runtime
//! log, so a missing service is added from evidence rather than by opening the
//! profile again (ADR 0069). The check is a real request under the real rules
//! and the log line it leaves, not the profile's text (ADR 0022).

#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tempfile::tempdir;
use veeloe_runtime_core::sandbox::{Policy, Sandbox};
use veeloe_runtime_supervisor::denials::{Denials, Running};
use veeloe_runtime_supervisor::logs;

/// A service every Mac runs, and one the profile does not name.
const SERVICE: &str = "com.apple.SecurityServer";

/// `bootstrap_look_up` is what a mach lookup goes through, so this asks exactly
/// what a tool asks, and exits non-zero when the rules refuse it.
fn lookup_script() -> String {
    format!(
        "import ctypes, sys\n\
         lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib')\n\
         bp = ctypes.c_uint.in_dll(lib, 'bootstrap_port')\n\
         port = ctypes.c_uint(0)\n\
         rc = lib.bootstrap_look_up(ctypes.c_uint(bp.value), ctypes.c_char_p(b'{SERVICE}'), ctypes.byref(port))\n\
         sys.exit(0 if rc == 0 else 1)\n"
    )
}

#[test]
fn a_refused_service_is_named_in_the_runtime_log() {
    let root = tempdir().expect("root");
    let home = fs::canonicalize(root.path()).expect("real home");
    let agent = home.join("agents/a1");
    for sub in ["workdir", "tmp", ".home"] {
        fs::create_dir_all(agent.join(sub)).expect("agent folder");
    }
    fs::write(agent.join("workdir/lookup.py"), lookup_script()).expect("lookup script");
    let policy = Policy::new(
        &agent.join("workdir"),
        &agent.join("tmp"),
        Path::new("/bin"),
    );

    // The test process stands in for a worker: a denial from inside its own
    // sandbox is what the supervisor would read for that Agent.
    let me = std::process::id();
    let running: Running = Arc::new(move || HashMap::from([(me, "a1".to_string())]));
    let denials = Denials::start(home.clone(), running).expect("the system log is readable");

    let argv = Sandbox::new(policy).wrap(&["python3".to_string(), "lookup.py".to_string()]);
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut found = None;
    while Instant::now() < deadline {
        let out = Command::new(&argv[0])
            .args(&argv[1..])
            .current_dir(agent.join("workdir"))
            .env("HOME", agent.join(".home"))
            .output()
            .expect("run under the sandbox");
        assert!(
            !out.status.success(),
            "the lookup of {SERVICE} was allowed, so the profile still reaches it"
        );
        found = logs::recent(&home).ok().and_then(|lines| {
            lines
                .into_iter()
                .find(|line| line.contains("sandbox.denied") && line.contains(SERVICE))
        });
        if found.is_some() {
            break;
        }
        // The reader follows the log stream; the first denial can land before it
        // is listening, so a request that is refused again is repeated.
        std::thread::sleep(Duration::from_millis(500));
    }
    drop(denials);

    let line = found.unwrap_or_else(|| {
        panic!(
            "no sandbox.denied line for {SERVICE}: {:?}",
            logs::recent(&home)
        )
    });
    let value: serde_json::Value = serde_json::from_str(&line).expect("json");
    assert_eq!(value["level"], "warn");
    assert_eq!(value["event"], "sandbox.denied");
    assert_eq!(value["fields"]["service"], SERVICE);
    assert!(
        value["fields"]["process"].as_str().is_some_and(|name| !name.is_empty()),
        "the line does not say which program asked: {line}"
    );
    // The log says a name, not what the tool was doing or where it was reading.
    assert!(
        !line.contains(home.to_str().expect("home")),
        "the denial line carries a path: {line}"
    );
    assert!(!line.contains("/Users/"), "the denial line carries a path: {line}");
}
