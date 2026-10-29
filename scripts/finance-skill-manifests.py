#!/usr/bin/env python3
"""Prepare report/finance manifests and the development seed; never register or promote."""
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
    for relative in re.findall(r'include_bytes!\(\s*"([^"]+)"\s*\)', function):
        data = (HARNESS / relative).read_bytes()
        result.update(len(data).to_bytes(8, "big"))
        result.update(data)
    return "sha256:" + result.hexdigest()


def manifests():
    source = (HARNESS / "finance_skills.rs").read_text()
    common = re.search(r"for part in \[(.*?)\]\s*\{", source, re.S).group(1)
    paths = re.findall(r'include_bytes!\(\s*"([^"]+)"\s*\)', common)
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
        yield key, {"schema_version": 1, "skill_key": key, "version": re.search(r'pub const VERSION: &str = "([^"]+)"', (ROOT / "crates/finance-review-core/src/lib.rs").read_text()).group(1), "risk": "green", "limits": {"max_steps": 5, "max_tool_calls": 1}, "permissions": [], "resources": [resource], "output_types": [output], "source_hash": "sha256:" + digest.hexdigest()}


def prepare_report(check):
    """Keep the proposed report and development-only seed on the exact binding."""
    source = (HARNESS / "certification.rs").read_text()
    version = re.search(r'REPORT_ANALYSIS_CERTIFICATION_VERSION: &str = "([^"]+)"', source).group(1)
    bundle = report_hash()
    path = ROOT / "infra/railway/pilots/report-analysis-certification-manifest.proposed.json"
    original = json.loads(path.read_text())
    proposed = {**original, "version": version, "source_hash": bundle}
    seed_path = ROOT / "spacetimedb/src/seed.rs"
    seed = seed_path.read_text()
    updated, hashes = re.subn(
        r'(let source_hash = if skill_key == "report_analysis" \{\n\s*)"sha256:[a-f0-9]+"',
        lambda match: match[1] + '"' + bundle + '"', seed,
    )
    updated, versions = re.subn(
        r'(let version = if skill_key == "report_analysis" \{\n\s*)"[^"]+"',
        lambda match: match[1] + '"' + version + '"', updated,
    )
    assert hashes == versions == 1, "development report seed binding not found"
    if check:
        assert original == proposed, "stale proposed report manifest"
        assert seed == updated, "stale development report seed"
    else:
        path.write_text(json.dumps(proposed, separators=(",", ":"), sort_keys=True) + "\n")
        seed_path.write_text(updated)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write proposed manifests in this checkout")
    parser.add_argument("--check", action="store_true", help="verify manifests match current source")
    args = parser.parse_args()
    if args.write and args.check:
        parser.error("choose --write or --check")
    if args.write or args.check:
        prepare_report(args.check)
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
