import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../../../', import.meta.url);
const packageRoot = new URL('../', import.meta.url);
const argv = process.argv.slice(2);
const check = argv.includes('--check');
const schemaOnlyInput = argv.includes('--from-schema');
const schemasOnly = argv.includes('--schemas-only');
const stagingIndex = argv.indexOf('--out-staging');
const staging = stagingIndex === -1 ? null : argv[stagingIndex + 1];
if (stagingIndex !== -1 && (!staging || staging.startsWith('--'))) {
  throw new Error('--out-staging requires a directory');
}
if (staging && (check || schemaOnlyInput)) {
  throw new Error('--out-staging always generates from Rust and cannot be combined with --check or --from-schema');
}
if (schemasOnly && !staging) {
  throw new Error('--schemas-only is only supported with --out-staging');
}

// Types need json-schema-to-typescript (a frontend dev dependency). The
// schemas-only staging mode must run with just cargo, e.g. in contracts drift CI.
const compile = schemasOnly ? null : (await import('json-schema-to-typescript')).compile;
const stagingRoot = staging ? pathToFileURL(`${resolve(process.cwd(), staging)}/`) : null;

for (const [name, title, args] of [['module-draft', 'ModuleDraft', []], ['preview-contract', 'PreviewContract', ['preview']]]) {
  const schemaPath = new URL(`schema/${name}.schema.json`, packageRoot);
  const schemaText = schemaOnlyInput
    ? await readFile(schemaPath, 'utf8')
    : execFileSync('cargo', ['run', '--locked', '--quiet', '-p', 'lumiere-presentation-core', '--bin', 'presentation-schema', '--', ...args], {
        cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      });
  const schema = JSON.parse(schemaText);
  const normalizedSchema = `${JSON.stringify(schema, null, 2)}\n`;
  const types = compile
    ? await compile(schema, title, {
        bannerComment: '/* Generated from lumiere-presentation-core Rust models. Run pnpm generate:contract. Do not edit. */',
        style: { singleQuote: true, semi: true, tabWidth: 2 },
      })
    : null;
  const outputs = stagingRoot
    ? [
        [new URL(`manifests/presentation/${name}.schema.json`, stagingRoot), normalizedSchema],
        ...(types === null
          ? []
          : [
              [new URL(`ts/presentation/${name}.schema.json`, stagingRoot), normalizedSchema],
              [new URL(`ts/presentation/${name}.ts`, stagingRoot), types],
            ]),
      ]
    : [
        [schemaPath, normalizedSchema],
        [new URL(`src/generated/${name}.ts`, packageRoot), types],
      ];
  for (const [url, content] of outputs) {
    if (check) {
      const existing = await readFile(url, 'utf8');
      if (existing !== content) throw new Error(`Generated contract drift: ${fileURLToPath(url)}`);
    } else {
      await mkdir(new URL('.', url), { recursive: true });
      await writeFile(url, content);
    }
  }
}
