//! Issue #32: the seccomp filter a Linux worker installs on itself. A real
//! program runs under it, so the check is what a command sees, not the BPF.
//! Each refusal is told apart from what the call does without the filter.
#![cfg(target_os = "linux")]

use std::os::unix::process::CommandExt;
use std::process::Command;

use veeloe_runtime_worker::seccomp::Filter;

/// Prints one JSON object: the errno each refused call answered (0 when it
/// went through), and what still has to work.
const PROBE: &str = r#"
import ctypes, json, socket, subprocess, tempfile, threading
libc = ctypes.CDLL(None, use_errno=True)
def call(fn, *args):
    ctypes.set_errno(0)
    return 0 if fn(*args) >= 0 else ctypes.get_errno()
out = {}
out["io_uring_setup"] = call(libc.syscall, 425, 1, ctypes.create_string_buffer(120))
out["clone3"] = call(libc.syscall, 435, None, 0)
out["unshare_user"] = call(libc.unshare, 0x10000000)
out["setns"] = call(libc.setns, 0, 0)
out["mount"] = call(libc.mount, b"none", tempfile.mkdtemp().encode(), b"tmpfs", 0, None)
try:
    socket.socket(40, socket.SOCK_STREAM)
    out["vsock"] = 0
except OSError as error:
    out["vsock"] = error.errno
a, b = socket.socketpair(socket.AF_UNIX)
a.send(b"x")
out["unix"] = b.recv(1).decode()
thread = threading.Thread(target=lambda: out.__setitem__("thread", "ran"))
thread.start()
thread.join()
out["child"] = subprocess.run(["true"]).returncode
print(json.dumps(out))
"#;

#[test]
fn a_command_under_the_filter_keeps_threads_children_and_unix_sockets_and_nothing_it_refuses() {
    let filter = Filter::new().expect("a filter for this architecture");
    let mut command = Command::new("python3");
    command.args(["-c", PROBE]);
    // SAFETY: `install` only makes system calls, so it is safe after `fork`.
    unsafe {
        command.pre_exec(move || filter.install());
    }
    let output = command.output().expect("python3 runs");
    assert!(
        output.status.success(),
        "the probe failed under the filter: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&output.stdout).expect("the probe's JSON");

    const EPERM: i64 = 1;
    const ENOSYS: i64 = 38;
    // ENOSYS, as a kernel without io_uring answers, so libuv falls back.
    assert_eq!(seen["io_uring_setup"], ENOSYS, "{seen}");
    // glibc falls back from clone3 to clone on ENOSYS; without the filter a
    // size of 0 is EINVAL.
    assert_eq!(seen["clone3"], ENOSYS, "{seen}");
    assert_eq!(seen["unshare_user"], EPERM, "{seen}");
    // Without the filter, fd 0 is not a namespace: EINVAL.
    assert_eq!(seen["setns"], EPERM, "{seen}");
    assert_eq!(seen["mount"], EPERM, "{seen}");
    assert_eq!(seen["vsock"], EPERM, "{seen}");
    // What Postgres, Redis and every program still need.
    assert_eq!(seen["unix"], "x", "{seen}");
    assert_eq!(seen["thread"], "ran", "{seen}");
    assert_eq!(seen["child"], 0, "{seen}");
}
