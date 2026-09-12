import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = new URL('../../../../', import.meta.url);
const packageRoot = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const schemaOnlyInput = process.argv.includes('--from-schema');
for (const [name, title, args] of [['module-draft', 'ModuleDraft', []], ['preview-contract', 'PreviewContract', ['preview']], ['saved-draft-contract', 'SavedDraftContract', ['saved']]]) {
  const schemaPath = new URL(`schema/${name}.schema.json`, packageRoot);
  const schemaText = schemaOnlyInput
    ? await readFile(schemaPath, 'utf8')
    : execFileSync('cargo', ['run', '--locked', '--quiet', '-p', 'lumiere-presentation-core', '--bin', 'presentation-schema', '--', ...args], {
        cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      });
  const schema = JSON.parse(schemaText);
  const normalizedSchema = `${JSON.stringify(schema, null, 2)}\n`;
  const types = await compile(schema, title, {
    bannerComment: '/* Generated from lumiere-presentation-core Rust models. Run pnpm generate:contract. Do not edit. */',
    style: { singleQuote: true, semi: true, tabWidth: 2 },
  });
  for (const [url, content] of [
    [schemaPath, normalizedSchema],
    [new URL(`src/generated/${name}.ts`, packageRoot), types],
  ]) {
    if (check) {
      const existing = await readFile(url, 'utf8');
      if (existing !== content) throw new Error(`Generated contract drift: ${fileURLToPath(url)}`);
    } else {
      await mkdir(new URL('.', url), { recursive: true });
      await writeFile(url, content);
    }
  }
}
