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

/// Every crate name in `text` other than `own`: `veeloe_x` in Rust, where a
/// crate is always spelt with underscores, and `veeloe-x` too in a
/// `Cargo.toml` (`manifest`). A string like `"veeloe-hub-auth"` in code is a
/// label, not a crate.
fn other_crates(text: &str, own: &str, manifest: bool) -> Vec<String> {
    let own_snake = own.replace('-', "_");
    let mut found = Vec::new();
    for (at, _) in text.match_indices("veeloe") {
        let rest = &text[at..];
        if !(rest[6..].starts_with('_') || manifest && rest[6..].starts_with('-')) {
            continue;
        }
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if name.replace('-', "_") != own_snake {
            found.push(name);
        }
    }
    found
}

/// The modules a TypeScript file imports: `from "x"`, `import "x"`,
/// `import("x")` and `require("x")`.
fn ts_imports(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for marker in ["from ", "import ", "import(", "require("] {
        for (at, _) in text.match_indices(marker) {
            let rest = text[at + marker.len()..].trim_start();
            let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else {
                continue;
            };
            if let Some(end) = rest[1..].find(quote) {
                out.push(rest[1..1 + end].to_string());
            }
        }
    }
    out
}

/// `a/b/../c` as `a/c`; `None` when it climbs above where it started.
fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

/// The dependencies `package.json` declares.
fn declared(package: &Path) -> BTreeSet<String> {
    let value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(package).unwrap_or_default())
            .unwrap_or_default();
    ["dependencies", "devDependencies"]
        .iter()
        .filter_map(|key| value[key].as_object())
        .flat_map(|deps| deps.keys().cloned())
        .collect()
}

/// The package a bare specifier names: `zod`, or `@noble/hashes` for
/// `@noble/hashes/sha2.js`.
fn package_of(specifier: &str) -> String {
    let take = if specifier.starts_with('@') { 2 } else { 1 };
    specifier
        .split('/')
        .take(take)
        .collect::<Vec<_>>()
        .join("/")
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

        // plugin-api-leaf
        if krate == "plugin-api" {
            for name in other_crates(&text, "veeloe-plugin-api", file.ends_with("Cargo.toml")) {
                fail(
                    "plugin-api-leaf",
                    file,
                    format!("plugin-api names {name}; a plugin builds against plugin-api alone"),
                );
            }
        }

        // supervisor-layout and messages-independent
        if let ["crates", "runtime-supervisor", "src", rest @ ..] = parts.as_slice() {
            match rest {
                [_] | ["messages" | "cli", _] => {}
                _ => fail(
                    "supervisor-layout",
                    file,
                    "the supervisor's src/ holds flat files, messages/ and cli/ only".into(),
                ),
            }
            if let ["messages", name] = rest {
                if *name != "mod.rs" {
                    if text.contains("super::") {
                        fail(
                            "messages-independent",
                            file,
                            "a message module reaches super::; use crate::messages::shared or a service".into(),
                        );
                    }
                    for (at, _) in text.match_indices("crate::messages::") {
                        let after = &text[at + "crate::messages::".len()..];
                        let shared = after.strip_prefix("shared").is_some_and(|next| {
                            !next.starts_with(|c: char| c.is_alphanumeric() || c == '_')
                        });
                        if !shared {
                            fail(
                                "messages-independent",
                                file,
                                "a message module uses another message module".into(),
                            );
                        }
                    }
                }
            }
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

    // The protocol packages beside the Runtime (ADR 0071).
    let packages = root.join("..");
    for file in files(&packages.join("protocol")) {
        let parts: Vec<&str> = file.split('/').collect();
        let shown = format!("protocol/{file}");
        match parts.as_slice() {
            [_] | ["src" | "tests" | "schema" | "vectors", ..] => {}
            _ => fail(
                "known-places",
                &shown,
                "protocol keeps src/, tests/, schema/, vectors/ and its root files".into(),
            ),
        }
        if file.ends_with(".rs") || file == "Cargo.toml" {
            let text =
                std::fs::read_to_string(packages.join("protocol").join(&file)).unwrap_or_default();
            for name in other_crates(&text, "veeloe-protocol", file == "Cargo.toml") {
                fail(
                    "protocol-leaf",
                    &shown,
                    format!("protocol names {name}; it depends on no other veeloe crate"),
                );
            }
        }
    }
    let ts = packages.join("protocol-ts");
    let deps = declared(&ts.join("package.json"));
    for file in files(&ts) {
        let shown = format!("protocol-ts/{file}");
        let parts: Vec<&str> = file.split('/').collect();
        match parts.as_slice() {
            ["package.json"] | ["src", ..] => {}
            _ => fail(
                "known-places",
                &shown,
                "protocol-ts keeps src/ and package.json".into(),
            ),
        }
        if !(file.ends_with(".ts") || file.ends_with(".tsx")) {
            continue;
        }
        let text = std::fs::read_to_string(ts.join(&file)).unwrap_or_default();
        let dir = file.rsplit_once('/').map_or("", |(dir, _)| dir);
        for specifier in ts_imports(&text) {
            let ok = if specifier.starts_with('.') {
                normalize(&format!("{dir}/{specifier}"))
                    .is_some_and(|path| path.starts_with("src/"))
            } else {
                specifier.starts_with("bun:")
                    || specifier.starts_with("node:")
                    || deps.contains(&package_of(&specifier))
            };
            if !ok {
                fail(
                    "protocol-ts-self-contained",
                    &shown,
                    format!("imports {specifier}: only its own files, declared dependencies, bun: and node:"),
                );
            }
        }
    }

    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
}
