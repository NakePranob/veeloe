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
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};

    use tempfile::{tempdir, TempDir};
    use veeloe_runtime_core::sandbox::{Policy, Sandbox};

    /// The ports of one range, as the supervisor reserves them.
    const PORTS: u16 = 10;

    /// A stand-in `VEELOE_HOME` with one Agent's folder in it, a file of the
    /// Runtime's own beside it, and another Agent's folder.
    struct Home {
        _root: TempDir,
        root: PathBuf,
        policy: Policy,
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
        let policy = Policy::new(
            &agent.join("workdir"),
            &agent.join("tmp"),
            Path::new("/bin"),
        );
        Home {
            _root: root,
            root: real,
            policy,
        }
    }

    /// The same home, with the range an Agent would be given (ADR 0069).
    fn with_ports(mut home: Home, start: u16) -> Home {
        home.policy.ports = (start..start + PORTS).collect();
        home
    }

    /// Ten loopback ports nothing on this Machine is listening on, so a test
    /// binds a real one instead of hoping a number is free.
    fn free_range() -> u16 {
        free_range_avoiding(0)
    }

    /// The same, with one port no range may cover: a service of the Machine's
    /// the test opened first.
    fn free_range_avoiding(avoid: u16) -> u16 {
        for start in (20000u16..=59990).step_by(10) {
            if (start..start + PORTS).contains(&avoid) {
                continue;
            }
            let listening: Option<Vec<TcpListener>> = (start..start + PORTS)
                .map(|port| TcpListener::bind(("127.0.0.1", port)).ok())
                .collect();
            if listening.is_some() {
                return start;
            }
        }
        panic!("no free range of ten loopback ports");
    }

    fn write_script(home: &Home, name: &str, text: &str) {
        fs::write(Path::new(&home.policy.workdir).join(name), text).expect("script");
    }

    /// Starts a command under the rules without waiting for it, so two of them
    /// can hold something at the same time.
    fn spawn(home: &Home, command: &str) -> Child {
        let policy = &home.policy;
        let argv = Sandbox::new(policy.clone()).wrap(&[
            "/bin/bash".to_string(),
            "-c".to_string(),
            command.to_string(),
        ]);
        // As a worker starts it: with the Agent's own home, not the owner's.
        Command::new(&argv[0])
            .args(&argv[1..])
            .env("HOME", Path::new(&policy.folder).join(".home"))
            .current_dir(&policy.workdir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("run under the sandbox")
    }

    fn run(home: &Home, command: &str) -> std::process::Output {
        spawn(home, command)
            .wait_with_output()
            .expect("run under the sandbox")
    }

    /// Runs a program directly under the rules, with no shell around it.
    #[cfg(target_os = "macos")]
    fn run_argv(home: &Home, argv: &[String]) -> std::process::Output {
        let policy = &home.policy;
        let argv = Sandbox::new(policy.clone()).wrap(argv);
        Command::new(&argv[0])
            .args(&argv[1..])
            .env("HOME", Path::new(&policy.folder).join(".home"))
            .current_dir(&policy.workdir)
            .stdin(Stdio::null())
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

    /// Issue #50: an Agent opens a page in a headless browser and reads its DOM
    /// under the rules, and the owner's home stays unreadable in the same run.
    ///
    /// The browser is `chrome-headless-shell`, named by `VEELOE_TEST_BROWSER`:
    /// the full Chrome app registers with Launch Services and opens a real
    /// window, so it asks for the owner's GUI session, which stays refused
    /// (ADR 0069). The test copies the browser into the Agent's own folder —
    /// where a tool the Agent may run lives — and the sandbox still never reads
    /// the developer's cache or home. Skips, rather than fails, on a Machine
    /// (and on a CI runner) that has no such browser.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_headless_browser_opens_a_page_inside_the_rules() {
        let home = home();
        let Ok(source) = std::env::var("VEELOE_TEST_BROWSER") else {
            eprintln!("skipping: VEELOE_TEST_BROWSER is not set to a chrome-headless-shell binary");
            return;
        };
        let source = PathBuf::from(source);
        assert!(source.is_file(), "not a browser: {}", source.display());
        // The browser needs the resources beside it, so the whole folder is
        // installed. `cp -c` clones instead of copying on APFS; a plain copy
        // still works where cloning is not available.
        let installed = Path::new(&home.policy.folder).join("browser");
        let folder = source.parent().expect("the browser's folder");
        let cloned = Command::new("cp")
            .arg("-cR")
            .arg(folder)
            .arg(&installed)
            .status()
            .expect("cp");
        if !cloned.success() {
            let copied = Command::new("cp")
                .arg("-R")
                .arg(folder)
                .arg(&installed)
                .status()
                .expect("cp");
            assert!(copied.success(), "could not install the browser");
        }
        let browser = installed.join(source.file_name().expect("the binary's name"));
        let profile = Path::new(&home.policy.folder).join(".home/browser");
        let out = run_argv(
            &home,
            &[
                browser.to_string_lossy().to_string(),
                // Chrome's own sandbox cannot nest inside Seatbelt, so it is
                // turned off here: the profile above is the one enforced.
                "--no-sandbox".into(),
                "--disable-gpu".into(),
                "--no-first-run".into(),
                "--no-default-browser-check".into(),
                format!("--user-data-dir={}", profile.display()),
                "--dump-dom".into(),
                "data:text/html,<h1>veeloe</h1>".into(),
            ],
        );
        assert!(
            out.status.success(),
            "the browser was refused: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let dom = String::from_utf8_lossy(&out.stdout);
        assert!(dom.contains("veeloe"), "the page did not open: {dom}");
        // The browser used its own profile, and the owner's home is still
        // refused by the same rules.
        assert!(profile.is_dir(), "the browser did not use its own profile");
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

    /// Issue #42: a command runs a service on a port of its own and reaches it,
    /// which is what a dev server, a database and the tests beside them need.
    #[test]
    fn a_command_can_bind_and_reach_a_port_of_its_own() {
        let home = with_ports(home(), free_range());
        let port = home.policy.ports[0];
        write_script(
            &home,
            "serve.py",
            &[
                "import socket, sys",
                "port = int(sys.argv[1])",
                "server = socket.socket()",
                "server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)",
                "server.bind((\"127.0.0.1\", port))",
                "server.listen(1)",
                // A listener's backlog answers the connect, so one command can
                // bind a port and reach it without a second thread.
                "client = socket.create_connection((\"127.0.0.1\", port), timeout=2)",
                "client.sendall(b\"ping\")",
                "conn, _ = server.accept()",
                "print(\"served\", conn.recv(4).decode())",
                "conn.close()",
            ]
            .join("\n"),
        );
        let answer = allowed(&home, &format!("python3 serve.py {port}"));
        assert!(answer.contains("served ping"), "{answer}");
    }

    /// Issue #42: the same command cannot reach a service of the Machine's on a
    /// port outside the range. The listener is this test's own, as the owner's
    /// database or another program is (ADR 0069).
    #[test]
    fn a_command_cannot_reach_a_host_service_outside_its_range() {
        let listening = TcpListener::bind("127.0.0.1:0").expect("host service");
        let port = listening.local_addr().expect("address").port();
        let home = with_ports(home(), free_range_avoiding(port));
        assert!(
            !home.policy.ports.contains(&port),
            "the host service is inside the Agent's range"
        );
        // Outside the rules the same address answers, so the refusal below is
        // the sandbox's and not a port that happens to be shut.
        TcpStream::connect(("127.0.0.1", port)).expect("reachable outside the rules");
        listening.accept().expect("the connection outside");
        refused(
            &home,
            &format!(
                "python3 -c 'import socket; socket.create_connection((\"127.0.0.1\", {port}), timeout=2)'"
            ),
        );
        // Nothing reached the listener from inside the rules.
        listening
            .set_nonblocking(true)
            .expect("non-blocking listener");
        assert!(
            listening.accept().is_err(),
            "the sandbox reached a host service on port {port}"
        );
    }

    /// Issue #42: on Linux the proxy's Unix socket is the one way out of the
    /// namespace, so a command has to be able to reach it there. The test
    /// answers from outside the sandbox, with bytes that came from inside it,
    /// which is what a proxied request is (ADR 0069).
    #[cfg(target_os = "linux")]
    #[test]
    fn a_command_reaches_the_proxys_unix_socket_from_inside_its_namespace() {
        use std::io::{Read, Write};
        use std::os::unix::net::UnixListener;

        let mut home = home();
        let socket = home.root.join("runtime/egress.sock");
        let listener = UnixListener::bind(&socket).expect("bind the proxy's socket");
        home.policy.proxy_socket = Some(socket.to_string_lossy().to_string());
        // The proxy, as the supervisor runs it: outside the namespace, reading
        // a request and answering it.
        let answering = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("a command connected");
            let mut request = [0u8; 4];
            stream.read_exact(&mut request).expect("the request");
            stream
                .write_all(format!("pong:{}", String::from_utf8_lossy(&request)).as_bytes())
                .expect("the answer");
        });
        write_script(
            &home,
            "ask.py",
            &[
                "import socket",
                "client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)",
                "client.connect(\"/run/veeloe/egress.sock\")",
                "client.sendall(b\"ping\")",
                "print(client.recv(64).decode())",
            ]
            .join("\n"),
        );
        let answer = allowed(&home, "python3 ask.py");
        answering.join().expect("the answer");
        assert!(answer.contains("pong:ping"), "{answer}");
    }

    /// Issue #42: two Linux Agents bind the same port number at the same
    /// moment, each in its own network namespace, and both keep it. That is
    /// what lets two Agents run the same dev server on the same address
    /// without one of them losing the port (ADR 0069).
    #[cfg(target_os = "linux")]
    #[test]
    fn two_linux_agents_bind_the_same_port_in_their_own_namespaces() {
        let start = free_range();
        let port = start;
        // The Machine's own listener on the same number: if either namespace
        // were the Machine's, its bind below would fail against this.
        let machine = TcpListener::bind(("127.0.0.1", port)).expect("the Machine's listener");
        let script = [
            "import socket, sys, time",
            "port = int(sys.argv[1])",
            "server = socket.socket()",
            "server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)",
            "server.bind((\"127.0.0.1\", port))",
            "server.listen(1)",
            "client = socket.create_connection((\"127.0.0.1\", port), timeout=2)",
            "client.sendall(b\"ping\")",
            "conn, _ = server.accept()",
            "print(\"bound\", port, conn.recv(4).decode(), flush=True)",
            // Long enough for the other Agent to bind its own namespace while
            // this one still holds the port.
            "time.sleep(2)",
            "conn.close()",
        ]
        .join("\n");
        let first = with_ports(home(), start);
        let second = with_ports(home(), start);
        write_script(&first, "hold.py", &script);
        write_script(&second, "hold.py", &script);
        // Both are started before either is waited on: a sequential run would
        // prove nothing about two namespaces at once.
        let one = spawn(&first, &format!("python3 hold.py {port}"));
        let two = spawn(&second, &format!("python3 hold.py {port}"));
        for (which, child) in [("first", one), ("second", two)] {
            let out = child.wait_with_output().expect("the Agent's command");
            assert!(
                out.status.success(),
                "the {which} Agent could not bind port {port}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            let stdout = String::from_utf8_lossy(&out.stdout);
            assert!(
                stdout.contains(&format!("bound {port} ping")),
                "the {which} Agent did not serve on port {port}: {stdout}"
            );
        }
        // The Machine's listener never saw a connection from either namespace.
        machine
            .set_nonblocking(true)
            .expect("non-blocking listener");
        assert!(
            machine.accept().is_err(),
            "a namespace reached the Machine's listener"
        );
    }

    /// A Stop or a timeout ends a command with a signal, so the command it
    /// started must be signalled too. Everything outside this sandbox — the
    /// supervisor, another Agent — must not be.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_command_can_stop_its_own_child_but_not_the_supervisor() {
        let home = home();
        allowed(
            &home,
            "sleep 30 & child=$!; kill $child 2>/dev/null; wait $child 2>/dev/null; echo stopped",
        );
        // This test process is outside the rules, as the supervisor is.
        let supervisor = std::process::id();
        refused(&home, &format!("kill -0 {supervisor}"));
    }

    /// Issue #37: the rules name one system service at a time, so a lookup that
    /// is not named is refused. The check is the request's answer, not the
    /// profile's text.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_service_the_rules_do_not_name_is_refused() {
        let home = home();
        // A service every Mac runs and the list does not name: if it ever comes
        // onto the list, this test has to pick another one.
        let service = "com.apple.SecurityServer";
        assert!(
            !veeloe_runtime_core::sandbox::allowed_services()
                .iter()
                .any(|(name, _)| *name == service),
            "{service} is on the allowed list now; the test needs one that is not"
        );
        let workdir = home.policy.workdir.clone();
        // `bootstrap_look_up` is what every mach lookup goes through; asking it
        // from inside the rules is the same request a tool would make.
        fs::write(
            Path::new(&workdir).join("lookup.py"),
            format!(
                "import ctypes, sys\n\
                 lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib')\n\
                 bp = ctypes.c_uint.in_dll(lib, 'bootstrap_port')\n\
                 port = ctypes.c_uint(0)\n\
                 rc = lib.bootstrap_look_up(ctypes.c_uint(bp.value), ctypes.c_char_p(b'{service}'), ctypes.byref(port))\n\
                 sys.exit(0 if rc == 0 else 1)\n"
            ),
        )
        .expect("lookup script");

        // Outside the rules the same request is answered, so a refusal below is
        // the sandbox's and not the service being absent.
        let outside = Command::new("python3")
            .arg("lookup.py")
            .current_dir(&workdir)
            .output()
            .expect("run outside");
        assert!(
            outside.status.success(),
            "the service was absent outside the sandbox too: {}",
            String::from_utf8_lossy(&outside.stderr)
        );
        refused(&home, "python3 lookup.py");
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
        // Not even a hard link into the Workdir: it would share the log's inode
        // and leave a path rule with nothing to match on.
        refused(&home, &format!("ln {} link-to-log", log.display()));
        assert!(!home.root.join("agents/a1/workdir/link-to-log").exists());
        assert_eq!(
            fs::read_to_string(&log).expect("the log is still there"),
            "event log\n"
        );
    }
}
