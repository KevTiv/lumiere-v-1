#!/usr/bin/env python3
"""Generate and verify the ERP skill inventory and compile-time prompt dependencies.

No network, tenant writes, certification or activation. Rust tests compare this
inventory with the real parser and reviewed manifests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
COMPILER = 'erp-prompt-v2'
MAX_BYTES = 65_536
FINANCE = ROOT / 'crates/finance-review-core/src/lib.rs'
CONTRACTS = {
    'finance_report_review': (FINANCE, 'ReportInput'),
    'bank_reconciliation_review': (FINANCE, 'BankInput'),
    'period_close_review': (FINANCE, 'CloseInput'),
    'expense_evidence_review': (FINANCE, 'ExpenseInput'),
    'finance_variance_review': (FINANCE, 'VarianceInput'),
    'daily_briefing': (ROOT / 'ai-gateway/src/harness/daily_briefing.rs', 'DailyBriefingInput'),
    'insights_scan': (ROOT / 'ai-gateway/src/harness/insights_scan.rs', 'InsightsScanInput'),
    'import_mapping': (ROOT / 'ai-gateway/src/harness/import_mapping.rs', 'ImportMappingInput'),
    'rag_generation': (ROOT / 'ai-gateway/src/routes/rag.rs', 'RagRequest'),
    'form_suggestion': (ROOT / 'ai-gateway/src/routes/forms.rs', 'FormSuggestRequest'),
    'action_draft_generation': (ROOT / 'ai-gateway/src/routes/actions.rs', 'ActionDraftRequest'),
}
DETERMINISTIC = {'daily_briefing', 'insights_scan', 'import_mapping'}
INTERNAL = {'rag_generation', 'form_suggestion', 'action_draft_generation'}


def sha(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def read_skill(path):
    raw = path.read_text()
    if len(raw.encode()) > MAX_BYTES:
        raise ValueError(f'oversized skill: {path}')
    front, body = raw.split('---', 2)[1:]
    fields, key = {}, None
    for line in front.splitlines():
        if not line.strip():
            continue
        if line.startswith('  - '):
            fields[key].append(line[4:].strip())
        elif line.startswith('  '):
            if not isinstance(fields[key], str):
                raise ValueError('unexpected metadata continuation')
            fields[key] += '\n' + line[2:]
        else:
            key, value = line.split(':', 1)
            if key in fields:
                raise ValueError(f'duplicate metadata: {key}')
            fields[key] = [] if not value.strip() or value.strip() == '[]' else value.strip().strip('"')
    if fields['skill_key'] != path.parent.name:
        raise ValueError('skill key differs from directory')
    return fields, body.strip()


def compile_prompt(path):
    fields, text = read_skill(path)
    dependencies = [{'path': 'SKILL.md', 'sha256': sha(path.read_bytes())}]
    blocks, seen = [], set()
    for relative in fields.get('references', []):
        if relative in seen or any(part in ('..', '.') for part in relative.split('/')) or Path(relative).is_absolute():
            raise ValueError(f'invalid reference: {relative}')
        seen.add(relative)
        asset = (path.parent / relative).resolve(strict=True)
        if not asset.is_relative_to(path.parent.resolve()) or not asset.is_file():
            raise ValueError(f'reference escapes package: {relative}')
        data = asset.read_bytes()
        if len(data) > MAX_BYTES:
            raise ValueError(f'oversized reference: {relative}')
        dependencies.append({'path': relative, 'sha256': sha(data)})
        blocks.append(f'### Reference: {relative}\n\n{data.decode().strip()}')
    if blocks:
        text += '\n\n## Reference context\n\n' + '\n\n'.join(blocks)
    if len(text.encode()) > MAX_BYTES:
        raise ValueError('compiled prompt exceeds byte bound')
    digest = hashlib.sha256(COMPILER.encode())
    for dependency in dependencies:
        encoded = dependency['path'].encode()
        digest.update(len(encoded).to_bytes(8, 'big'))
        digest.update(encoded)
        digest.update(dependency['sha256'].encode())
    digest.update(text.encode())
    return {'text': text, 'compiler': COMPILER, 'source_hash': 'sha256:' + digest.hexdigest(), 'dependencies': dependencies}


def contract_fields(source, symbol):
    text = source.read_text()
    body = re.search(r'pub struct ' + symbol + r'\s*\{(.*?)\n\}', text, re.S)
    if not body:
        raise ValueError(f'missing contract {symbol}')
    # Rust remains authoritative. These are field/type docs, not a second validator.
    camel = 'rename_all = "camelCase"' in text[max(0, body.start()-180):body.start()]
    result = []
    for attributes, name, kind in re.findall(r'((?:\s*#\[[^\n]*\]\s*)*)pub (\w+): ([^\n]+),', body[1]):
        wire = re.sub(r'_([a-z])', lambda m: m[1].upper(), name) if camel else name
        result.append({'name': wire, 'rustType': kind, 'required': not kind.startswith('Option<') and 'default' not in attributes})
    return result


def generate():
    routes = dict(re.findall(r'\(\s*"([a-z_]+)",\s*"([^"]+)"\s*,?\s*\)', (ROOT/'ai-gateway/src/harness/legacy_fence.rs').read_text()))
    skills, assets = [], set()
    for path in sorted((ROOT/'erp-skills').glob('*/SKILL.md')):
        fields, _ = read_skill(path)
        key = fields['skill_key']
        compiled = compile_prompt(path)
        source, symbol = CONTRACTS.get(key, (ROOT/'ai-gateway/src/harness/governed_llm_skills.rs', 'GovernedLlmSkillInput'))
        for dep in compiled['dependencies']:
            assets.add((path.parent / dep['path']).relative_to(ROOT).as_posix())
        skills.append({
            'key': key, 'name': fields['name'], 'description': fields['description'],
            'mode': 'deterministic' if key in DETERMINISTIC else 'internal_generation' if key in INTERNAL else 'governed_llm',
            'executionRoute': routes[key], 'inputContract': {'source': source.relative_to(ROOT).as_posix(), 'symbol': symbol, 'fields': contract_fields(source, symbol)},
            'inputLevel': 'workflow_inputs' if source == FINANCE or key in DETERMINISTIC else 'gateway_envelope',
            'requiredTools': fields.get('required_tools', []), 'optionalTools': fields.get('optional_tools', []),
            'allowedActionDrafts': fields.get('allowed_action_drafts', []),
            'requiresCurrentAdmission': True, 'liveQualification': 'pending',
            'prompt': {k: v for k, v in compiled.items() if k != 'text'},
            'promptBytes': len(compiled['text'].encode()),
        })
    catalog = {'schemaVersion': 1, 'compiler': COMPILER, 'notice': 'Implementation inventory only. Routes do not establish tenant activation, certification, source availability or model quality.', 'skills': skills}
    readme = '''# ERP skill catalog

Generated by `python3 scripts/erp_skill_catalog.py --write` from bundled metadata,
Rust input contracts and registered routes. Run with `--check` in CI. Rust remains
the authority for validation, policy, tools and execution. The catalog describes
implementation; it never activates a skill or certifies a model or tenant.

| Task | Execution | Gateway route | Input contract |
| --- | --- | --- | --- |
'''
    for skill in skills:
        contract = skill['inputContract']
        readme += f"| [{skill['name']}]({skill['key']}/SKILL.md) | {skill['mode']} | `{skill['executionRoute']}` | [`{contract['symbol']}`](../{contract['source']}) |\n"
    readme += '''
## Operation and authoring

Business users choose a task and supply its required inputs. Company, actor,
release, policy and spend admission remain owned by the existing gateway.
Internal generation routes have transport fields that are not model authority.
The generated [catalog.json](catalog.json) records exact source field types and
whether they belong to workflow inputs or the gateway envelope.

Keep each procedure concise: purpose/routing, exact inputs, ordered steps,
evidence, output, recovery and completion/handoff. The parser supports scalar
metadata, dash lists and literal blocks; it is an internal format, not general
YAML. Preserve underscore release identities. Every declared reference is
required, bounded and package-local. References are eagerly included in declared
order; selective loading remains an evaluation-driven follow-up.

Prompt synchronization records compiler version, dependency hashes and the
composed source hash. Required prompt files are compile-time certification inputs.
Changing a prompt, reference or compiler invalidates the affected bundle; prepare
new proposed manifests and follow independent certification/promotion. Existing
certificates are never inherited by a changed bundle.

See [the implementation plan](../docs/plans/erp-skills-professional-usability.md)
and [evaluation instructions](evals/README.md). Evaluation examples and expected
outcomes never enter production context. Cost figures and model quality require
actual provider evidence; local replay only establishes its stated assertions.
'''
    cert = ROOT/'ai-gateway/src/harness/certification.rs'
    text = cert.read_text()
    begin, end = '        // BEGIN GENERATED ERP PROMPT INPUTS', '        // END GENERATED ERP PROMPT INPUTS'
    def include_line(asset):
        line = f'        include_bytes!("../../../{asset}"),'
        if len(line) > 100:
            return f'        include_bytes!(\n            "../../../{asset}"\n        ),\n'
        return line + '\n'
    block = begin+'\n'+''.join(include_line(asset) for asset in sorted(assets))+end
    if begin in text:
        text = text[:text.index(begin)] + block + text[text.index(end)+len(end):]
    else:
        old = '        include_bytes!("../../../erp-skills/report_analysis/SKILL.md"),'
        text = text.replace(old, block)
    return {ROOT/'erp-skills/catalog.json': json.dumps(catalog, indent=2)+'\n', ROOT/'erp-skills/README.md':readme, cert:text}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.write == args.check:
        parser.error('choose --write or --check')
    for path, text in generate().items():
        if args.write:
            path.write_text(text)
        elif not path.is_file() or path.read_text() != text:
            raise SystemExit(f'stale generated skill inventory: {path.relative_to(ROOT)}')
    print('ERP skill inventory and prompt dependency binding verified.')


if __name__ == '__main__':
    main()
