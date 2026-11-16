#!/usr/bin/env python3
"""Prove a project's checks bite. Knows no language and no tool.

Reads .conventions/rules.json:

  {"version": 1,
   "check": ["make", "check"],            # the project's own check command
   "rules": [
     {"id": "no-cross-module-import",
      "statement": "...",
      "enforcer": {"tool": "...", "version": "...", "docs": "...", "at": "..."},
      "violation": [{"path": "services/a/x.go", "content": "..."}],   # each must fail
      "legal":     [{"path": "services/a/y.go", "content": "..."}]},  # each must pass
     {"id": "...", "notApplicable": "why, and the ADR that says so"},
     {"id": "...", "deferred": "decided to wait; revisit when X, ADR-0005"},
     {"id": "...", "proseOnly": "decided, no check can see it, ADR-0003"},
     {"id": "...", "open": "undecided: QUESTIONS.md Q3"}],
   "templates": [{"name": "module", "dir": ".conventions/templates/module",
                  "sample": "internal/module"}]}   # copied there in scratch when no real unit exists

For each rule, in a scratch copy of the project: the clean tree passes; each
violation file, written alone, makes the check exit non-zero with output
naming the rule id and the file; each legal file, written alone, passes.
A rule with no violation, no notApplicable/deferred/proseOnly reason and no open
question fails; open, deferred and proseOnly rules are listed as such, never
as caught. A rule with its own "check" must name the file that "runs" it on
real input (a hook, a CI step); a "proposed" rule is marked unconfirmed. Results go to
.conventions/coverage.json (--rule updates only that rule); --verify fails if a fresh run differs from it.

  prove.py [--root DIR] [--rule ID] [--verify]
"""
import argparse, json, os, shutil, subprocess, sys, tempfile

HEAVY = {"node_modules", "vendor", ".venv", "venv", "target", "build", ".gradle", ".next", "Pods"}


def scratch(root):
    dst = tempfile.mkdtemp(prefix="prove-")
    tmp = os.path.realpath(os.path.dirname(dst))  # a TMPDIR inside the project is never copied into itself

    def skip(d, names):
        return [n for n in names if n in HEAVY or os.path.realpath(os.path.join(d, n)) == tmp]

    for name in os.listdir(root):
        src, out = os.path.join(root, name), os.path.join(dst, name)
        if name == ".git" or os.path.realpath(src) == tmp:
            continue
        if name in HEAVY:  # ponytail: shared, not copied; probes never write there
            os.symlink(src, out)
        elif os.path.isdir(src):  # nested node_modules etc. are linked too, not copied
            shutil.copytree(src, out, symlinks=True, ignore=skip)
            for d, dirs, _ in os.walk(src):
                for n in [n for n in dirs if n in HEAVY]:
                    os.symlink(os.path.join(d, n), os.path.join(out, os.path.relpath(d, src), n))
                dirs[:] = [n for n in dirs if n not in HEAVY]
        else:
            shutil.copy2(src, out)
    return dst


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=isinstance(cmd, str))
    return r.returncode, r.stdout + r.stderr


def case_clash(base, rel):
    """On a case-insensitive disk (macOS default), Dto/ lands inside dto/: name it instead of a false result."""
    d = base
    for part in rel.split("/"):
        names = os.listdir(d) if os.path.isdir(d) else []
        clash = [n for n in names if n.lower() == part.lower() and n != part]
        if clash and os.path.exists(os.path.join(d, part)):  # only a disk that ignores case finds the other name
            return f"{rel}: '{part}' and existing '{clash[0]}' differ only by case; this disk ignores case, run on a case-sensitive one (Linux CI)"
        d = os.path.join(d, part)
    return None


def with_file(base, probe, cmd):
    clash = case_clash(base, probe["path"])
    if clash:
        return 0, "CASE: " + clash
    path = os.path.join(base, probe["path"])
    existed = os.path.exists(path)
    old = open(path, "rb").read() if existed else None
    made, d = [], os.path.dirname(path)
    while not os.path.exists(d):
        made.append(d); d = os.path.dirname(d)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(probe["content"])
    try:
        return run(cmd, base)
    finally:
        if existed:
            open(path, "wb").write(old)
        else:
            os.remove(path)
            for d in made:  # deepest first; an empty folder left behind trips later probes
                os.rmdir(d)


def names(rid, path, new):
    """The failure names both the rule and the file, on lines a passing run does not print."""
    return rid in new and os.path.basename(path) in new


