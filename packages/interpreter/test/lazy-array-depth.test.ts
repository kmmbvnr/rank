import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { MissingValueError } from '../src/errors.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { mapBroadcastArrays } from '../src/tensor.js';
import { MISSING, type RankArray, type RankValue } from '../src/value.js';

function lazy(read: (index: number) => RankValue): RankArray {
    return { kind: 'array', shape: [2], itemAt: read,
        get items(): RankValue[] { throw new Error('read ahead'); } };
}

describe('lazy arithmetic dependency depth', () => {
    it.each([
        [true, 'array 1 1'], [false, 'array 1 1'], [true, '1'], [false, '1'],
    ] as const)('reads a long binding chain with compilation %s and operand %s', (compiled, operand) => {
        const runtime = new Interpreter(undefined, { scalarCompilation: compiled,
            integerLoopCompilation: compiled, tensorCellCompilation: compiled });
        try {
            expect(runtime.execute(`A = array 0 1
for I in 1 to 2000
 A += ${operand}
end
A 0`)).toBe(2000n);
            expect(runtime.execute('A 1')).toBe(2001n);
        } finally { runtime.dispose(); }
    });

    it('validates and reads an unread DAG after changing its oldest dependency', () => {
        const source = ownedArray([0n, 1n]);
        const step = ownedArray([1n, 1n]);
        let result = source;
        let calls = 0;
        for (let depth = 0; depth < 5000; depth++) {
            result = mapBroadcastArrays(result, step, (a, b) => {
                calls++;
                return (a as bigint) + (b as bigint);
            });
        }
        expect(calls).toBe(0);
        expect(readArrayItem(result, 0)).toBe(5000n);
        expect(calls).toBe(5000);
        expect(readArrayItem(result, 0)).toBe(5000n);
        expect(calls).toBe(5000);
        source.items[0] = 10n;
        expect(readArrayItem(result, 0)).toBe(5010n);
        expect(calls).toBe(10000);
        expect(readArrayItem(result, 1)).toBe(5001n);
        expect(calls).toBe(15000);
    });

    it('unwinds cancellation during deep reads and remains readable', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        let result = ownedArray([0n]);
        const step = ownedArray([1n]);
        for (let depth = 0; depth < 5000; depth++) {
            result = mapBroadcastArrays(result, step, (a, b) => (a as bigint) + (b as bigint));
        }
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => readArrayItem(result, 0))).toThrow(InterruptedError);
        expect(readArrayItem(result, 0)).toBe(5000n);
    });

    it('reads only the selected cell in operand order and never replays callbacks', () => {
        const events: string[] = [];
        const contract = new ArrayBindingContract('A');
        const left = contract.check(lazy(index => { events.push(`left:${index}`); return 2n; }));
        const right = lazy(index => { events.push(`right:${index}`); return 3n; });
        const result = mapBroadcastArrays(left, right, (a, b) => {
            events.push('add');
            return (a as bigint) + (b as bigint);
        });
        expect(events).toEqual([]);
        expect(readArrayItem(result, 1)).toBe(5n);
        expect(events).toEqual(['left:1', 'right:1', 'add']);
    });

    it('stops at the first operand error and can be read again after a host change', () => {
        let fail = true;
        const events: string[] = [];
        const left = lazy(() => { events.push('left'); if (fail) throw new Error('left failed'); return 2n; });
        const right = lazy(() => { events.push('right'); return 3n; });
        const result = mapBroadcastArrays(left, right, (a, b) => (a as bigint) + (b as bigint));
        expect(() => readArrayItem(result, 0)).toThrow('left failed');
        expect(events).toEqual(['left']);
        fail = false;
        expect(readArrayItem(result, 0)).toBe(5n);
        expect(events).toEqual(['left', 'left', 'right']);
    });

    it('revalidates checked source cells when a binding settles after plan creation', () => {
        const contract = new ArrayBindingContract('A');
        const checked = contract.check(lazy(() => 'text'));
        const result = mapBroadcastArrays(checked, lazy(() => 'suffix'), a => a);
        contract.check(ownedArray([1n, 2n]));
        expect(() => readArrayItem(result, 0)).toThrow(/array elements/);
    });

    it('retains the distinction between soft missing cells and direct read errors', () => {
        const contract = new ArrayBindingContract('A');
        const checked = contract.check(lazy(index => {
            if (index === 0) throw new MissingValueError('absent', true);
            return 2n;
        }));
        expect(() => readArrayItem(checked, 0)).toThrow('absent');
        expect(checked.items).toEqual([MISSING, 2n]);
        expect(readArrayItem(checked, 1)).toBe(2n);
    });
});
