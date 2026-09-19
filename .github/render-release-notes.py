"""Renders release notes from the merged pull request that shipped this version.

Usage: VERSION=1.2.0 PR_NUMBER=7 python3 render-release-notes.py <pr-body-file> <template-file>

The PR's "Description" section becomes the release's "What's new", and its "Upgrade notes"
section carries over as-is, so release notes are written once, in the pull request.
"""

import os
import re
import sys

# Headings accepted for each slot. The first that matches wins, so pull requests written
# before the template existed still render.
SECTIONS = {
    "description": ("description", "summary", "what's new"),
    "upgrade": ("upgrade notes", "upgrading"),
}


def section(body, names):
    for name in names:
        match = re.search(
            rf"^#{{1,3}}\s*{re.escape(name)}\s*$\n(.*?)(?=^#{{1,3}}\s|\Z)",
            body,
            re.MULTILINE | re.DOTALL | re.IGNORECASE,
        )
        if match:
            # Drop the template's HTML comment prompts, which are invisible in a PR but not here.
            text = re.sub(r"<!--.*?-->", "", match.group(1), flags=re.DOTALL).strip()
            if text:
                return text
    return ""


if sys.argv[1] == "--self-check":
    filled = "## Description\n<!-- prompt -->\nA real description.\n\n## Upgrade notes\nRe-register commands.\n\n## Testing\nnot in the release\n"
    assert section(filled, SECTIONS["description"]) == "A real description.", section(filled, SECTIONS["description"])
    assert section(filled, SECTIONS["upgrade"]) == "Re-register commands."
    # A section left as nothing but the template's comment counts as empty, not as notes.
    assert section("## Description\n<!-- prompt only -->\n", SECTIONS["description"]) == ""
    assert section("## Summary\nOld style.\n", SECTIONS["description"]) == "Old style."
    assert section("", SECTIONS["description"]) == ""
    print("self-check ok")
    sys.exit()

body = open(sys.argv[1]).read() if os.path.getsize(sys.argv[1]) else ""
template = open(sys.argv[2]).read()
pr = os.environ.get("PR_NUMBER", "")

values = {
    "description": section(body, SECTIONS["description"]) or "See the pull request for details.",
    "upgrade": section(body, SECTIONS["upgrade"]) or "Nothing to do beyond the usual update below.",
    "version": os.environ["VERSION"],
    "pr": f"\nShipped in #{pr}." if pr else "",
}

notes = template
for key, value in values.items():
    notes = notes.replace("{{" + key + "}}", value)
print(notes.strip())
