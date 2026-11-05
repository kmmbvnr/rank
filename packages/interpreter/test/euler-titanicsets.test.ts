import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/415_titanicsets.ra', import.meta.url), 'utf8');
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
// Enumerate geometric lines independently of the totient recurrence.
function oracle(n: number): bigint {
    const points: [number, number][] = [];
    for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) points.push([x, y]);
    const lines = new Map<string, [number, number, number]>();
    for (let i = 0; i < points.length; i++) for (let j = 0; j < i; j++) {
        let a = points[i][1] - points[j][1], b = points[j][0] - points[i][0];
        const d = gcd(Math.abs(a), Math.abs(b));
        a /= d; b /= d;
        if (a < 0 || a === 0 && b < 0) { a = -a; b = -b; }
        const c = a * points[i][0] + b * points[i][1];
        lines.set(`${a},${b},${c}`, [a, b, c]);
    }
    let excluded = 1n + BigInt(points.length);
    for (const [a, b, c] of lines.values()) {
        const count = points.filter(([x, y]) => a * x + b * y === c).length;
        if (count >= 3) excluded += (1n << BigInt(count)) - 1n - BigInt(count) - BigInt(count * (count - 1) / 2);
    }
    return ((1n << BigInt(points.length)) - excluded) % 100000000n;
}

describe('Euler 415 Titanic Sets', () => {
    it.each([1, 2, 3, 4, 5, 6])('matches geometric enumeration with a minimal prefix table at N=%s', n => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, '--l=1'] });
            try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(oracle(n)); }
            finally { runtime.dispose(); }
        }
    });
    it.each([[111, 30, 13500401n], [100000, 400, 63259062n]])('matches the published checkpoint at N=%s with recursive tables', (n, l, expected) => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--l=${l}`] });
            const diagnostics = new RuntimeDiagnostics();
            try {
                diagnostics.run(() => runtime.execute(source));
                expect(runtime.variables.get('Answer')).toBe(expected);
                if (!Object.keys(options).length) {
                    expect(diagnostics.numberLoops).toBe(1);
                    expect(diagnostics.numberLoopOverflows).toBe(0);
                }
            } finally { runtime.dispose(); }
        }
    });
});
