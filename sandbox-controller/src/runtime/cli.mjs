import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { JavaScriptRuntimeError, RUNTIME_CEILINGS, runJavaScript } from './index.mjs';

const INPUT_PATH = '/workspace/lumiere/input.json';
const OUTPUT_PATH = '/workspace/lumiere/output.json';
const TEMP_PATH = '/workspace/lumiere/output.json.tmp';

try {
  if (process.argv.length !== 2) throw new JavaScriptRuntimeError('invalid_input');
  const metadata = await stat(INPUT_PATH);
  if (!metadata.isFile() || metadata.size > RUNTIME_CEILINGS.maxInputBytes) {
    throw new JavaScriptRuntimeError('invalid_input');
  }
  const input = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
  const result = await runJavaScript(input);
  await writeFile(TEMP_PATH, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
  await rename(TEMP_PATH, OUTPUT_PATH);
} catch (error) {
  // Do not leak source, dataset values, paths, or exception text through logs.
  process.stderr.write(`${error instanceof JavaScriptRuntimeError ? error.code : 'worker_failed'}\n`);
  process.exitCode = 1;
}
