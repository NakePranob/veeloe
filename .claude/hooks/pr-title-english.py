#!/usr/bin/env python3
"""Refuse a `gh pr create`/`gh pr edit` whose --title is written in Thai.

AGENTS.md: the PR title is English, the description is Thai. The description
is the longer half and the part the team actually reads, so writing it pulls
the title into Thai with it.
A convention that only lives in a document is one an author can drift off
halfway through a session; this one is checked.
"""

import json
import re
import sys

THAI = re.compile(r"[฀-๿]")
# The quoted value after --title/-t. Not shlex.split: these commands carry a
# heredoc body for --body, which shlex cannot tokenize.
TITLE = re.compile(r"""(?:--title[= ]|(?<![-\w])-t )\s*(['"])(.*?)\1""", re.S)


def main() -> int:
    try:
        command = json.load(sys.stdin).get("tool_input", {}).get("command", "")
    except (json.JSONDecodeError, AttributeError):
        return 0  # Not something this hook can read. Not its business to fail.

    if not re.search(r"\bgh\s+pr\s+(create|edit)\b", command):
        return 0

    match = TITLE.search(command)
    if not match or not THAI.search(match.group(2)):
        return 0

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"PR title is Thai: {match.group(2)!r}\n"
                        "AGENTS.md: the title is English, in the shape of a commit "
                        "subject, with the tickets after it. The description stays "
                        "Thai. Reuse the branch's commit subject as the title — it "
                        "is already written to that rule."
                    ),
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
