import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { operations } from '@arrrank/language';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, TokenInput } from './support.js';

const directory = new URL('../../../docs/manual/', import.meta.url);
const pages = new Map<string, { source: string; example: string }>();
for (const file of readdirSync(directory).filter(file => file.endsWith('.md'))) {
    const parts = readFileSync(new URL(file, directory), 'utf8').split(/^## (.+)$/m);
    for (let i = 1; i < parts.length; i += 2) {
        const example = /```rank\n([\s\S]*?)```/.exec(parts[i + 1]);
        if (pages.has(parts[i])) throw new Error(`Duplicate manual entry: ${parts[i]}`);
        pages.set(parts[i], { source: parts[i + 1], example: example?.[1] ?? '' });
    }
}

const results: Record<string, string | number | bigint | boolean> = {
    sum: 15n, max: 5n, min: 3n, len: 5n, integer: 42n, real: 3.5, text: '42',
    sqrt: 3, isqrt: 3n, gcd: 6n, lcm: 36n, binomial: 10n, binomialmod: 3n, powmod: 24n,
    and: false, or: true, xor: true, not: true, equal: true, 'not equal': true,
    less: true, greater: true, 'at least': true, 'at most': true, in: true, is: true,
    'multiple by': true, true: true, false: false, default: 0n,
    for: 6n, break: 3n, continue: 4n, if: 1n, elif: 'zero', else: 'nonpositive',
    end: 7n, fun: 6n, memo: 9n, return: 3n, finally: true, try: 'caught',
    argument: 6n, option: 10n, flag: false, stdin: 7n, 'rank-basics': 6n,
    'first where': 4n, 'first index where': 3n, first: 7n, last: 8n,
    take: 'abc', drop: 'def', reverse: 'cba', lower: 'rank',
    character: 'A', codepoint: 65n, join: 'a,b', lpad: '007', startswith: true,
    band: 2n, bor: 7n, bxor: 5n, shl: 12n, shr: 3n, popcount: 2n,
    day: 29n, month: 2n, year: 2024n, weekday: 3n, hour: 13n, minute: 5n, second: 9n,
    seconds: 90n, det: 6n, query: 8n, firstatleast: 1n,
};

class ManualIo extends MemoryIo {
    listImages() { return [{ name: 'one.png', path: 'photos/one.png' }]; }
    resizeImages(_paths: readonly string[], height: number, width: number) {
        return new Uint8Array(height * width * 3);
    }
}

describe('the bundled offline manual', () => {
    it('covers every builtin and has four complete sections within 40 columns', () => {
        for (const name of [...operations.map(operation => operation.name), 'rank-basics']) expect(pages.has(name), name).toBe(true);
        for (const [name, page] of pages) {
            for (const section of ['NAME', 'SYNOPSIS', 'DESCRIPTION', 'EXAMPLES'])
                expect(page.source, `${name}: ${section}`).toContain(`### ${section}`);
            expect(page.example, name).not.toBe('');
            expect(page.source, name).not.toContain('Usage template');
            for (const line of page.source.split('\n')) expect([...line].length, `${name}: ${line}`).toBeLessThanOrEqual(40);
        }
    });

    for (const [name, page] of pages) {
        it(`executes the ${name} example`, () => {
            const runtime = new Interpreter(() => undefined, {
                io: new ManualIo({}), input: new TokenInput(['7']), testing: true,
                loadModule: path => ({ id: path, source: path === 'helpers.ra'
                    ? 'fun twice X\n  return X * 2\nend' : 'use io\n"hello" print' }),
            });
            try {
                // SQL pages state their existing-database requirement. A minimal host
                // must report that SQLite is unavailable, rather than silently working.
                if (['sqlite', 'sqlquery', 'sql', 'explain'].includes(name)) {
                    expect(page.source).toMatch(/existing|database/);
                    expect(() => runtime.execute(page.example)).toThrow(/SQLite|sqlite/);
                    return;
                }
                const value = runtime.execute(page.example);
                // Force lazy results to expose delayed errors in sequences and tables.
                if (value !== undefined) expect(formatValue(value)).toBeTypeOf('string');
                if (name in results) expect(value).toBe(results[name]);
            } finally { runtime.dispose(); }
        });
    }
});
