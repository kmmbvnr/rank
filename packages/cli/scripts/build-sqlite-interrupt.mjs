import { spawnSync } from 'node:child_process';
import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../native/', import.meta.url));
const output = new URL('../native/build/Release/rank_sqlite_interrupt.node', import.meta.url);
const stamp = new URL('../native/build/platform.json', import.meta.url);
const platform = JSON.stringify([process.platform, process.arch, process.versions.modules]);
const sources = ['../native/sqlite-interrupt.cc', '../native/binding.gyp', './build-sqlite-interrupt.mjs'];
try {
    const built = statSync(output).mtimeMs;
    if (readFileSync(stamp, 'utf8') === platform && sources.every(source => statSync(new URL(source, import.meta.url)).mtimeMs <= built)) process.exit(0);
} catch { /* First build, or clean removed the native output. */ }

// npm puts its bundled node-gyp on PATH for lifecycle scripts.
const result = spawnSync('node-gyp', ['rebuild', '--directory', directory], {
    stdio: 'inherit', shell: process.platform === 'win32',
});
if (result.error) throw result.error;
if (result.status === 0) writeFileSync(stamp, platform);
process.exit(result.status ?? 1);
