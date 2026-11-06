import {describe, expect, it} from 'vitest';
import {Interpreter, RuntimeDiagnostics} from '../src/index.js';
import {isNativeFunction} from '../src/value.js';

const floor = (a: bigint, b: bigint) => a / b - ((a < 0n) !== (b < 0n) && a % b !== 0n ? 1n : 0n);

describe('bounded Number division in scalar functions', () => {
    it('agrees with exact arithmetic at signed rounding boundaries', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('fun A quotient B\n return A // B\nend');
            const fn = runtime.variables.get('quotient');
            if (!fn || !isNativeFunction(fn)) throw Error('expected function');
            const numerators = [0n, 1n, -1n, 7n, -7n];
            for (const boundary of [1n << 31n, 1n << 52n, (1n << 53n) - 1n]) {
                for (let delta = -3n; delta <= 3n; delta++) {
                    const value = boundary + delta;
                    if (value <= (1n << 53n) - 1n) numerators.push(value, -value);
                }
            }
            const divisors = [1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, (1n << 52n) - 1n, -(1n << 52n), (1n << 53n) - 1n];
            diagnostics.run(() => {
                for (const a of numerators) for (const b of divisors) expect(fn.call([a, b])).toBe(floor(a, b));
                let seed = 433n;
                for (let i = 0; i < 512; i++) {
                    seed = (seed * 6364136223846793005n + 1n) % (1n << 64n);
                    const a = seed % (1n << 53n) * (i % 2 ? -1n : 1n);
                    const b = (seed % 1000003n + 1n) * (i % 3 ? 1n : -1n);
                    expect(fn.call([a, b])).toBe(floor(a, b));
                }
            });
            expect(diagnostics.numberFunctions).toBeGreaterThan(500);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('replays wide arithmetic and retains division errors', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute('fun A quotient B\n return A // B\nend');
            const fn = runtime.variables.get('quotient');
            if (!fn || !isNativeFunction(fn)) throw Error('expected function');
            for (const a of [1n << 100n, -(1n << 100n)]) for (const b of [3n, -3n]) expect(fn.call([a, b])).toBe(floor(a, b));
            expect(() => fn.call([7n, 0n])).toThrow('division by zero');
            expect(fn.call([-7n, 3n])).toBe(-3n);
        } finally { runtime.dispose(); }
    });
});
