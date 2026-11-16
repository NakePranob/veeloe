//! The Runtime's structure rules (ADR 0070). Each failure prints the rule id
//! from `packages/.conventions/rules.json` and the file, so it leads
//! back to the decision. It reads files only: a probe that is not in any
//! module tree is still seen.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Built output and local state, never read.
const SKIP: [&str; 3] = ["target", ".git", "node_modules"];

fn workspace() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the workspace root")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if SKIP.iter().any(|skip| name == *skip) {
            continue;
        }
        if path.is_dir() {
            walk(&path, out);
        } else {
            out.push(path);
        }
    }
}

/// Every file, relative to `root`, slash-separated.
fn files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk(root, &mut out);
    let mut rel: Vec<String> = out
        .iter()
        .map(|path| {
            path.strip_prefix(root)
                .expect("under the root")
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    rel.sort();
    rel
}

/// The top-level folders of the template crate: what a crate may have.
fn template_folders(root: &Path) -> BTreeSet<String> {
    let rules: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("../.conventions/rules.json")).expect("rules.json"),
    )
    .expect("rules.json is JSON");
    let mut allowed = BTreeSet::new();
    for template in rules["templates"].as_array().into_iter().flatten() {
        // Template paths are relative to packages/, where the rules sit.
        let dir = root
            .join("..")
            .join(template["dir"].as_str().expect("a template dir"));
        for entry in std::fs::read_dir(&dir)
            .expect("the template folder")
            .flatten()
        {
            if entry.path().is_dir() {
                allowed.insert(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    allowed
}

/// Whether every mention of the worker crate is `veeloe_runtime_worker::entry`
/// and nothing else: no list, no rename, no other module.
fn only_entry(text: &str) -> bool {
    const NAME: &str = "veeloe_runtime_worker";
    text.match_indices(NAME).all(|(at, _)| {
        let rest = &text[at + NAME.len()..];
        match rest.strip_prefix("::entry") {
            Some(after) => !after.starts_with(|c: char| c.is_alphanumeric() || c == '_'),
            None => false,
        }
    })
}

#[test]
fn the_runtime_keeps_its_structure() {
    let root = workspace();
    let all = files(&root);
    let allowed = template_folders(&root);
    let mut failures = Vec::new();
    let mut fail =
        |rule: &str, file: &str, detail: String| failures.push(format!("{rule}: {file}: {detail}"));

    for file in &all {
        let parts: Vec<&str> = file.split('/').collect();

        // known-places and unit-shape
        match parts.as_slice() {
            [_] => {}
            ["crates", _crate, "Cargo.toml"] => {}
            ["crates", _crate, folder, _, ..] if allowed.contains(*folder) => {}
            ["crates", _crate, folder, _, ..] => fail(
                "unit-shape",
                file,
                format!(
                    "{folder}/ is not a folder the crate template has ({})",
                    allowed.iter().cloned().collect::<Vec<_>>().join(", ")
                ),
            ),
            _ => fail(
                "known-places",
                file,
                "not in a crate's src/ or tests/, a crate's Cargo.toml or the workspace root"
                    .into(),
            ),
        }

        // This file names the crates it checks for.
        let this = file.as_str() == "crates/runtime-core/tests/structure.rs";
        if this
            || !(file.ends_with(".rs") || file.ends_with("Cargo.toml"))
            || parts.first() != Some(&"crates")
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(root.join(file)) else {
            continue;
        };
        let krate = parts.get(1).copied().unwrap_or_default();

        // worker-never-supervisor
        if (krate == "runtime-worker" || krate == "runtime-core")
            && (text.contains("veeloe_runtime_supervisor")
                || text.contains("veeloe-runtime-supervisor"))
        {
            fail(
                "worker-never-supervisor",
                file,
                format!("{krate} names the supervisor crate; it talks to the supervisor over ipc"),
            );
        }
        if krate == "runtime-core"
            && (text.contains("veeloe_runtime_worker") || text.contains("veeloe-runtime-worker"))
        {
            fail(
                "worker-never-supervisor",
                file,
                "runtime-core names the worker crate".into(),
            );
        }

        // supervisor-uses-worker-entry-only
        if krate == "runtime-supervisor" && file.ends_with(".rs") && !only_entry(&text) {
            fail(
                "supervisor-uses-worker-entry-only",
                file,
                "uses veeloe_runtime_worker other than through ::entry".into(),
            );
        }
    }

    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
}
