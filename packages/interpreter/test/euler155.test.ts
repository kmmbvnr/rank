import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const demos = fileURLToPath(new URL('../../../demos/euler/', import.meta.url));
type Fraction = readonly [bigint, bigint];
const levels: Map<string, Fraction>[] = [new Map(), new Map([['1/1', [1n, 1n]]])];
const all = new Set(['1/1']), expected = [0, 1];
// Explicit series and parallel joins, without packed keys or reciprocal symmetry.
for (let n = 2; n <= 10; n++) {
    const level = new Map<string, Fraction>();
    const add = (p: bigint, q: bigint) => {
        let a = p, b = q;
        while (b) [a, b] = [b, a % b];
        p /= a; q /= a;
        level.set(`${p}/${q}`, [p, q]);
    };
    for (let i = 1; i < n; i++) {
        for (const [a, b] of levels[i].values()) for (const [c, d] of levels[n - i].values()) {
            add(a * d + b * c, b * d);
            add(a * c, a * d + b * c);
        }
    }
    levels.push(level);
    for (const key of level.keys()) all.add(key);
    expected.push(all.size);
}

describe.each([false, true])('capacitor circuits (compilation=%s)', compilation => {
    it.each(Array.from({ length: 10 }, (_, index) => index + 1))('matches rational enumeration for Count=%i', count => {
        const runtime = new Interpreter(() => {}, { compilation, args: [`--count=${count}`] });
        try {
            runtime.execute(readFileSync(resolve(demos, '155_capacitors.ra'), 'utf8'));
            expect(runtime.variables.get('Answer')).toBe(BigInt(expected[count]));
        } finally { runtime.dispose(); }
    });

    it('retains all existing fixture assertions', () => {
        const file = resolve(demos, '155_capacitors_test.ra');
        const runtime = new Interpreter(() => {}, { compilation, testing: true, sourceId: file,
            loadModule(specifier, from) {
                const id = resolve(dirname(from ?? file), `${specifier}.ra`);
                return { id, source: readFileSync(id, 'utf8') };
            },
        });
        try {
            runtime.execute(readFileSync(file, 'utf8'));
            expect(runtime.testResults).toHaveLength(2);
            expect(runtime.testResults.every(test => test.passed)).toBe(true);
        } finally { runtime.dispose(); }
    }, 30_000);
});
