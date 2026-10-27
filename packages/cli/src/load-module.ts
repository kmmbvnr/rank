import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, compileRam, ramWeightName } from '@arrrank/interpreter';

export function loadModule(specifier: string, fromId?: string) {
    const base = fromId && fromId !== '<input>' ? path.dirname(fromId) : process.cwd();
    let id = path.resolve(base, specifier);
    if (!path.extname(id)) id += '.ra';
    return { id, source: fs.readFileSync(id, 'utf8'), readBinary: (name: string) => {
        if (!ramWeightName.test(name)) throw new Error('Invalid RAM attachment name');
        const file = path.join(path.dirname(id), name);
        if (fs.statSync(file).size > 4 * 1_048_576 + 1032) throw new Error('RAM attachment is too large');
        return fs.readFileSync(file);
    } };
}

/** Analysis sees the same callable RAM interface as the runtime importer. */
export function loadModuleProgram(specifier: string, fromId?: string) {
    const module = loadModule(specifier, fromId);
    return /\.ram$/i.test(module.id) ? compileRam(module.source, module.id, module.readBinary).program : parse(module.source, module.id);
}
