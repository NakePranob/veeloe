//! Content-free logs on the Machine (ADR 0052): one JSON line per event, one
//! file per day, kept for 14 days. Callers pass codes and identifiers only;
//! task text, tool output and file names never belong here.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;

use serde_json::{json, Value};

use crate::trust::supervisor_dir;

const KEEP_DAYS: u64 = 14;

fn day_at(seconds: u64) -> u64 {
    seconds / 86_400
}

fn dir(home: &Path) -> Result<PathBuf, io::Error> {
    let dir = supervisor_dir(home).map_err(|error| io::Error::other(error.to_string()))?.join("logs");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Append one event. `fields` must hold identifiers, codes and numbers only.
pub fn record(home: &Path, level: &str, event: &str, fields: Value) -> io::Result<()> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    record_at(home, now, level, event, fields)
}

pub fn record_at(home: &Path, seconds: u64, level: &str, event: &str, fields: Value) -> io::Result<()> {
    let dir = dir(home)?;
    purge_at(&dir, day_at(seconds))?;
    let file = dir.join(format!("{}.log", day_at(seconds)));
    let line = json!({ "at": seconds, "level": level, "event": event, "fields": fields });
    let mut handle = OpenOptions::new().create(true).append(true).open(file)?;
    writeln!(handle, "{line}")
}

/// Old log lines, oldest day first. Missing files read as an empty log.
pub fn recent(home: &Path) -> io::Result<Vec<String>> {
    let dir = dir(home)?;
    let mut files = log_files(&dir)?;
    files.sort();
    let mut lines = Vec::new();
    for (_, file) in files {
        lines.extend(fs::read_to_string(file)?.lines().map(str::to_string));
    }
    Ok(lines)
}

/// Print the log, and with `follow` wait for new lines until the process is stopped.
pub fn run(home: &Path, follow: bool) -> io::Result<()> {
    for line in recent(home)? {
        println!("{line}");
    }
    if !follow {
        return Ok(());
    }
    let dir = dir(home)?;
    let mut offsets: HashMap<PathBuf, usize> = HashMap::new();
    for (_, file) in log_files(&dir)? {
        offsets.insert(file.clone(), fs::read_to_string(&file)?.len());
    }
    loop {
        let mut files = log_files(&dir)?;
        files.sort();
        for (_, file) in files {
            let text = fs::read_to_string(&file)?;
            let offset = offsets.entry(file.clone()).or_insert(0);
            if *offset <= text.len() {
                for line in text[*offset..].lines() {
                    println!("{line}");
                }
                *offset = text.len();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

fn log_files(dir: &Path) -> io::Result<Vec<(u64, PathBuf)>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let Some(day) = path.file_stem().and_then(|name| name.to_str()).and_then(|name| name.parse::<u64>().ok()) else {
            continue;
        };
        if path.extension().is_some_and(|ext| ext == "log") {
            files.push((day, path));
        }
    }
    Ok(files)
}

fn purge_at(dir: &Path, today: u64) -> io::Result<()> {
    for (day, path) in log_files(dir)? {
        if day + KEEP_DAYS < today {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn an_event_is_one_json_line_with_only_the_fields_given() {
        let home = tempdir().expect("home");
        record_at(home.path(), 86_400 * 20, "info", "task.turn", json!({ "agent": "a1", "turn": 2 })).expect("record");
        let lines = recent(home.path()).expect("recent");
        assert_eq!(lines.len(), 1);
        let value: Value = serde_json::from_str(&lines[0]).expect("json");
        assert_eq!(value["event"], "task.turn");
        assert_eq!(value["fields"], json!({ "agent": "a1", "turn": 2 }));
        assert!(!lines[0].contains("hello"));
    }

    #[test]
    fn files_older_than_fourteen_days_are_removed() {
        let home = tempdir().expect("home");
        record_at(home.path(), 86_400 * 10, "info", "old", json!({})).expect("old");
        record_at(home.path(), 86_400 * 30, "info", "new", json!({})).expect("new");
        let files: Vec<_> = log_files(&dir(home.path()).expect("dir")).expect("files");
        assert_eq!(files.len(), 1);
        assert!(files[0].1.ends_with("30.log"));
    }
}
