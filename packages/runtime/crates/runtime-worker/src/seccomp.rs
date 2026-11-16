//! The system calls a worker, and every command it starts, may not make on
//! Linux (ADR 0069, issue #32).
//!
//! `bwrap` already gives the worker namespaces of its own and drops its
//! capabilities. This filter closes what an unprivileged process can still
//! reach inside them:
//!
//! - io_uring, which has carried a long run of kernel bugs and does file and
//!   network I/O where seccomp cannot see it. It answers ENOSYS, as a kernel
//!   built without it does, so libuv and the like fall back on their own.
//! - AF_VSOCK, a way to a VM's host that never passes the proxy.
//! - a user namespace of its own (`unshare`/`clone` with `CLONE_NEWUSER`),
//!   where a command would hold every capability again. `clone3` hides its
//!   flags from seccomp, so it answers ENOSYS and glibc falls back to `clone`.
//! - `mount` and its newer API, `pivot_root` and `setns`.
//!
//! AF_UNIX stays open: Postgres and Redis listen on it.
//!
//! The worker installs it on itself before it does anything else; a filter is
//! inherited across `fork` and `exec`, so every command gets the same one. If
//! it cannot be installed the worker does not start (fail closed, ADR 0069).

/// Installs the filter on this process and all its threads. A no-op where
/// there is no seccomp.
pub fn confine_self() -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        Filter::new()?.install()
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
pub use linux::Filter;

#[cfg(target_os = "linux")]
mod linux {
    use libc::{c_long, sock_filter, sock_fprog};

    // Classic BPF opcodes (linux/filter.h).
    const LD_W_ABS: u16 = 0x20;
    const JEQ_K: u16 = 0x15;
    const JGE_K: u16 = 0x35;
    const JSET_K: u16 = 0x45;
    const RET_K: u16 = 0x06;

    // Offsets in `struct seccomp_data`. An argument is 64 bits; its low half
    // comes first on these little-endian machines, and every flag and family
    // checked here is in that half.
    const NR: u32 = 0;
    const ARCH: u32 = 4;
    const ARG0: u32 = 16;

    const ALLOW: u32 = 0x7fff_0000;
    const KILL_PROCESS: u32 = 0x8000_0000;
    const fn errno(code: i32) -> u32 {
        0x0005_0000 | (code as u32 & 0xffff)
    }

    #[cfg(target_arch = "x86_64")]
    const AUDIT_ARCH: Option<u32> = Some(0xc000_003e);
    #[cfg(target_arch = "aarch64")]
    const AUDIT_ARCH: Option<u32> = Some(0xc000_00b7);
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    const AUDIT_ARCH: Option<u32> = None;

    /// x32 calls on x86_64 carry this bit in their number; nothing here needs
    /// one, and their numbers would slip past the list below.
    const X32_BIT: u32 = 0x4000_0000;
    const AF_VSOCK: u32 = 40;

    /// Refused outright, with the errno each answers.
    const REFUSED: &[(c_long, i32)] = &[
        (libc::SYS_io_uring_setup, libc::ENOSYS),
        (libc::SYS_io_uring_enter, libc::ENOSYS),
        (libc::SYS_io_uring_register, libc::ENOSYS),
        (libc::SYS_clone3, libc::ENOSYS),
        (libc::SYS_mount, libc::EPERM),
        (libc::SYS_umount2, libc::EPERM),
        (libc::SYS_pivot_root, libc::EPERM),
        (libc::SYS_open_tree, libc::EPERM),
        (libc::SYS_move_mount, libc::EPERM),
        (libc::SYS_fsopen, libc::EPERM),
        (libc::SYS_fsconfig, libc::EPERM),
        (libc::SYS_fsmount, libc::EPERM),
        (libc::SYS_fspick, libc::EPERM),
        (libc::SYS_mount_setattr, libc::EPERM),
        (libc::SYS_setns, libc::EPERM),
    ];

    /// The filter, built ahead of the fork it may be installed after: building
    /// allocates, installing does not.
    pub struct Filter(Vec<sock_filter>);

    fn stmt(code: u16, k: u32) -> sock_filter {
        sock_filter {
            code,
            jt: 0,
            jf: 0,
            k,
        }
    }

    /// `jt`/`jf` count the instructions to skip after this one.
    fn jump(code: u16, k: u32, jt: u8, jf: u8) -> sock_filter {
        sock_filter { code, jt, jf, k }
    }

    impl Filter {
        pub fn new() -> std::io::Result<Self> {
            let Some(arch) = AUDIT_ARCH else {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "no seccomp filter for this CPU architecture",
                ));
            };
            let mut program = vec![
                // A call made through another ABI (i386 on x86_64) has other
                // numbers, so none of the checks below would hold for it.
                stmt(LD_W_ABS, ARCH),
                jump(JEQ_K, arch, 1, 0),
                stmt(RET_K, KILL_PROCESS),
                stmt(LD_W_ABS, NR),
                jump(JGE_K, X32_BIT, 0, 1),
                stmt(RET_K, errno(libc::ENOSYS)),
            ];
            for &(nr, code) in REFUSED {
                program.push(jump(JEQ_K, nr as u32, 0, 1));
                program.push(stmt(RET_K, errno(code)));
            }
            // A thread or a child is still a clone; only a new user namespace
            // is refused.
            for nr in [libc::SYS_unshare, libc::SYS_clone] {
                program.extend([
                    jump(JEQ_K, nr as u32, 0, 4),
                    stmt(LD_W_ABS, ARG0),
                    jump(JSET_K, libc::CLONE_NEWUSER as u32, 0, 1),
                    stmt(RET_K, errno(libc::EPERM)),
                    stmt(RET_K, ALLOW),
                ]);
            }
            program.extend([
                jump(JEQ_K, libc::SYS_socket as u32, 0, 4),
                stmt(LD_W_ABS, ARG0),
                jump(JEQ_K, AF_VSOCK, 0, 1),
                stmt(RET_K, errno(libc::EPERM)),
                stmt(RET_K, ALLOW),
                stmt(RET_K, ALLOW),
            ]);
            Ok(Self(program))
        }

        /// Sets `no_new_privs` and installs the filter on every thread of this
        /// process. Makes system calls only, so it is safe between `fork` and
        /// `exec`.
        pub fn install(&self) -> std::io::Result<()> {
            let program = sock_fprog {
                len: self.0.len() as u16,
                filter: self.0.as_ptr() as *mut sock_filter,
            };
            // SAFETY: `program` points at `self.0`, which outlives the call;
            // the kernel copies the filter before it returns.
            unsafe {
                if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                let answer = libc::syscall(
                    libc::SYS_seccomp,
                    libc::SECCOMP_SET_MODE_FILTER,
                    libc::SECCOMP_FILTER_FLAG_TSYNC,
                    &program as *const sock_fprog,
                );
                // With TSYNC a positive answer names a thread that could not
                // take the filter.
                if answer != 0 {
                    return Err(if answer < 0 {
                        std::io::Error::last_os_error()
                    } else {
                        std::io::Error::other(format!("thread {answer} could not take the filter"))
                    });
                }
            }
            Ok(())
        }
    }
}
