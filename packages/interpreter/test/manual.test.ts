import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { operations } from '@arrrank/language';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, TokenInput } from './support.js';

// UPDATE_MANUAL=1 rewrites each page's result block from its example's actual output.
const update = !!process.env.UPDATE_MANUAL;
const directory = new URL('../../../docs/manual/', import.meta.url);
const files = new Map<string, string>();
const pages = new Map<string, { file: string; source: string; example: string; result?: string }>();
for (const file of readdirSync(directory).filter(file => file.endsWith('.md') && file !== 'README.md')) {
    const text = readFileSync(new URL(file, directory), 'utf8');
    files.set(file, text);
    const parts = text.split(/^## (.+)$/m);
    for (let i = 1; i < parts.length; i += 2) {
        const lead = parts[i + 1].split(/^### /m)[0];
        if (pages.has(parts[i])) throw new Error(`Duplicate manual entry: ${parts[i]}`);
        pages.set(parts[i], {
            file, source: parts[i + 1],
            example: /```rank\n([\s\S]*?)```/.exec(lead)?.[1] ?? '',
            result: /```result\n([\s\S]*?)\n?```/.exec(lead)?.[1],
        });
    }
}
const sections = (source: string) => [...source.matchAll(/^### (.+)$/gm)].map(match => match[1]);
// SQL pages state their existing-database requirement; a minimal host has no SQLite.
const sql = ['sqlite', 'sqlquery', 'sql', 'explain'];

class ManualIo extends MemoryIo {
    listImages() { return [{ name: 'one.png', path: 'photos/one.png' }]; }
    resizeImages(_paths: readonly string[], height: number, width: number) {
        return new Uint8Array(height * width * 3);
    }
}

/** What the REPL shows for an example: printed lines, then the final value. */
function run(example: string): string {
    const printed: string[] = [];
    const runtime = new Interpreter(text => { printed.push(text); }, {
        io: new ManualIo({}), input: new TokenInput(['7']), testing: true,
        loadModule: path => ({ id: path, source: path === 'helpers.ra'
            ? 'fun twice X\n  return X * 2\nend' : 'use io\n"hello" print' }),
    });
    try {
        const value = runtime.execute(example);
        // Formatting forces lazy results, exposing delayed errors in sequences and tables.
        if (value !== undefined) printed.push(formatValue(value));
        return printed.join('\n').replace(/\n+$/, '');
    } finally { runtime.dispose(); }
}

describe('the bundled offline manual', () => {
    it('covers every builtin with a summary, example, usage and valid links within 40 columns', () => {
        for (const name of [...operations.map(operation => operation.name), 'rank-basics']) expect(pages.has(name), name).toBe(true);
        for (const [name, page] of pages) {
            const lead = page.source.split(/^### /m)[0];
            expect(lead.trim().split(/\n\s*\n/)[0], `${name}: summary`).not.toMatch(/^```/);
            expect(page.example, name).not.toBe('');
            for (const old of ['NAME', 'SYNOPSIS', 'DESCRIPTION', 'EXAMPLES']) expect(sections(page.source), name).not.toContain(old);
            if (name !== 'rank-basics') expect(sections(page.source)[0], `${name}: Usage first`).toBe('Usage');
            const links = /^### See also\n([\s\S]*?)(?=^### |$(?![\s\S]))/m.exec(page.source)?.[1];
            for (const link of links?.split(',').map(item => item.trim()).filter(Boolean) ?? [])
                expect(pages.has(link), `${name}: See also ${link}`).toBe(true);
            for (const line of page.source.split('\n')) expect([...line].length, `${name}: ${line}`).toBeLessThanOrEqual(40);
        }
    });

    for (const [name, page] of pages) {
        it(`executes the ${name} example`, () => {
            if (sql.includes(name)) {
                expect(page.source).toMatch(/existing|database/);
                expect(() => run(page.example)).toThrow(/SQLite|sqlite/);
                return;
            }
            const actual = run(page.example);
            if (update) {
                const block = actual ? '```result\n' + actual + '\n```\n\n' : '';
                const at = files.get(page.file)!.indexOf(`## ${name}\n`);
                const text = files.get(page.file)!;
                const end = text.indexOf('\n### ', at);
                const lead = text.slice(at, end < 0 ? text.length : end + 1)
                    .replace(/```result\n[\s\S]*?```\n\n?/, '')
                    .replace(/(```rank\n[\s\S]*?```\n\n?)/, match => match.replace(/\n*$/, '\n\n') + block);
                files.set(page.file, text.slice(0, at) + lead + (end < 0 ? '' : text.slice(end + 1)));
                return;
            }
            expect(page.result ?? '', `${name}: result block`).toBe(actual);
        });
    }

    afterAll(() => {
        if (update) for (const [file, text] of files) writeFileSync(new URL(file, directory), text.replace(/\n+$/, '\n'));
    });
});
