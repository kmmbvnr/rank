import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { RankIntegerGroups } from '../src/integer-groups.js';
import { prepareCaptureProtection } from '../src/capture-protection.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { isKnownFileFree } from '../src/resource-summary.js';

describe('bounded integer groups', () => {
    it('keeps empty groups implicit and reads them without growing storage', () => {
        const groups = new RankIntegerGroups(100000n);
        expect(groups.storageBytes).toBe(800000);
        expect([...groups.at(0n).plan.iterate()]).toEqual([]);
        expect([...groups.at(99999n).plan.iterate()]).toEqual([]);
        expect(groups.storageBytes).toBe(800000);
        expect(isKnownFileFree(groups)).toBe(true);
    });

    it('agrees with ordinary lists across chunk boundaries and interleaved keys', () => {
        const groups = new RankIntegerGroups(31n);
        const expected = Array.from({ length: 31 }, () => [] as bigint[]);
        for (let i = 0; i < 70000; i++) {
            const key = i * 17 % 31, value = BigInt(i % 997 - 498);
            groups.insert(BigInt(key), value);
            expected[key].push(value);
        }
        for (let key = 0; key < expected.length; key++) {
            expect([...groups.at(BigInt(key)).plan.iterate()]).toEqual(expected[key]);
        }
    });

    it('preserves signed 64-bit boundaries and arbitrary-size integers exactly', () => {
        const groups = new RankIntegerGroups(1n);
        const values = [0n, -(1n << 63n), (1n << 63n) - 1n, 1n << 63n, -(1n << 100n), 7n];
        for (const value of values) groups.insert(0n, value);
        expect([...groups.at(0n).plan.iterate()]).toEqual(values);
    });

    it('validates sizes and keys before changing storage', () => {
        expect(() => new RankIntegerGroups(-1n)).toThrow('groups size');
        expect(() => new RankIntegerGroups(1n << 32n)).toThrow('groups size');
        const empty = new RankIntegerGroups(0n);
        expect(empty.storageBytes).toBe(0);
        expect(() => empty.at(0n)).toThrow('out of bounds');
        const groups = new RankIntegerGroups(2n);
        for (const key of [-1n, 2n, 1n << 100n]) {
            expect(() => groups.insert(key, 1n)).toThrow('out of bounds');
            expect(() => groups.at(key)).toThrow('out of bounds');
        }
        expect(groups.storageBytes).toBe(16);
    });

    it('protects captured references and keeps earlier snapshots unchanged', () => {
        const groups = new RankIntegerGroups(1n);
        const empty = groups.at(0n);
        groups.insert(0n, 3n);
        const before = groups.at(0n);
        groups.insert(0n, 4n);
        expect([...empty.plan.iterate()]).toEqual([]);
        expect([...before.plan.iterate()]).toEqual([3n]);
        prepareCaptureProtection(groups, 'captured groups')();
        expect(() => groups.insert(0n, 5n)).toThrow('captured groups');
        expect([...groups.at(0n).plan.iterate()]).toEqual([3n, 4n]);
    });

    it('allows cancellation while traversing a large group', () => {
        const groups = new RankIntegerGroups(1n);
        for (let i = 0; i < 10000; i++) groups.insert(0n, BigInt(i));
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => [...groups.at(0n).plan.iterate()])).toThrow(InterruptedError);
        expect([...groups.at(0n).plan.iterate()].at(-1)).toBe(9999n);
    });

    it.each([false, true])('shares references through calls and iterates snapshots (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const result = runtime.execute(`use algo
G = 4 groups
Alias = G
Alias 3 7 insert
fun G K V store
  G K V insert
  return 0
end
Ignored = G 3 8 store
Before = G 3 array
G 3 9 insert
Before 0 = 99
Total = 0
for Value in G 3
  Total += Value
  G 3 0 insert
end
Total + (G 0 len) + (G 3 0)
`);
            expect(result).toBe(31n);
            expect(runtime.execute('Before 0')).toBe(99n);
            expect(runtime.execute('G is .groups')).toBe(true);
            expect(runtime.execute('G 3 len')).toBe(6n);
            expect(runtime.execute('G 4 default 42')).toBe(42n);
        } finally { runtime.dispose(); }
    });

    it.each(['1.0 groups', 'G 1.0 2 insert', 'G 1 2.0 insert', 'G 1 "x" insert', 'G 1.0'])
        ('rejects incompatible inputs: %s', source => {
            const runtime = new Interpreter(() => {});
            try {
                runtime.execute('use algo\nG = 2 groups');
                expect(() => runtime.execute(source)).toThrow(/integer/);
                expect(runtime.execute('G 1 len')).toBe(0n);
            } finally { runtime.dispose(); }
        });
});
