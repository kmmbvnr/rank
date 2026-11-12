import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = new URL('../test/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.test.mjs'))
    .sort().map(name => fileURLToPath(new URL(name, directory)));
// Node test options must precede the file list to take effect.
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
