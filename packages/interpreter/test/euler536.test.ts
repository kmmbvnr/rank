import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/536_modulopower.ra', import.meta.url), 'utf8');
function factors(n: number) { const result: number[] = []; for (let p = 2; p * p <= n; p++) while (n % p === 0) { result.push(p); n /= p; } if (n > 1) result.push(n); return result; }
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
function valid(n: number) { const all = factors(n), distinct = [...new Set(all)]; return all.length === distinct.length && distinct.every(p => (n + 3) % (p - 1) === 0); }
function values(limit: number) { return Array.from({ length: limit }, (_, i) => i + 1).filter(valid).map(BigInt); }
function read(runtime: Interpreter, name: string): bigint[] { const value = runtime.variables.get(name); if (!value || !isRankArray(value)) throw Error(`expected ${name} array`); return [...value.items] as bigint[]; }
const modes: { name: string; options: InterpreterOptions }[] = [
    { name: 'Number', options: {} }, { name: 'exact', options: { numberLoopCompilation: false } }, { name: 'reference', options: { compilation: false } },
];
describe.each(modes)('Euler 536 $name', ({ options }) => {
    it.each([0, 1, 2, 3, 4, 5, 6, 20, 21, 22, 100, 1000])('matches all qualifying integers through %s', limit => {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`, '--u0=100'] });
        try {
            runtime.execute(source);
            const actual = [...read(runtime, 'Solutions'), ...read(runtime, 'Base')].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
            const wanted = values(limit);
            expect(actual).toEqual(wanted);
            expect(runtime.variables.get('Answer')).toBe(wanted.reduce((a, b) => a + b, 0n));
        } finally { runtime.dispose(); }
    });
    it.each([{ cut: 0, threshold: 1, batch: 7 }, { cut: 1, threshold: 2, batch: 1 }, { cut: 10, threshold: 5, batch: 13 }, { cut: 10000, threshold: 10000, batch: 262144 }])('preserves CRT branching and chunk boundaries with %j', ({ cut, threshold, batch }) => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=10000', `--u0=${cut}`, `--t=${threshold}`, `--batch=${batch}`] });
        try {
            runtime.execute(source);
            const wanted = values(10000), actual = [...read(runtime, 'Solutions'), ...read(runtime, 'Base')].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
            expect(actual).toEqual(wanted);
        } finally { runtime.dispose(); }
    });
    it('matches each stored odd squarefree flag, largest prime and radical period', () => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(source.slice(0, source.indexOf('Table = Cut factor_tables')));
            const table = runtime.execute('1000 factor_tables');
            if (!table || typeof table !== 'object' || table.kind !== 'tuple') throw Error('expected tables tuple');
            const arrays = table.items.map(value => { if (!isRankArray(value)) throw Error('expected table'); return [...value.items]; });
            for (let index = 0; index < 500; index++) {
                const fs = factors(index * 2 + 1), primes = [...new Set(fs)];
                const period = primes.reduce((a, p) => a / gcd(a, p - 1) * (p - 1), 1);
                expect(arrays[0][index]).toBe(fs.length === primes.length);
                expect(arrays[1][index]).toBe(BigInt(primes.at(-1) ?? 1));
                expect(arrays[2][index]).toBe(BigInt(period));
            }
        } finally { runtime.dispose(); }
    });
});
it('matches the full exact result', () => {
    const runtime = new Interpreter(() => {});
    try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(3557005261906288n); }
    finally { runtime.dispose(); }
}, 120_000);

it('checks the criterion against every residue directly on small moduli', () => {
    for (let modulus = 1; modulus <= 80; modulus++) {
        let identity = true;
        for (let a = 0n; a < BigInt(modulus); a++) {
            if ((a ** BigInt(modulus + 4)) % BigInt(modulus) !== a) { identity = false; break; }
        }
        expect(valid(modulus)).toBe(identity);
    }
});
