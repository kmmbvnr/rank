import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankFile } from '../src/index.js';
import { arrayValues, collectArrayCells, readArrayItem, streamCells } from '../src/array-storage.js';
import { sequence, windowValue } from '../src/sequence.js';
import { prepareCaptureProtection } from '../src/capture-protection.js';
import { checkValueMutable } from '../src/value-protection.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { MemoryIo } from './support.js';
import { demandValue } from '../src/plan.js';
import { DemandBudgetExhausted, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';

function exactSource(read: (index: number) => bigint, close = () => {}) {
    return sequence({ name: 'observed', size: { kind: 'exact', value: 3n },
        *iterate() {
            try { for (let index = 0; index < 3; index++) yield read(index); }
            finally { close(); }
        },
    });
}

describe('native window demand', () => {
    it('preserves a source failure when cleanup also fails', () => {
        let closed = 0;
        const source = sequence({ name: 'broken', size: { kind: 'exact', value: 3n },
            iterate() {
                return { next(): IteratorResult<bigint> { throw Error('source failure'); },
                    return() { closed++; throw Error('close failure'); },
                    [Symbol.iterator]() { return this; },
                };
            },
        });
        expect(() => (windowValue(source, 2n) as RankArray).items).toThrow('source failure');
        expect(closed).toBe(1);
    });

    it('streams partial scalar demand without reading the rest of a window', () => {
        const reads: number[] = [];
        let closed = 0;
        const source = exactSource(index => { reads.push(index); return BigInt(index + 1); }, () => closed++);
        const window = windowValue(source, 3n) as RankArray;
        for (let attempt = 0; attempt < 2; attempt++) {
            const reader = streamCells(window);
            expect(reader.next().value).toBe(1n);
            expect(reads).toEqual(Array(attempt + 1).fill(0));
            reader.return?.();
            expect(closed).toBe(attempt + 1);
        }
    });

    it('stops a validating traversal before reading another source cell', () => {
        const runtime = new Interpreter();
        const reads: number[] = [];
        let closed = 0;
        try {
            runtime.execute('use sequences\nA = array shape 2 2 fill 1');
            runtime.variables.set('Source', sequence({ name: 'bad', size: { kind: 'exact', value: 3n },
                *iterate() {
                    try {
                        for (let index = 0; index < 3; index++) { reads.push(index); yield index ? 1n : 'bad'; }
                    } finally { closed++; }
                },
            }));
            runtime.execute("A' = Source window 2");
            const window = demandValue(runtime.variables.get('A')!) as RankArray;
            expect(reads).toEqual([]);
            expect(() => collectArrayCells(window)).toThrow(/array elements/);
            expect(reads).toEqual([0]);
            expect(closed).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('retains overlap only inside one strided traversal and leaves the unused suffix unread', () => {
        const reads: number[] = [];
        let closed = 0;
        const source = sequence({ name: 'strided', size: { kind: 'exact', value: 20n },
            *iterate() {
                try { for (let index = 0; index < 20; index++) { reads.push(index); yield BigInt(index); } }
                finally { closed++; }
            },
        });
        const window = windowValue(source, 2n, undefined, 10n) as RankArray;
        expect(window.items).toEqual([0n, 1n, 10n, 11n]);
        expect(reads).toEqual(Array.from({ length: 12 }, (_, index) => index));
        expect(closed).toBe(1);
        expect([...arrayValues(window)]).toEqual([0n, 1n, 10n, 11n]);
        expect(reads).toHaveLength(24);
        expect(closed).toBe(2);
    });

    it('closes and restarts a traversal after its prefix-skip budget expires', () => {
        let reads = 0;
        let closed = 0;
        const source = sequence({ name: 'budgeted', size: { kind: 'exact', value: 20n },
            *iterate() {
                try { for (let index = 0; index < 20; index++) { reads++; yield BigInt(index); } }
                finally { closed++; }
            },
        });
        const window = windowValue(source, 2n, undefined, 10n) as RankArray;
        expect(() => withDemandBudget(2, () => window.items)).toThrow(DemandBudgetExhausted);
        expect(reads).toBeLessThan(10);
        expect(closed).toBe(1);
        expect(withDemandBudget(20, () => window.items)).toEqual([0n, 1n, 10n, 11n]);
        expect(closed).toBe(2);
    });

    it('checks collection capacity before opening a source reader', () => {
        let opened = 0;
        const source = sequence({ name: 'large', size: { kind: 'exact', value: 1n << 32n },
            iterate() { opened++; return [1n][Symbol.iterator](); },
        });
        const window = windowValue(source, 2n) as RankArray;
        expect(() => window.items).toThrow('too large');
        expect(opened).toBe(0);
    });

    it.each([[2000n, 1n], [2n, 4000n]])('closes a sequential window reader on host interruption (width=%s, stride=%s)', (width, stride) => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        let reads = 0;
        let closed = 0;
        const source = sequence({ name: 'interruptible', size: { kind: 'exact', value: 5000n },
            *iterate() {
                try {
                    for (let index = 0; index < 5000; index++) {
                        if (++reads === 1500) Atomics.store(signal, 0, 1);
                        yield BigInt(index);
                    }
                } finally { closed++; }
            },
        });
        const window = windowValue(source, width, undefined, stride) as RankArray;
        expect(() => withInterrupt(signal, () => { for (const item of streamCells(window)) void item; })).toThrow(InterruptedError);
        expect(reads).toBeLessThan(3000);
        expect(closed).toBe(1);
        const interrupted = reads;
        const prefix: bigint[] = [];
        for (const item of arrayValues(window)) {
            prefix.push(item as bigint);
            if (prefix.length === 2) break;
        }
        expect(prefix).toEqual([0n, 1n]);
        expect(reads).toBe(interrupted + 2);
        expect(closed).toBe(2);
    });

    it('reads exact sequences afresh and closes partial readers', () => {
        let reads = 0;
        let closed = 0;
        const source = exactSource(index => { reads++; return BigInt(index + 1); }, () => closed++);
        const window = windowValue(source, 2n) as RankArray;
        expect(window.shape).toEqual([2, 2]);
        expect(reads).toBe(0);
        expect(readArrayItem(window, 0)).toBe(1n);
        expect(readArrayItem(window, 0)).toBe(1n);
        expect(reads).toBe(2);
        expect(closed).toBe(2);
        expect(window.items).toEqual([1n, 2n, 2n, 3n]);
        const pass = reads - 2;
        expect(pass).toBe(3);
        expect(window.items).toEqual([1n, 2n, 2n, 3n]);
        expect(reads).toBe(2 + pass * 2);
    });

    it('preserves direct source indexing without creating an iterator', () => {
        const source = sequence({ name: 'indexed', size: { kind: 'exact', value: 1_000_000n },
            *iterate(): IterableIterator<bigint> { throw Error('iterated'); },
            at: index => index,
        });
        const window = windowValue(source, 3n) as RankArray;
        expect(window.shape).toEqual([999998, 3]);
        expect(readArrayItem(window, 2999993)).toBe(999999n);
    });

    it('protects mutable children of a captured queue window', () => {
        const child = { kind: 'record' as const, entries: new Map([['value', 1n]]), types: new Map([['value', 'integer']]) };
        const window = windowValue({ kind: 'queue', items: [child, child] }, 2n);
        prepareCaptureProtection(window, 'captured window')();
        expect(() => checkValueMutable(child)).toThrow('captured window');
    });

    it('transfers a declared sequence resource without reading its cells', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        let reads = 0;
        try {
            const window = ownership.withResourceScope(() => {
                ownership.ownFile(file);
                const source = sequence({ name: 'files', size: { kind: 'exact', value: 2n },
                    captures: [new Map([['file', file]])],
                    *iterate() { reads++; yield file; yield file; },
                });
                return windowValue(source, 2n);
            });
            expect(reads).toBe(0);
            expect(file.closed).toBe(false);
            expect(readArrayItem(window as RankArray, 0)).toBe(file);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });

    it('restarts source work after a failed window read', () => {
        const reads: number[] = [];
        let broken = true;
        const source = exactSource(index => {
            reads.push(index);
            if (broken && index === 1) throw Error('source failure');
            return BigInt(index + 1);
        });
        const window = windowValue(source, 2n) as RankArray;
        expect(() => window.items).toThrow('source failure');
        const failed = [...reads];
        expect(() => window.items).toThrow('source failure');
        expect(reads).toEqual([...failed, ...failed]);
        broken = false;
        expect(window.items).toEqual([1n, 2n, 2n, 3n]);
    });
});

it.each([false, true])('retains window results only at an ordinary binding (compilation=%s)', compilation => {
    let reads = 0;
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute('use sequences');
        runtime.variables.set('Source', exactSource(index => { reads++; return BigInt(index + 1); }));
        runtime.execute("W' = Source window 2");
        expect(reads).toBe(0);
        expect(runtime.execute('W sum')).toBe(8n);
        const pass = reads;
        expect(pass).toBe(3);
        expect(runtime.execute('W sum')).toBe(8n);
        expect(reads).toBe(pass * 2);
        const beforeCompletion = reads;
        runtime.execute('Saved = W');
        const completed = reads;
        expect(completed - beforeCompletion).toBe(3);
        const saved = runtime.variables.get('Saved')!;
        expect(isRankArray(saved)).toBe(true);
        if (isRankArray(saved)) expect(saved.shape).toEqual([2, 2]);
        expect(runtime.execute('Saved sum')).toBe(8n);
        expect(reads).toBe(completed);
        runtime.variables.set('Empty', sequence({ name: 'empty', size: { kind: 'exact', value: 0n }, *iterate() {} }));
        runtime.execute('EmptySaved = Empty window 2');
        expect((runtime.variables.get('EmptySaved') as RankArray).shape).toEqual([0, 2]);
    } finally { runtime.dispose(); }
});
