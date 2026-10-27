#!/usr/bin/env python3
"""Prepare source-bound finance manifests locally; never register or promote."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "ai-gateway/src/harness"


def report_hash():
    source = (HARNESS / "certification.rs").read_text()
    function = source.split("pub fn report_analysis_certification_bundle_hash()", 1)[1].split("fn compiled_bundle_hash", 1)[0]
    result = hashlib.sha256(b"lumiere.ai.certification.compiled_bundle.v1")
    for relative in re.findall(r'include_bytes!\("([^"]+)"\)', function):
        data = (HARNESS / relative).read_bytes()
        result.update(len(data).to_bytes(8, "big"))
        result.update(data)
    return "sha256:" + result.hexdigest()


def manifests():
    source = (HARNESS / "finance_skills.rs").read_text()
    common = re.search(r"for part in \[(.*?)\]\s*\{", source, re.S).group(1)
    paths = re.findall(r'include_bytes!\("([^"]+)"\)', common)
    specs = (ROOT / "crates/finance-review-core/src/lib.rs").read_text().split("pub const SKILLS:", 1)[1].split("pub fn skill", 1)[0]
    entries = re.findall(r'Skill\s*\{\s*key:\s*"([^"]+)",\s*resource:\s*"([^"]+)",\s*output:\s*"([^"]+)"', specs, re.S)
    assert len(entries) == 5, "expected all five compiled finance skills"
    for key, resource, output in entries:
        digest = hashlib.sha256(b"lumiere.finance.skill.compiled.v1\0")
        digest.update(key.encode())
        digest.update(report_hash().encode())
        for relative in paths:
            data = (HARNESS / relative).read_bytes()
            digest.update(len(data).to_bytes(8, "big"))
            digest.update(data)
        digest.update((ROOT / "erp-skills" / key / "SKILL.md").read_bytes())
        yield key, {"schema_version": 1, "skill_key": key, "version": "1.0.0", "risk": "green", "limits": {"max_steps": 5, "max_tool_calls": 1}, "permissions": [], "resources": [resource], "output_types": [output], "source_hash": "sha256:" + digest.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write proposed manifests in this checkout")
    parser.add_argument("--check", action="store_true", help="verify manifests match current source")
    args = parser.parse_args()
    for key, manifest in manifests():
        path = ROOT / "infra/skill-releases/finance" / f"{key}.proposed.json"
        if args.check:
            assert json.loads(path.read_text()) == manifest, f"stale finance manifest: {key}"
        elif args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(manifest, indent=2) + "\n")
        else:
            print(json.dumps(manifest))


if __name__ == "__main__":
    main()
