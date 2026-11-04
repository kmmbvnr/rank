// Hash executable modules, not machine-dependent source maps.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
function hash(dir) {
    const files = [];
    function walk(path) {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const name = resolve(path, entry.name);
            if (entry.isDirectory()) walk(name);
            else if (name.endsWith('.js')) files.push(name);
        }
    }
    walk(dir);
    const digest = createHash('sha256');
    for (const file of files.sort()) {
        digest.update(relative(dir, file));
        digest.update('\0');
        digest.update(readFileSync(file));
    }
    return { files: files.length, sha256: digest.digest('hex') };
}
console.log(JSON.stringify({
    language: hash(resolve(root, 'packages/language/out')),
    variants: Object.fromEntries(['current', 'pages', 'journal', 'checkpoint']
        .map(name => [name, hash(resolve(out, name))])),
}, null, 2));
