//! The toolchain check the Runtime makes when a worker opens (issue #35). Every
//! layout is built in a temporary folder, so what passes here is the rules, not
//! whichever Python this Machine happens to have; and nothing in the log is a
//! path or a file's contents (ADR 0052, 0022).

use tempfile::tempdir;
use veeloe_runtime_supervisor::logs;
use veeloe_runtime_supervisor::toolchain::{Outcome, Report, Reported};

#[test]
fn the_report_holds_names_and_results_and_nothing_else() {
    let home = tempdir().expect("home");
    let reported = Reported::default();
    let reports = vec![
        Report {
            tool: "git".into(),
            outcome: Outcome::Ok,
        },
        Report {
            tool: "python3".into(),
            outcome: Outcome::Missing,
        },
    ];

    reported.record(home.path(), "a1", &reports);
    let lines = logs::recent(home.path()).expect("recent");
    assert_eq!(lines.len(), 1, "{lines:?}");
    let line: serde_json::Value = serde_json::from_str(&lines[0]).expect("json");
    assert_eq!(line["event"], "toolchain.check");
    // A refused tool is the Owner's business; all four okay is not.
    assert_eq!(line["level"], "warn");
    assert_eq!(line["fields"]["agent"], "a1");
    assert_eq!(
        line["fields"]["tools"],
        serde_json::json!({ "git": "ok", "python3": "missing" })
    );
    // A path or a file's contents would make the log worth not keeping.
    assert!(!lines[0].contains('/'), "{lines:?}");
    assert!(!lines[0].contains(home.path().to_str().expect("path")));

    // The same report again is not a second line; a changed one is.
    reported.record(home.path(), "a1", &reports);
    assert_eq!(logs::recent(home.path()).expect("recent").len(), 1);
    reported.record(
        home.path(),
        "a1",
        &[Report {
            tool: "git".into(),
            outcome: Outcome::Ok,
        }],
    );
    assert_eq!(logs::recent(home.path()).expect("recent").len(), 2);
}

#[test]
fn one_agents_report_does_not_suppress_another_agents() {
    let home = tempdir().expect("home");
    let reported = Reported::default();
    let reports = vec![Report {
        tool: "git".into(),
        outcome: Outcome::Ok,
    }];

    reported.record(home.path(), "a1", &reports);
    // The same four answers for a second Agent are its own first report, not a
    // repeat of a1's, and the log keeps both.
    reported.record(home.path(), "a2", &reports);
    let lines = logs::recent(home.path()).expect("recent");
    assert_eq!(lines.len(), 2, "{lines:?}");
    let agents: Vec<String> = lines
        .iter()
        .map(|line| {
            let value: serde_json::Value = serde_json::from_str(line).expect("json");
            value["fields"]["agent"]
                .as_str()
                .expect("agent")
                .to_string()
        })
        .collect();
    assert_eq!(agents, ["a1", "a2"]);
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod running {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    use tempfile::tempdir;
    use veeloe_runtime_core::sandbox::Policy;
    use veeloe_runtime_supervisor::toolchain::{check, Outcome, Report, TOOLS};

    /// How one tool answered, and a message naming what was asked for.
    fn outcome_of(reports: &[Report], tool: &str) -> Outcome {
        reports
            .iter()
            .find(|report| report.tool == tool)
            .unwrap_or_else(|| panic!("no report for {tool}: {reports:?}"))
            .outcome
    }

    /// A Machine made in a temporary folder: an Agent's own folders, and a
    /// toolchain laid out the way a vendor installer lays one out, with its
    /// binary in `bin` reading its own data from `lib` beside it. None of this
    /// is the owner's Python or the owner's home.
    struct Machine {
        _root: tempfile::TempDir,
        root: PathBuf,
        agent: PathBuf,
        layout: PathBuf,
        bin: PathBuf,
    }

    impl Machine {
        fn new() -> Self {
            let root = tempdir().expect("root");
            let real = fs::canonicalize(root.path()).expect("real root");
            let agent = real.join("agents/a1");
            for sub in ["workdir", "tmp", ".home"] {
                fs::create_dir_all(agent.join(sub)).expect("agent folder");
            }
            let layout = real.join("Library/Frameworks/Fake.framework/Versions/3.13");
            fs::create_dir_all(layout.join("bin")).expect("bin");
            fs::create_dir_all(layout.join("lib")).expect("lib");
            fs::write(layout.join("lib/version.txt"), "fake 1.0").expect("version");
            // A framework binary loads what sits beside it, not what `PATH` says.
            let program = layout.join("bin/git");
            fs::write(
                &program,
                "#!/bin/sh\ncat \"$(dirname \"$0\")/../lib/version.txt\" > /dev/null\n",
            )
            .expect("program");
            fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).expect("chmod");
            let bin = layout.join("bin");
            Self {
                _root: root,
                root: real,
                agent,
                layout,
                bin,
            }
        }

        /// The `PATH` a worker gets: this layout first, then the system's.
        fn path(&self) -> String {
            format!("{}:/bin:/usr/bin", self.bin.display())
        }

        /// The rules, with `read` as the folder the program comes from: the same
        /// rule `/Library/Frameworks` is, pointed at the temporary folder.
        fn policy(&self, read: &Path) -> Policy {
            Policy::new(&self.agent.join("workdir"), &self.agent.join("tmp"), read)
        }
    }

    #[test]
    fn a_toolchain_layout_runs_when_the_rules_name_its_root() {
        let machine = Machine::new();
        let reports = check(&machine.policy(&machine.layout), &machine.path());
        assert_eq!(outcome_of(&reports, "git"), Outcome::Ok, "{reports:?}");
        // Every tool the Runtime cares about is in the report, whatever this
        // Machine has.
        let named: Vec<&str> = reports.iter().map(|report| report.tool.as_str()).collect();
        assert_eq!(named, TOOLS);
    }

    #[test]
    fn a_toolchain_layout_the_rules_do_not_name_cannot_run() {
        let machine = Machine::new();
        let reports = check(&machine.policy(Path::new("/bin")), &machine.path());
        assert_ne!(
            outcome_of(&reports, "git"),
            Outcome::Ok,
            "a toolchain outside the rules ran anyway: {reports:?}"
        );
    }

    #[test]
    fn a_machine_without_a_toolchain_is_reported_not_failed() {
        let machine = Machine::new();
        let empty = machine.root.join("empty-bin");
        fs::create_dir_all(&empty).expect("empty");
        let reports = check(
            &machine.policy(&machine.layout),
            &empty.display().to_string(),
        );
        assert_eq!(reports.len(), TOOLS.len());
        for report in &reports {
            assert_eq!(report.outcome, Outcome::Missing, "{reports:?}");
        }
    }

    /// The real profile against the real `PATH`: the two toolchains a Task
    /// cannot be done without answer here, whichever way they were installed.
    #[test]
    fn the_toolchains_this_machine_has_are_checked_under_the_real_rules() {
        let machine = Machine::new();
        let path = std::env::var("PATH").expect("PATH");
        let reports = check(&machine.policy(Path::new("/bin")), &path);
        for tool in ["git", "python3"] {
            assert_eq!(outcome_of(&reports, tool), Outcome::Ok, "{reports:?}");
        }
        // Every answer is one of the four words the log may hold.
        for report in &reports {
            assert!(
                ["ok", "missing", "refused", "timeout"].contains(&report.outcome.as_str()),
                "{reports:?}"
            );
        }
    }
}
