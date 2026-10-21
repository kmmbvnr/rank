import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankFile } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { sequence, windowValue } from '../src/sequence.js';
import { prepareCaptureProtection } from '../src/capture-protection.js';
import { checkValueMutable } from '../src/value-protection.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { MemoryIo } from './support.js';

function exactSource(read: (index: number) => bigint, close = () => {}) {
    return sequence({ name: 'observed', size: { kind: 'exact', value: 3n },
        *iterate() {
            try { for (let index = 0; index < 3; index++) yield read(index); }
            finally { close(); }
        },
    });
}

describe('native window demand', () => {
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
        expect(pass).toBeGreaterThan(0);
        expect(runtime.execute('W sum')).toBe(8n);
        expect(reads).toBe(pass * 2);
        runtime.execute('Saved = W');
        const completed = reads;
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
