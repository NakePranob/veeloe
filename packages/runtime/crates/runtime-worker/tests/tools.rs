//! The tool tests, ported from `packages/runtime-legacy/src/worker/adapters/`.
//!
//! `bash.test.ts` runs outside any sandbox: these are the tool's own rules. e2e
//! runs it inside one. `files.test.ts` is ported name for name.

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tempfile::tempdir;
use veeloe_plugin_api::{Cancel, ToolError, ToolRunner};
use veeloe_runtime_core::sandbox::{Policy, Sandbox};
use veeloe_runtime_worker::tools::bash::{BashTool, OUTPUT_LIMIT};
use veeloe_runtime_worker::tools::files::FileTools;

fn run(tools: &dyn ToolRunner, name: &str, input: Value) -> Result<String, ToolError> {
    let cancel = Cancel::new();
    run_with(tools, name, input, &cancel)
}

fn run_with(
    tools: &dyn ToolRunner,
    name: &str,
    input: Value,
    cancel: &Cancel,
) -> Result<String, ToolError> {
    futures_block_on(tools.run(name, &input, cancel))
}

/// A tiny blocking driver, so the tests read like the legacy ones.
fn futures_block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(future)
}

fn workdir() -> (tempfile::TempDir, PathBuf) {
    let root = tempdir().expect("tempdir");
    let workdir = root.path().join("workdir");
    fs::create_dir(&workdir).expect("workdir");
    (root, fs::canonicalize(&workdir).expect("canonical workdir"))
}

// ---------------------------------------------------------------- bash

fn bash_tool(workdir: &Path) -> BashTool {
    let mut env = HashMap::new();
    if let Ok(path) = std::env::var("PATH") {
        env.insert("PATH".into(), path);
    }
    if let Ok(home) = std::env::var("HOME") {
        env.insert("HOME".into(), home);
    }
    env.insert("NODE_CHANNEL_FD".into(), "3".into());
    env.insert("NODE_CHANNEL_SERIALIZATION_MODE".into(), "json".into());
    // One "second" is 20 ms here, so the 120 s default is 2.4 s and the 600 s
    // ceiling 12 s.
    let sandbox = Sandbox::new(Policy::new(workdir, &workdir.join("tmp"), Path::new("/bin")));
    BashTool::new(workdir, env, 20, sandbox)
}

fn bash(tool: &BashTool, command: &str) -> Result<String, ToolError> {
    run(tool, "bash", json!({ "command": command }))
}

fn bash_with_timeout(tool: &BashTool, command: &str, timeout: u64) -> Result<String, ToolError> {
    run(tool, "bash", json!({ "command": command, "timeout": timeout }))
}

fn failure(result: Result<String, ToolError>) -> String {
    match result {
        Ok(output) => panic!("expected the command to fail, got {output}"),
        Err(error) => error.to_string(),
    }
}

#[test]
fn a_command_starts_in_the_workdir_every_time_and_cd_does_not_carry_over() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    assert_eq!(
        bash(&tool, "pwd").expect("pwd"),
        format!("{}\nexit code: 0", workdir.display())
    );
    assert!(bash(&tool, "cd /tmp && export X=1 && pwd")
        .expect("cd")
        .ends_with("/tmp\nexit code: 0"));
    assert_eq!(
        bash(&tool, "pwd; echo \"x=$X\"").expect("fresh"),
        format!("{}\nx=\nexit code: 0", workdir.display())
    );
}

#[test]
fn a_command_that_reads_stdin_gets_nothing_and_ends() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    assert_eq!(
        bash(&tool, "cat; echo after").expect("cat"),
        "after\nexit code: 0"
    );
}

#[test]
fn stdout_and_stderr_come_back_in_the_order_they_were_written() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    assert_eq!(
        bash(&tool, "echo one; echo two >&2; echo three; echo four >&2").expect("order"),
        "one\ntwo\nthree\nfour\nexit code: 0"
    );
}