def prove(root, only=None):
    path = os.path.join(root, ".conventions/rules.json")
    if not os.path.exists(path):
        sys.exit(f"no {path}: run the conventions skill first")
    rules = json.load(open(path))
    cmd = rules.get("check")
    if not cmd:
        sys.exit("rules.json has no \"check\" command")
    base = scratch(root)
    for t in rules.get("templates", []):
        samples = t.get("sample") or []
        for sp in [samples] if isinstance(samples, (str, dict)) else samples:  # two samples let a probe cross units
            src = os.path.join(base, t["dir"], sp.get("from", "")) if isinstance(sp, dict) else os.path.join(base, t["dir"])
            dst = os.path.join(base, sp["to"] if isinstance(sp, dict) else sp)
            if not os.path.exists(dst):  # no real unit yet: legal probes land in a copy of the template, in scratch only
                shutil.copytree(src, dst)
    try:
        code, out = run(cmd, base)
        result = {"clean": "pass" if code == 0 else "FAIL", "rules": {}}
        clean_out = {json.dumps(cmd): set(out.splitlines())}  # what a passing run prints; a test reporter may echo rule ids there
        if code:
            print(out[-3000:])
            return result
        for r in rules.get("rules", []):
            rid = r["id"]
            if only and rid != only:
                continue
            print(f"proving {rid} ...", file=sys.stderr, flush=True)
            if r.get("notApplicable"):
                result["rules"][rid] = "not applicable: " + r["notApplicable"]
                continue
            if r.get("deferred"):
                result["rules"][rid] = "deferred: " + r["deferred"]  # decided to wait; names when to revisit
                continue
            if r.get("proseOnly"):
                result["rules"][rid] = "prose only: " + r["proseOnly"]  # decided, no check can enforce it; listed, never "caught"
                continue
            if r.get("open") and not r.get("violation"):
                result["rules"][rid] = "open: " + r["open"]  # undecided, not enforced: listed, never passed off as done
                continue
            if not r.get("violation"):
                result["rules"][rid] = "FAIL: no violation example and no notApplicable, deferred, proseOnly or open reason"
                continue
            if not r.get("legal"):
                result["rules"][rid] = "FAIL: no legal example: without one, a check that crashes on every input looks caught"
                continue
            runs = r.get("runs")
            if r.get("check") and not (runs and os.path.exists(os.path.join(base, runs))):
                result["rules"][rid] = "FAIL: has its own check, but no \"runs\" file in the tree (hook or CI step) runs it on real input"
                continue
            rcmd = r.get("check", cmd)  # a rule with its own command, e.g. a commit-msg linter run on a probe message
            key = json.dumps(rcmd)
            if key not in clean_out:
                clean_out[key] = set(run(rcmd, base)[1].splitlines())
            fails = []
            for p in r["violation"]:
                code, out = with_file(base, p, rcmd)
                if out.startswith("CASE: "):
                    fails.append(out[6:])
                elif code == 0:
                    fails.append(f"{p['path']} passed the check")
                elif not names(rid, p["path"], "\n".join(l for l in out.splitlines() if l not in clean_out[key])):
                    fails.append(f"{p['path']} failed, but the output does not name both '{rid}' and the file")
            for p in r.get("legal", []):
                code, out = with_file(base, p, rcmd)
                if out.startswith("CASE: "):
                    fails.append(out[6:])
                elif code:
                    fails.append(f"legal {p['path']} was refused: {out.strip()[-300:]}")
            result["rules"][rid] = "FAIL: " + "; ".join(fails) if fails else "caught"
        for r in rules.get("rules", []):  # unconfirmed decisions say so, whatever their status
            v = result["rules"].get(r["id"])
            if r.get("proposed") and v and not v.startswith("FAIL"):
                result["rules"][r["id"]] = v + " (proposed, owner has not confirmed: " + r["proposed"] + ")"
        return result
    finally:
        shutil.rmtree(base, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--rule")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    res = prove(root, a.rule)
    for rid, v in res["rules"].items():
        print(f"{rid}: {v}")
    print(f"clean tree: {res['clean']}")
    bad = res["clean"] != "pass" or any(v.startswith("FAIL") for v in res["rules"].values())
    manifest = os.path.join(root, ".conventions/coverage.json")
    if a.verify:
        old = json.load(open(manifest)) if os.path.exists(manifest) else None
        if old and a.rule:  # one rule: compare its line only
            old = {"clean": old.get("clean"), "rules": {k: v for k, v in old["rules"].items() if k == a.rule}}
        if old != res:
            print("coverage.json differs from this run: a rule was added, dropped or stopped being caught")
            bad = True
    else:
        if a.rule and os.path.exists(manifest):  # one rule: update its line, keep the rest
            old = json.load(open(manifest))
            old["rules"].update(res["rules"]); old["clean"] = res["clean"]; res = old
        json.dump(res, open(manifest, "w"), indent=2, sort_keys=True)
        open(manifest, "a").write("\n")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
