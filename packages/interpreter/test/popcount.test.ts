import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { bitsModule } from '../src/modules/bits.js';
import { run } from './support.js';

const operation = bitsModule.popcount({ output() {}, random: Math.random, seedRandom() {}, ownFile() {} });
if (!isNativeFunction(operation)) throw new Error('missing native popcount');
const count = (value: bigint) => operation.call([value]);

describe('arbitrary-precision popcount', () => {
    it('counts tiny, sparse and dense values without narrowing the input', () => {
        for (let i = 0n; i < 256n; i++) {
            expect(count(i)).toBe(BigInt([...i.toString(2)].filter(bit => bit === '1').length));
        }
        expect(count(1n << 4000000n)).toBe(1n);
        expect(count((1n << 4000000n) - 1n)).toBe(4000000n);
        expect(count((1n << 100000n) | (1n << 50000n) | 7n)).toBe(5n);
    });

    it('agrees with a binary-text oracle for deterministic multiword integers', () => {
        let seed = 123456789;
        for (let sample = 0; sample < 64; sample++) {
            let value = 0n;
            for (let word = 0; word < 16; word++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                value = (value << 32n) | BigInt(seed);
            }
            expect(count(value)).toBe(BigInt([...value.toString(2)].filter(bit => bit === '1').length));
        }
    });

    it('preserves domains, broadcasting and the integer result', () => {
        expect(() => count(-1n)).toThrow('popcount expects a nonnegative integer');
        expect(() => operation.call([1.5])).toThrow('expected integer input');
        expect(run('use bits\n(array 0 1 7 255) popcount')).toBe('0 1 3 8');
        expect(typeof count(255n)).toBe('bigint');
    });

    it('uses the same builtin in compiled and reference loops', () => {
        for (const compilation of [false, true]) {
            let loops = 0;
            const runtime = new Interpreter(() => {}, { compilation, onIntegerLoopExecuted: () => loops++ });
            try {
                const result = runtime.execute('use bits\nX = 1\nTotal = 0\nfor I in 1 to 8\n X = X shl 1000\n Total += (X - 1) popcount\nend\nTotal');
                expect(formatValue(result!)).toBe('36000');
                expect(loops).toBe(compilation ? 1 : 0);
            } finally { runtime.dispose(); }
        }
    });

    it('polls while scanning and restores execution after cancellation', () => {
        let polls = 0;
        const signal: InterruptSignal = {
            length: 1, load: () => 0, store() {}, wait() {},
            exchange: () => ++polls >= 3 ? 1 : 0,
        };
        const input = (1n << 100000n) - 1n;
        expect(() => withInterrupt(signal, () => count(input))).toThrow(InterruptedError);
        expect(polls).toBe(3);
        expect(count(input)).toBe(100000n);
    });
});