#[test]
fn a_command_that_ends_with_an_exit_code_other_than_zero_is_an_error_with_its_output() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    assert_eq!(
        failure(bash(&tool, "echo 'no such thing' >&2; exit 3")),
        "no such thing\nexit code: 3"
    );
}

#[test]
fn output_past_the_limit_keeps_its_end_and_says_how_much_was_cut() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    let out = bash(
        &tool,
        &format!("head -c {} /dev/zero | tr '\\0' a; echo END", OUTPUT_LIMIT + 5_000),
    )
    .expect("output");
    assert!(out.starts_with("[the first 5004 characters were cut]\n"));
    assert!(out.ends_with("END\nexit code: 0"));
    assert!(out.len() < OUTPUT_LIMIT + 100);
}

#[test]
fn a_command_past_its_time_is_stopped_with_everything_it_started() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    let marker = format!("veeloe-test-{}-{}", std::process::id(), now());
    let started = Instant::now();
    let message = failure(bash_with_timeout(
        &tool,
        &format!("echo started; (exec -a {marker} sleep 300) & exec -a {marker} sleep 300"),
        5,
    ));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(message, "started\ntimed out after 5 seconds, so it was stopped");
    std::thread::sleep(Duration::from_millis(100));
    assert!(pgrep(&marker).is_empty());
}

#[test]
fn a_timeout_without_a_number_is_120_seconds_and_none_is_longer_than_600() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    assert_eq!(
        failure(bash(&tool, "sleep 300")),
        "timed out after 120 seconds, so it was stopped"
    );
    let started = Instant::now();
    assert_eq!(
        failure(bash_with_timeout(&tool, "sleep 300", 3_600)),
        "timed out after 600 seconds, so it was stopped"
    );
    assert!(started.elapsed() < Duration::from_secs(14));
}

#[test]
fn what_a_command_left_running_in_the_background_does_not_outlive_it() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    let marker = format!("veeloe-bg-{}-{}", std::process::id(), now());
    assert_eq!(
        bash(&tool, &format!("(exec -a {marker} sleep 300) & echo left")).expect("left"),
        "left\nexit code: 0"
    );
    std::thread::sleep(Duration::from_millis(100));
    assert!(pgrep(&marker).is_empty());
}

#[test]
fn a_command_does_not_get_the_variables_the_worker_reaches_the_supervisor_by() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    assert_eq!(
        bash(&tool, "env | grep -c NODE_CHANNEL || true").expect("env"),
        "0\nexit code: 0"
    );
}

#[test]
fn a_stop_kills_the_command_and_everything_it_started_and_says_the_owner_stopped_it() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    let marker = format!("veeloe-stop-{}-{}", std::process::id(), now());
    let cancel = Cancel::new();
    let running = {
        let cancel = cancel.clone();
        let command = json!({ "command": format!("echo started; exec -a {marker} sleep 300") });
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            runtime.block_on(async move { tool.run("bash", &command, &cancel).await })
        })
    };
    std::thread::sleep(Duration::from_millis(200));
    let started = Instant::now();
    cancel.cancel();
    let message = failure(running.join().expect("thread"));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        message,
        "started\nthe owner stopped this Turn before the command finished"
    );
    std::thread::sleep(Duration::from_millis(100));
    assert!(pgrep(&marker).is_empty());
}

#[test]
fn a_stop_that_arrives_before_the_command_starts_leaves_nothing_behind() {
    let (_root, workdir) = workdir();
    let tool = bash_tool(&workdir);
    let cancel = Cancel::new();
    cancel.cancel();
    let message = failure(run_with(
        &tool,
        "bash",
        json!({ "command": "sleep 300" }),
        &cancel,
    ));
    assert_eq!(
        message,
        "the owner stopped this Turn before the command finished"
    );
    let again = failure(run_with(
        &tool,
        "bash",
        json!({ "command": "echo x" }),
        &cancel,
    ));
    assert!(again.contains("the owner stopped this Turn"));
}

fn now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

