import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isNativeFunction, isRankArray } from '../src/index.js';
import { arrayValues, derivedArray, typedArray, writeArrayCell } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

function evaluate(source: string) {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        return d.run(() => {
            const value = r.execute('use linalg\nuse sequences\n' + source)!;
            return { value: isRankArray(value) ? { shape: value.shape, cells: [...arrayValues(value)] } : value,
                fused: d.modularMatrixPowers };
        });
    } finally { r.dispose(); }
}
function outcome(source: string) {
    try { return evaluate(source); }
    catch (error) { return { error: (error as Error).message, name: (error as Error).name, fused: 0 }; }
}
const matrix = 'A = (array 5 -7 9 -11) reshape 2 2\n';

describe('modular matrix powers', () => {
    it.each([false, true])('matches exact powers over small matrices (parenthesized=%s)', parens => {
        for (const size of [0, 1, 2, 3]) for (const power of [0, 1, 2, 5]) {
            for (const modulus of [1, 2, 11, 1000000007, 1307674368000]) {
                const cells = Array.from({ length: size * size }, (_, i) => i * 17 % 23 - 11);
                const head = cells.length ? `A = (array ${cells.join(' ')}) reshape ${size} ${size}\n` : 'A = array shape 0 0 fill 0\n';
                const exact = evaluate(head + `P = A matpow ${power}\nP mod ${modulus}`);
                const expression = parens ? `(A matpow ${power})` : `A matpow ${power}`;
                const fused = evaluate(head + `${expression} mod ${modulus}`);
                expect(fused.value).toEqual(exact.value);
                expect(fused.fused).toBe(1);
                expect(exact.fused).toBe(0);
            }
        }
    });
    it('keeps initial wide integers and large moduli exact', () => {
        const head = `A = (array ${1n << 100n} ${-(1n << 90n)} 7 -3) reshape 2 2\n`;
        for (const m of [1307674368000n, (1n << 83n) + 7n]) {
            expect(evaluate(head + `A matpow 5 mod ${m}`).value)
                .toEqual(evaluate(head + `P = A matpow 5\nP mod ${m}`).value);
        }
    });
    it('matches the issue example', () => {
        expect(evaluate('A = (array 5 7 9 11) reshape 2 2\nA matpow 5 mod 1000').value)
            .toEqual({ shape: [2, 2], cells: [536n, 208n, 696n, 0n] });
    });
    it('handles a dense 32-square matrix raised to 10^18 with an independent oracle', () => {
        const n = 1000000000000000000n, m = 1000000007n;
        let b = 32n, e = n - 1n, answer = 1n;
        for (; e > 0n; e >>= 1n, b = b * b % m) if (e & 1n) answer = answer * b % m;
        expect(evaluate(`A = array shape 32 32 fill 1\nA matpow ${n} mod ${m}`))
            .toEqual({ fused: 1, value: { shape: [32, 32], cells: Array(1024).fill(answer) } });
    });
    it.each([
        ['(array 1.5 0.0 0.0 2.5) reshape 2 2', '3', '7'],
        ['(array 1 1 1 0) reshape 2 2', '-2', '7'],
        ['(array 1 1 1 1) reshape 2 2', '-1', '7'],
        ['(array 1 2 3 4 5 6) reshape 2 3', '2', '7'],
        ['(array 1 2 3 4) reshape 2 2', '1.5', '7'],
        ['(array 1 2 3 4) reshape 2 2', '2', '0'],
        ['(array 1 2 3 4) reshape 2 2', '2', '-7'],
        ['(array 1 2 3 4) reshape 2 2', '2', '7.5'],
        ['(array 1 2 3 4) reshape 2 2', '2', '(array 3 5)'],
    ])('preserves fallback for %s power %s mod %s', (input, power, modulus) => {
        const head = `A = ${input}\n`;
        expect(outcome(head + `A matpow ${power} mod ${modulus}`))
            .toEqual(outcome(head + `P = A matpow ${power}\nP mod ${modulus}`));
    });
    it('recognizes builtin aliases, leaving user functions ordinary', () => {
        expect(evaluate(matrix + 'pow = matpow\nA pow 5 mod 11').fused).toBe(1);
        expect(evaluate(matrix + 'fun X custom N = X\nA custom 5 mod 11').fused).toBe(0);
    });
    it('does not bypass a modified native implementation', () => {
        const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
        try {
            r.execute('use linalg\nuse sequences\n' + matrix);
            const fn = r.execute('matpow');
            if (!isNativeFunction(fn!)) throw Error('expected function');
            Object.defineProperty(fn, 'call', { value: () => 17n });
            expect(d.run(() => r.execute('A matpow 2 mod 5'))).toBe(2n);
            expect(d.modularMatrixPowers).toBe(0);
        } finally { r.dispose(); }
    });
    it('evaluates operands once and snapshots input before modulus effects', () => {
        const r = new Interpreter(() => {}), calls: string[] = [];
        try {
            r.execute('use linalg');
            r.variables.set('input', native('input', 1, () => { calls.push('input'); return typedArray(BigInt64Array.from([1n, 1n, 1n, 0n]), [2, 2]); }));
            r.variables.set('power', native('power', 1, () => { calls.push('power'); return 5n; }));
            r.variables.set('modulus', native('modulus', 1, () => { calls.push('modulus'); return 11n; }));
            expect(formatValue(r.execute('(0 input) matpow (0 power) mod (0 modulus)')!)).toBe('8 5 5 3');
            expect(calls).toEqual(['input', 'power', 'modulus']);
            r.variables.set('A', typedArray(BigInt64Array.from([1n, 1n, 1n, 0n]), [2, 2]));
            r.variables.set('change', native('change', 1, () => {
                const a = r.variables.get('A')!;
                if (!isRankArray(a)) throw Error('expected array');
                writeArrayCell(a, 0, 99n);
                return 11n;
            }));
            expect(formatValue(r.execute('A matpow 5 mod (0 change)')!)).toBe('8 5 5 3');
        } finally { r.dispose(); }
    });
    it('keeps shape, type and inverse errors before modulus effects', () => {
        for (const source of ['(array shape 2 3 fill 1) matpow 2', '(array shape 2 2 fill 1) matpow 1.5', '(array shape 2 2 fill 1) matpow -1']) {
            const r = new Interpreter(() => {}); let calls = 0;
            try {
                r.execute('use linalg');
                r.variables.set('modulus', native('modulus', 1, () => { calls++; return 7n; }));
                expect(() => r.execute(source + ' mod (0 modulus)')).toThrow();
                expect(calls).toBe(0);
            } finally { r.dispose(); }
        }
    });
    it('reads lazy cells once even when the modulus declines fusion', () => {
        for (const m of ['7', '7.5']) {
            const r = new Interpreter(() => {}), reads: number[] = [];
            try {
                r.execute('use linalg');
                r.variables.set('A', derivedArray([2, 2], [], i => { reads.push(i); return [1n, 1n, 1n, 0n][i]; }));
                formatValue(r.execute(`A matpow 5 mod ${m}`)!);
                expect(reads).toEqual([0, 1, 2, 3]);
            } finally { r.dispose(); }
        }
    });
    it('honors cancellation without changing the input', () => {
        const r = new Interpreter(() => {}), signal = new Int32Array(new SharedArrayBuffer(4));
        try {
            r.execute('use linalg\nA = array shape 32 32 fill 1');
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => r.execute('A matpow 1000000000000000000 mod 1000000007'))).toThrow(InterruptedError);
            expect(r.execute('A 0 0')).toBe(1n);
        } finally { r.dispose(); }
    });
    it('rechecks a cached expression after its function binding changes', () => {
        const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
        try {
            r.execute('use linalg\nuse sequences\n' + matrix + 'pow = matpow');
            r.variables.set('change', native('change', 1, () => {
                r.variables.set('pow', native('custom', 2, () => typedArray(BigInt64Array.from([17n, 17n, 17n, 17n]), [2, 2]))); return 0n;
            }));
            const result = d.run(() => r.execute('R = A\nfor I in 1 to 2\n R = A pow 2 mod 11\n 0 change\nend\nR'));
            expect(formatValue(result!)).toBe('6 6 6 6');
            expect(d.modularMatrixPowers).toBe(1);
        } finally { r.dispose(); }
    });
    it('rechecks aliases after operand effects without replaying the operands', () => {
        const r = new Interpreter(() => {}), d = new RuntimeDiagnostics(); let calls = 0;
        try {
            r.execute('use linalg\nuse sequences\n' + matrix + 'pow = matpow');
            r.variables.set('change', native('change', 1, () => {
                calls++;
                r.variables.set('pow', native('custom', 2, () => 17n));
                return 2n;
            }));
            expect(d.run(() => r.execute('A pow (0 change) mod 5'))).toBe(2n);
            expect(calls).toBe(1);
            expect(d.modularMatrixPowers).toBe(0);
        } finally { r.dispose(); }
    });
    it('keeps operand effects before a missing-module error', () => {
        const r = new Interpreter(() => {}); let calls = 0;
        try {
            r.variables.set('input', native('input', 1, () => {
                calls++; return typedArray(BigInt64Array.from([1n]), [1, 1]);
            }));
            expect(() => r.execute('(0 input) matpow 2 mod 7')).toThrow(/use linalg/);
            expect(calls).toBe(1);
        } finally { r.dispose(); }
    });

});

