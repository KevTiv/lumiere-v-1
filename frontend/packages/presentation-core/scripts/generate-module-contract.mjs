// Generate presentation wire contracts from crates/presentation-core Rust models
// into contracts staging. The released copies live in @lumiere/contracts; this
// repository no longer checks generated schemas or types in.
//
//   node generate-module-contract.mjs --out-staging <dir> [--schemas-only]
//
// Schemas go to <dir>/manifests/presentation (checked by contracts drift, which
// needs only cargo). Without --schemas-only, TypeScript types and schema copies
// also go to <dir>/ts/presentation for the contracts package.
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../../../', import.meta.url);
const argv = process.argv.slice(2);
const schemasOnly = argv.includes('--schemas-only');
const stagingIndex = argv.indexOf('--out-staging');
const staging = stagingIndex === -1 ? null : argv[stagingIndex + 1];
if (!staging || staging.startsWith('--')) {
  throw new Error('--out-staging <dir> is required');
}
const unknown = argv.filter((arg, index) => !['--schemas-only', '--out-staging'].includes(arg) && index !== stagingIndex + 1);
if (unknown.length > 0) {
  throw new Error(`unsupported arguments: ${unknown.join(' ')}`);
}

// Types need json-schema-to-typescript (a frontend dev dependency). The
// schemas-only mode must run with just cargo, e.g. in contracts drift CI.
const compile = schemasOnly ? null : (await import('json-schema-to-typescript')).compile;
const stagingRoot = pathToFileURL(`${resolve(process.cwd(), staging)}/`);

for (const [name, title, args] of [
  ['module-draft', 'ModuleDraft', []],
  ['preview-contract', 'PreviewContract', ['preview']],
  ['saved-draft-contract', 'SavedDraftContract', ['saved']],
]) {
  const schemaText = execFileSync('cargo', ['run', '--locked', '--quiet', '-p', 'lumiere-presentation-core', '--bin', 'presentation-schema', '--', ...args], {
    cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  const schema = JSON.parse(schemaText);
  const normalizedSchema = `${JSON.stringify(schema, null, 2)}\n`;
  const outputs = [[new URL(`manifests/presentation/${name}.schema.json`, stagingRoot), normalizedSchema]];
  if (compile) {
    const types = await compile(schema, title, {
      bannerComment: '/* Generated from lumiere-presentation-core Rust models. Run pnpm generate:contract. Do not edit. */',
      style: { singleQuote: true, semi: true, tabWidth: 2 },
    });
    outputs.push(
      [new URL(`ts/presentation/${name}.schema.json`, stagingRoot), normalizedSchema],
      [new URL(`ts/presentation/${name}.ts`, stagingRoot), types],
    );
  }
  for (const [url, content] of outputs) {
    await mkdir(new URL('.', url), { recursive: true });
    await writeFile(url, content);
  }
}
