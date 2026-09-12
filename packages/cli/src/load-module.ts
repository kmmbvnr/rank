import * as fs from 'node:fs';
import * as path from 'node:path';

export function loadModule(specifier: string, fromId?: string): { id: string; source: string } {
    const base = fromId && fromId !== '<input>' ? path.dirname(fromId) : process.cwd();
    let id = path.resolve(base, specifier);
    if (!path.extname(id)) id += '.ra';
    return { id, source: fs.readFileSync(id, 'utf8') };
}
