import * as fs from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { createReplSession as createSession, sessionEditor as editor, type SessionSnapshot } from '@arrrank/common/repl-session';
import { loadModule } from './load-module.js';
import { NodeInput, nodeIo } from './node-io.js';
import { nodeMd5 } from './node-crypto.js';
export type { Execution, OutputLine, ProgramFile, SessionSnapshot } from '@arrrank/common/repl-session';
function fileArgument(text: string): string {
    const quoted = (text.startsWith('"') && text.endsWith('"'))
        || (text.startsWith("'") && text.endsWith("'"));
    const value = quoted ? text.slice(1, -1) : text;
    return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function completeLoadPath(typed: string): [string[], string] {
    const quote = typed.startsWith('"') ? '"' : typed.startsWith("'") ? "'" : '';
    const value = quote ? typed.slice(1, typed.endsWith(quote) && typed.length > 1 ? -1 : undefined) : typed;
    const slash = value.lastIndexOf('/');
    const directory = value.slice(0, slash + 1);
    const name = value.slice(slash + 1);
    try {
        const entries = readdirSync(fileArgument(directory || '.'), { withFileTypes: true })
            .filter(entry => entry.name.startsWith(name))
            .flatMap(entry => {
                try {
                    const kind = entry.isSymbolicLink() ? statSync(path.join(fileArgument(directory || '.'), entry.name)) : entry;
                    if (kind.isDirectory()) return [{ name: entry.name, directory: true }];
                    if (kind.isFile() && entry.name.toLowerCase().endsWith('.ra')) return [{ name: entry.name, directory: false }];
                } catch { /* A dangling link is not a completion. */ }
                return [];
            })
            .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
        return [entries.map(entry => quote + directory + entry.name + (entry.directory ? '/' : quote)), typed];
    } catch { return [[], typed]; }
}


export function createReplSession() {
    return createSession({
        options: { input: new NodeInput(), io: nodeIo, md5: nodeMd5, sourceId: path.join(process.cwd(), '<repl>'), loadModule },
        colors: chalk,
        resolvePath: text => text ? path.resolve(fileArgument(text)) : '',
        completePath: completeLoadPath,
        readFile: name => fs.readFile(name, 'utf8'),
        writeFile: (name, source) => fs.writeFile(name, source, 'utf8'),
    });
}
export function sessionEditor(snapshot: SessionSnapshot) { return editor(snapshot, completeLoadPath); }
