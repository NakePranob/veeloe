//! Installing the Runtime as a user-level service, so Agents keep running
//! after the terminal closes or the Machine logs in again (ADR 0048, v0.1).

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::trust::{load_trust, supervisor_dir};

const LABEL: &str = "dev.veeloe.runtime";
#[cfg(target_os = "linux")]
const UNIT: &str = "veeloe.service";

/// Install and start the service for `home` using this executable.
pub fn install(home: &Path) -> Result<(), String> {
    if load_trust(home).map_err(|error| error.to_string())?.owners.is_empty() {
        return Err("this Machine is not paired: run veeloe pair first".into());
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = supervisor_dir(home).map_err(|error| error.to_string())?;
    let log_dir = dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let log = log_dir.join("service.log");
    #[cfg(target_os = "macos")]
    {
        let home_dir = user_home()?;
        let plist = home_dir.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
        if let Some(parent) = plist.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&plist, launchd_plist(&exe, home, &log)).map_err(|error| error.to_string())?;
        let uid = uid()?;
        let _ = Command::new("launchctl").args(["bootout", &format!("gui/{uid}/{LABEL}")]).status();
        let plist_path = path(&plist)?;
        run(Command::new("launchctl").args(["bootstrap", &format!("gui/{uid}"), &plist_path]))?;
        println!("installed {LABEL}; run: launchctl print gui/{uid}/{LABEL}");
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let unit = user_home()?.join(".config/systemd/user").join(UNIT);
        if let Some(parent) = unit.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&unit, systemd_unit(&exe, home, &log)).map_err(|error| error.to_string())?;
        run(Command::new("systemctl").args(["--user", "daemon-reload"]))?;
        run(Command::new("systemctl").args(["--user", "enable", "--now", UNIT]))?;
        println!("installed {UNIT}; run: systemctl --user status {UNIT}");
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (exe, log);
        Err("service install is supported on macOS and Linux only".into())
    }
}

/// Stop the service and remove its definition. Data under `home` stays.
pub fn uninstall(_home: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let plist = user_home()?.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
        let uid = uid()?;
        let _ = Command::new("launchctl").args(["bootout", &format!("gui/{uid}/{LABEL}")]).status();
        if plist.exists() {
            fs::remove_file(&plist).map_err(|error| error.to_string())?;
        }
        println!("removed {LABEL}");
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let unit = user_home()?.join(".config/systemd/user").join(UNIT);
        let _ = Command::new("systemctl").args(["--user", "disable", "--now", UNIT]).status();
        if unit.exists() {
            fs::remove_file(&unit).map_err(|error| error.to_string())?;
        }
        let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).status();
        println!("removed {UNIT}");
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("service uninstall is supported on macOS and Linux only".into())
    }
}

pub fn launchd_plist(exe: &Path, home: &Path, log: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{exe}</string></array>
  <key>EnvironmentVariables</key><dict><key>VEELOE_HOME</key><string>{home}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
"#,
        exe = xml(path(exe).unwrap_or_default().as_str()),
        home = xml(&home.display().to_string()),
        log = xml(&log.display().to_string()),
    )
}

pub fn systemd_unit(exe: &Path, home: &Path, log: &Path) -> String {
    let mut out = String::new();
    writeln!(out, "[Unit]").unwrap();
    writeln!(out, "Description=Veeloe Runtime").unwrap();
    writeln!(out, "After=network-online.target").unwrap();
    writeln!(out, "\n[Service]").unwrap();
    writeln!(out, "Type=simple").unwrap();
    writeln!(out, "ExecStart={}", quote(&path(exe).unwrap_or_default())).unwrap();
    writeln!(out, "Environment=VEELOE_HOME={}", quote(&home.display().to_string())).unwrap();
    writeln!(out, "Restart=always").unwrap();
    writeln!(out, "RestartSec=5").unwrap();
    writeln!(out, "StandardOutput=append:{}", log.display()).unwrap();
    writeln!(out, "StandardError=append:{}", log.display()).unwrap();
    writeln!(out, "\n[Install]").unwrap();
    writeln!(out, "WantedBy=default.target").unwrap();
    out
}

fn path(path: &Path) -> Result<String, String> {
    path.to_str().map(str::to_string).ok_or_else(|| format!("path is not UTF-8: {}", path.display()))
}

fn user_home() -> Result<PathBuf, String> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "HOME is not set".into())
}

#[cfg(target_os = "macos")]
fn uid() -> Result<String, String> {
    let output = Command::new("id").arg("-u").output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("could not read the current user id".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run(command: &mut Command) -> Result<(), String> {
    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("command failed: {}{}", command.get_program().to_string_lossy(), if stderr.trim().is_empty() { String::new() } else { format!(": {}", stderr.trim()) }))
}

fn xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn quote(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_launch_agent_names_the_runtime_home_and_log() {
        let text = launchd_plist(Path::new("/Applications/Veeloe & Co/veeloe"), Path::new("/tmp/home"), Path::new("/tmp/home/runtime/logs/service.log"));
        assert!(text.contains("<string>dev.veeloe.runtime</string>"));
        assert!(text.contains("Veeloe &amp; Co"));
        assert!(text.contains("<key>VEELOE_HOME</key><string>/tmp/home</string>"));
        assert!(text.contains("service.log"));
    }

    #[test]
    fn a_systemd_unit_names_the_runtime_home_and_log() {
        let text = systemd_unit(Path::new("/opt/veeloe"), Path::new("/tmp/home"), Path::new("/tmp/home/runtime/logs/service.log"));
        assert!(text.contains("ExecStart=\"/opt/veeloe\""));
        assert!(text.contains("Environment=VEELOE_HOME=\"/tmp/home\""));
        assert!(text.contains("StandardOutput=append:/tmp/home/runtime/logs/service.log"));
        assert!(text.contains("WantedBy=default.target"));
    }
}
