import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, compileRam } from '@arrrank/interpreter';

export function loadModule(specifier: string, fromId?: string): { id: string; source: string } {
    const base = fromId && fromId !== '<input>' ? path.dirname(fromId) : process.cwd();
    let id = path.resolve(base, specifier);
    if (!path.extname(id)) id += '.ra';
    return { id, source: fs.readFileSync(id, 'utf8') };
}

/** Analysis sees the same callable RAM interface as the runtime importer. */
export function loadModuleProgram(specifier: string, fromId?: string) {
    const module = loadModule(specifier, fromId);
    return /\.ram$/i.test(module.id) ? compileRam(module.source, module.id).program : parse(module.source, module.id);
}