fn pgrep(marker: &str) -> String {
    Command::new("pgrep")
        .arg("-f")
        .arg(marker)
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

// ---------------------------------------------------------------- files

struct Files {
    workdir: PathBuf,
    tools: FileTools,
}

fn files() -> (tempfile::TempDir, Files) {
    let (root, workdir) = workdir();
    let tools = FileTools::new(&workdir, false);
    (root, Files { workdir, tools })
}

#[test]
fn a_path_is_relative_to_the_workdir_or_absolute_inside_it_and_never_outside() {
    let (_root, files) = files();
    fs::write(files.workdir.join("a.txt"), "hello").expect("write");
    assert!(run(&files.tools, "read", json!({ "path": "a.txt" }))
        .expect("relative")
        .contains("1\thello"));
    assert!(run(
        &files.tools,
        "read",
        json!({ "path": files.workdir.join("a.txt").to_string_lossy() })
    )
    .expect("absolute")
    .contains("1\thello"));
    assert!(failure(run(&files.tools, "read", json!({ "path": "../a.txt" }))).contains("outside"));
    assert!(failure(run(&files.tools, "read", json!({ "path": "/etc/hosts" }))).contains("outside"));
}

#[test]
fn a_symlink_that_leaves_the_workdir_is_refused_for_reading_and_writing() {
    let (_root, files) = files();
    let outside = tempdir().expect("outside");
    fs::write(outside.path().join("secret.txt"), "secret").expect("write");
    symlink(
        outside.path().join("secret.txt"),
        files.workdir.join("link.txt"),
    )
    .expect("link");
    symlink(outside.path(), files.workdir.join("outside-folder")).expect("folder link");

    assert!(failure(run(&files.tools, "read", json!({ "path": "link.txt" }))).contains("outside"));
    assert!(failure(run(
        &files.tools,
        "write",
        json!({ "path": "link.txt", "content": "changed" })
    ))
    .contains("outside"));
    assert!(failure(run(
        &files.tools,
        "write",
        json!({ "path": "outside-folder/new.txt", "content": "x" })
    ))
    .contains("outside"));
    assert_eq!(
        fs::read_to_string(outside.path().join("secret.txt")).expect("secret"),
        "secret"
    );
}

#[test]
fn glob_and_grep_skip_a_symlink_that_leaves_the_workdir() {
    let (_root, files) = files();
    let outside = tempdir().expect("outside");
    fs::write(outside.path().join("leak.ts"), "NEEDLE").expect("write");
    symlink(outside.path().join("leak.ts"), files.workdir.join("leak.ts")).expect("link");

    let found = run(&files.tools, "glob", json!({ "pattern": "**/*.ts" })).expect("glob");
    assert!(!found.contains("leak.ts"));
    assert_eq!(
        run(&files.tools, "grep", json!({ "pattern": "NEEDLE" })).expect("grep"),
        "no matches"
    );
}

#[test]
fn read_numbers_the_lines_and_can_take_a_slice() {
    let (_root, files) = files();
    fs::write(files.workdir.join("short.txt"), "a\nb\nc").expect("write");
    assert_eq!(
        run(&files.tools, "read", json!({ "path": "short.txt" })).expect("read"),
        "1\ta\n2\tb\n3\tc"
    );
    let ten: Vec<String> = (1..=10).map(|line| format!("line {line}")).collect();
    fs::write(files.workdir.join("ten.txt"), ten.join("\n")).expect("write");
    assert_eq!(
        run(
            &files.tools,
            "read",
            json!({ "path": "ten.txt", "offset": 3, "limit": 2 })
        )
        .expect("slice"),
        "3\tline 3\n4\tline 4"
    );
}

#[test]
fn read_cuts_a_long_file_and_says_how_many_lines_are_left() {
    let (_root, files) = files();
    let long: Vec<String> = (1..=5_000).map(|line| format!("line {line}")).collect();
    fs::write(files.workdir.join("long.txt"), long.join("\n")).expect("write");
    let result = run(&files.tools, "read", json!({ "path": "long.txt" })).expect("read");
    let lines: Vec<&str> = result.split('\n').collect();
    assert_eq!(lines.len(), 2_001);
    assert!(lines[2_000].contains("truncated"));
    assert!(result.contains("3000 more lines; continue with offset 2001"));
}

#[test]
fn read_stops_at_256kb_of_text_and_says_where_to_continue() {
    let (_root, files) = files();
    let wide: Vec<String> = (1..=100)
        .map(|line| format!("line {line} {}", "x".repeat(5_000)))
        .collect();
    fs::write(files.workdir.join("wide.txt"), wide.join("\n")).expect("write");
    let result = run(&files.tools, "read", json!({ "path": "wide.txt" })).expect("read");
    let text = result.split("\n[truncated:").next().expect("text");
    assert!(text.len() <= 256 * 1024);
    assert!(result.contains("more lines; continue with offset"));
}

#[test]
fn read_refuses_a_binary_file_a_missing_file_and_one_over_10mb() {
    let (_root, files) = files();
    fs::write(files.workdir.join("binary.bin"), [0x41u8, 0x00, 0x42]).expect("write");
    assert!(failure(run(
        &files.tools,
        "read",
        json!({ "path": "binary.bin" })
    ))
    .contains("binary"));
    assert!(failure(run(
        &files.tools,
        "read",
        json!({ "path": "missing.txt" })
    ))
    .contains("no such file"));
    fs::write(
        files.workdir.join("huge.bin"),
        vec![0x41u8; 10 * 1024 * 1024 + 1],
    )
    .expect("write");
    assert!(failure(run(
        &files.tools,
        "read",
        json!({ "path": "huge.bin" })
    ))
    .contains("larger than 10MB"));
}

#[test]
fn send_file_refuses_a_file_over_20mb_and_says_where_to_put_it_instead() {
    let (_root, files) = files();
    fs::write(
        files.workdir.join("huge-report.bin"),
        vec![0x41u8; 20 * 1024 * 1024 + 1],
    )
    .expect("write");
    let said = failure(run(
        &files.tools,
        "send_file",
        json!({ "path": "huge-report.bin" }),
    ));
    assert!(said.contains("20 MB"));
    assert!(said.contains("git"));
}

#[test]
fn write_creates_folders_overwrites_atomically_and_keeps_an_existing_files_mode() {
    let (_root, files) = files();
    assert!(run(
        &files.tools,
        "write",
        json!({ "path": "a/b/c.txt", "content": "hello" })
    )
    .expect("write")
    .contains("Wrote 5 bytes"));
    assert_eq!(
        fs::read_to_string(files.workdir.join("a/b/c.txt")).expect("read"),
        "hello"
    );
    assert!(!fs::read_dir(files.workdir.join("a/b"))
        .expect("dir")
        .filter_map(Result::ok)
        .any(|entry| entry.file_name().to_string_lossy().contains(".tmp-")));

    fs::write(files.workdir.join("mode.txt"), "old").expect("write");
    fs::set_permissions(
        files.workdir.join("mode.txt"),
        fs::Permissions::from_mode(0o640),
    )
    .expect("mode");
    let mode = fs::metadata(files.workdir.join("mode.txt"))
        .expect("stat")
        .permissions()
        .mode()
        & 0o777;
    run(
        &files.tools,
        "write",
        json!({ "path": "mode.txt", "content": "new" }),
    )
    .expect("write");
    assert_eq!(
        fs::read_to_string(files.workdir.join("mode.txt")).expect("read"),
        "new"
    );
    assert_eq!(
        fs::metadata(files.workdir.join("mode.txt"))
            .expect("stat")
            .permissions()
            .mode()
            & 0o777,
        mode
    );
}

#[test]
fn write_refuses_too_much_content_a_folder_and_a_path_outside() {
    let (_root, files) = files();
    assert!(failure(run(
        &files.tools,
        "write",
        json!({ "path": "big.txt", "content": "x".repeat(2 * 1024 * 1024 + 1) })
    ))
    .contains("larger than 2MB"));
    fs::create_dir(files.workdir.join("folder")).expect("folder");
    assert!(failure(run(
        &files.tools,
        "write",
        json!({ "path": "folder", "content": "x" })
    ))
    .contains("not a file"));
    assert!(failure(run(
        &files.tools,
        "write",
        json!({ "path": "../escape.txt", "content": "x" })
    ))
    .contains("outside"));
}

#[test]
fn edit_replaces_exactly_one_occurrence_and_keeps_the_files_mode() {
    let (_root, files) = files();
    fs::write(files.workdir.join("one.txt"), "hello world").expect("write");
    fs::set_permissions(
        files.workdir.join("one.txt"),
        fs::Permissions::from_mode(0o640),
    )
    .expect("mode");
    let mode = fs::metadata(files.workdir.join("one.txt"))
        .expect("stat")
        .permissions()
        .mode()
        & 0o777;
    assert!(run(
        &files.tools,
        "edit",
        json!({ "path": "one.txt", "old_string": "hello", "new_string": "hi" })
    )
    .expect("edit")
    .contains("replaced 1 occurrence"));
    assert_eq!(
        fs::read_to_string(files.workdir.join("one.txt")).expect("read"),
        "hi world"
    );
    assert_eq!(
        fs::metadata(files.workdir.join("one.txt"))
            .expect("stat")
            .permissions()
            .mode()
            & 0o777,
        mode
    );
}

#[test]
fn edit_writes_nothing_when_the_text_is_missing_or_appears_many_times_and_can_replace_all() {
    let (_root, files) = files();
    fs::write(files.workdir.join("many.txt"), "a a a").expect("write");
    assert!(failure(run(
        &files.tools,
        "edit",
        json!({ "path": "many.txt", "old_string": "zzz", "new_string": "b" })
    ))
    .contains("0 times"));
    assert!(failure(run(
        &files.tools,
        "edit",
        json!({ "path": "many.txt", "old_string": "a", "new_string": "b" })
    ))
    .contains("3 times"));
    assert_eq!(
        fs::read_to_string(files.workdir.join("many.txt")).expect("read"),
        "a a a"
    );
    assert!(run(
        &files.tools,
        "edit",
        json!({ "path": "many.txt", "old_string": "a", "new_string": "b", "replace_all": true })
    )
    .expect("replace all")
    .contains("replaced 3 occurrences"));
    assert_eq!(
        fs::read_to_string(files.workdir.join("many.txt")).expect("read"),
        "b b b"
    );
    assert!(failure(run(
        &files.tools,
        "edit",
        json!({ "path": "many.txt", "old_string": "", "new_string": "x" })
    ))
    .contains("old_string is required"));
}

#[test]
fn edit_refuses_an_edited_file_over_2mb_and_leaves_the_file_as_it_was() {
    let (_root, files) = files();
    fs::write(files.workdir.join("one.txt"), "a").expect("write");
    assert!(failure(run(
        &files.tools,
        "edit",
        json!({ "path": "one.txt", "old_string": "a", "new_string": "x".repeat(2 * 1024 * 1024 + 1) })
    ))
    .contains("larger than 2MB"));
    assert_eq!(
        fs::read_to_string(files.workdir.join("one.txt")).expect("read"),
        "a"
    );
}

#[test]
fn glob_finds_files_by_pattern_skips_git_and_node_modules_and_caps_the_answer() {
    let (_root, files) = files();
    fs::create_dir(files.workdir.join("src")).expect("src");
    fs::create_dir(files.workdir.join("node_modules")).expect("node_modules");
    fs::create_dir(files.workdir.join(".git")).expect(".git");
    fs::write(files.workdir.join("a.ts"), "").expect("write");
    fs::write(files.workdir.join("src/b.ts"), "").expect("write");
    fs::write(files.workdir.join("node_modules/x.ts"), "").expect("write");
    fs::write(files.workdir.join(".git/y.ts"), "").expect("write");

    assert_eq!(
        run(&files.tools, "glob", json!({ "pattern": "**/*.ts" })).expect("glob"),
        "a.ts\nsrc/b.ts"
    );
    assert_eq!(
        run(&files.tools, "glob", json!({ "pattern": "**/*.nope" })).expect("none"),
        "no files matched"
    );
    assert!(failure(run(
        &files.tools,
        "glob",
        json!({ "pattern": "../*" })
    ))
    .contains("inside"));

    fs::create_dir(files.workdir.join("lots")).expect("lots");
    for index in 0..205 {
        fs::write(files.workdir.join(format!("lots/{index}.txt")), "").expect("write");
    }
    let capped = run(&files.tools, "glob", json!({ "pattern": "lots/*.txt" })).expect("capped");
    assert_eq!(
        capped
            .split('\n')
            .filter(|line| line.ends_with(".txt"))
            .count(),
        200
    );
    assert!(capped.contains("more files match"));
}

#[test]
fn grep_returns_path_and_line_respects_include_and_case_skips_binary_and_caps_results() {
    let (_root, files) = files();
    fs::create_dir(files.workdir.join("src")).expect("src");
    fs::write(
        files.workdir.join("src/a.ts"),
        "TODO one\nconst x = 1\nTODO two",
    )
    .expect("write");
    fs::write(files.workdir.join("b.js"), "todo three").expect("write");

    assert_eq!(
        run(
            &files.tools,
            "grep",
            json!({ "pattern": "TODO", "include": "**/*.ts" })
        )
        .expect("grep"),
        "src/a.ts:1: TODO one\nsrc/a.ts:3: TODO two"
    );
    assert!(run(
        &files.tools,
        "grep",
        json!({ "pattern": "todo", "ignore_case": true })
    )
    .expect("case")
    .contains("b.js:1: todo three"));
    assert_eq!(
        run(&files.tools, "grep", json!({ "pattern": "nothing-here" })).expect("none"),
        "no matches"
    );
    assert!(failure(run(&files.tools, "grep", json!({ "pattern": "(" })))
        .contains("invalid regular expression"));
    assert!(failure(run(
        &files.tools,
        "grep",
        json!({ "pattern": "x", "include": "../*" })
    ))
    .contains("include must stay inside"));

    fs::write(
        files.workdir.join("binary.bin"),
        [0x54u8, 0x00, 0x4f, 0x44, 0x4f],
    )
    .expect("write");
    assert!(!run(&files.tools, "grep", json!({ "pattern": "TODO" }))
        .expect("grep")
        .contains("binary.bin"));

    let many: Vec<&str> = (0..250).map(|_| "hit").collect();
    fs::write(files.workdir.join("many.log"), many.join("\n")).expect("write");
    let capped = run(
        &files.tools,
        "grep",
        json!({ "pattern": "hit", "include": "many.log" }),
    )
    .expect("capped");
    assert_eq!(
        capped
            .split('\n')
            .filter(|line| line.starts_with("many.log:"))
            .count(),
        200
    );
    assert!(capped.contains("more matches"));
}

#[test]
fn the_read_only_runner_reads_globs_greps_and_offers_files_but_cannot_write() {
    let (_root, files) = files();
    let read_only = FileTools::new(&files.workdir, true);
    let names: Vec<String> = read_only
        .definitions()
        .into_iter()
        .map(|definition| definition.name)
        .collect();
    assert_eq!(names, vec!["read", "glob", "grep", "send_file"]);
    assert!(failure(run(
        &read_only,
        "write",
        json!({ "path": "x.txt", "content": "x" })
    ))
    .contains("no tool named write"));
    assert!(failure(run(
        &read_only,
        "edit",
        json!({ "path": "x.txt", "old_string": "a", "new_string": "b" })
    ))
    .contains("no tool named edit"));
    let names: Vec<String> = files
        .tools
        .definitions()
        .into_iter()
        .map(|definition| definition.name)
        .collect();
    assert_eq!(
        names,
        vec!["read", "glob", "grep", "write", "edit", "send_file"]
    );
}
