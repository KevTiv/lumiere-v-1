import { readFile } from 'node:fs/promises';
import { createRuntimeProfile } from './profile.mjs';

/** Bundle repository-owned runtime bytes; request/model paths are never inputs. */
export async function loadRuntimeProfile(options) {
  const files = {
    'package.json': new URL('../runtime/package.json', import.meta.url),
    'package-lock.json': new URL('../runtime/package-lock.json', import.meta.url),
    ...Object.fromEntries(['index.mjs', 'worker.mjs', 'cli.mjs'].map((name) => [
      `src/runtime/${name}`, new URL(`./runtime/${name}`, import.meta.url),
    ])),
  };
  const runtimeFiles = Object.fromEntries(await Promise.all(Object.entries(files)
    .map(async ([name, path]) => [name, await readFile(path, 'utf8')])));
  return createRuntimeProfile({ ...options, runtimeFiles });
}