describe('ranked modular matrix powers', () => {
    const head = matrix + 'Powers = array 0 1 2 5\n';
    it('fuses a broadcast matrix and scalar modulus', () => {
        const actual = evaluate(head + 'A matpow Powers rank 2 0 mod 11');
        expect(actual.value).toEqual(evaluate(head + 'R = A matpow Powers rank 2 0\nR mod 11').value);
        expect(actual.fused).toBe(4);
    });
    it('broadcasts matrices, exponents and per-matrix moduli', () => {
        const input = `A = (array 1 7 1 1 1 1 1 0) reshape 2 1 2 2
Powers = array 0 4 12
Mods = (array 1 5 11) reshape 3 1 1
`;
        const actual = evaluate(input + 'A matpow Powers rank 2 0 mod Mods');
        expect(actual.value).toEqual(evaluate(input + 'R = A matpow Powers rank 2 0\nR mod Mods').value);
        expect(actual.fused).toBe(6);
    });
    it('handles very large exponents', () => {
        const input = 'A = (array 1 1 0 1) reshape 2 2\nPowers = array 1000000000000000000 1000000000000000001\n';
        expect(evaluate(input + 'A matpow Powers rank 2 0 mod 7')).toEqual({
            fused: 2, value: { shape: [2, 2, 2], cells: [1n, 1n, 0n, 1n, 1n, 2n, 0n, 1n] },
        });
    });
    it.each(['(array 3 5)', '(array 0 5 7 9) reshape 4 1 1', '7.5', '-7'])
    ('retains elementwise semantics for unsupported modulus %s', modulus => {
        expect(outcome(head + `A matpow Powers rank 2 0 mod ${modulus}`))
            .toEqual(outcome(head + `R = A matpow Powers rank 2 0\nR mod ${modulus}`));
    });
    it('keeps real, negative-power and empty-frame behavior', () => {
        for (const input of [
            'A = (array 1.5 0.0 0.0 2.5) reshape 2 2\nPowers = array 1 2\n',
            'A = (array 1 1 1 0) reshape 2 2\nPowers = array -1 2\n',
            matrix + 'Powers = array shape 0 fill 0\n',
        ]) expect(outcome(input + 'A matpow Powers rank 2 0 mod 5'))
            .toEqual(outcome(input + 'R = A matpow Powers rank 2 0\nR mod 5'));
    });
    it('snapshots stored inputs before modulus side effects', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nuse linalg\n' + head);
            const source = runtime.variables.get('A')!;
            runtime.variables.set('change', native('change', 1, () => {
                if (isRankArray(source)) writeArrayCell(source, 0, 999n);
                return 11n;
            }));
            const expected = evaluate(head + 'R = A matpow Powers rank 2 0\nR mod 11').value;
            const result = diagnostics.run(() => runtime.execute('A matpow Powers rank 2 0 mod (0 change)'))!;
            expect(isRankArray(result) ? { shape: result.shape, cells: [...arrayValues(result)] } : result).toEqual(expected);
            expect(diagnostics.modularMatrixPowers).toBe(4);
        } finally { runtime.dispose(); }
    });
});
