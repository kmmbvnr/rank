import { describe, expect, it, vi } from 'vitest';
import { Interpreter, isNativeFunction, isRankIndex, isRankRecord, type RankArray, type RankFile } from '../src/index.js';
import { newStructure } from '../src/collections.js';
import { RankDeque, RankHeap } from '../src/containers.js';
import { isKnownFileFree } from '../src/resource-summary.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { derivedArray, ownedArray, readArrayItem } from '../src/array-storage.js';
import { shiftValue, windowValue } from '../src/sequence.js';
import { chooseValue } from '../src/modules/sequences.js';
import { MemoryIo } from './support.js';

describe('container resource summaries', () => {
    it.each(['window', 'shift', 'choose'])('preserves a captured %s value without computing cells', operation => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        try {
            const result = ownership.withResourceScope(() => {
                ownership.ownFile(file);
                return operation === 'window'
                    ? windowValue(ownedArray([], [0]), 1n, undefined, undefined, 1n, file)
                    : operation === 'shift' ? shiftValue(ownedArray([0n]), 1n, file)
                        : chooseValue(ownedArray([true]), file, file);
            });
            expect(file.closed).toBe(false);
            expect(readArrayItem(result as RankArray, 0)).toBe(file);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });

    it('transfers resources through declared array dependencies without reading lazy cells', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        let reads = 0;
        try {
            const view = ownership.withResourceScope(() => {
                ownership.ownFile(file);
                const source = ownedArray([file]);
                return derivedArray([1], [source], index => { reads++; return readArrayItem(source, index); });
            });
            expect(reads).toBe(0);
            expect(file.closed).toBe(false);
            expect(readArrayItem(view, 0)).toBe(file);
            expect(reads).toBe(1);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });

    it.each([false, true])('retains a computed file only when returned explicitly (retained=%s)', retained => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        let reads = 0;
        try {
            ownership.withResourceScope(() => {
                ownership.ownFile(file);
                const view = derivedArray([2], [], index => {
                    reads++;
                    if (index) throw new Error('unread cell');
                    return file;
                });
                const cell = readArrayItem(view, 0);
                expect(cell).toBe(file);
                return retained ? { kind: 'tuple' as const, items: [cell, view] } : view;
            });
            expect(reads).toBe(1);
            expect(file.closed).toBe(!retained);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });

    it.each(['index', 'set', 'counter'])('does not walk a growing numeric %s on return', kind => {
        const runtime = new Interpreter();
        runtime.execute(`use algo\nfun A identity\n  return A\nend\nValues = new ${kind}`);
        const value = runtime.variables.get('Values')!;
        if (!('entries' in (value as object))) throw new Error('expected map');
        const entries = (value as { entries: Map<string, unknown> }).entries;
        for (let index = 0; index < 1000; index++) entries.set(String(index), kind === 'counter'
            ? { value: BigInt(index), count: 1n } : BigInt(index));
        const reads = vi.spyOn(entries, 'values');
        const fn = runtime.variables.get('identity')!;
        if (!isNativeFunction(fn)) throw new Error('expected function');
        for (let count = 0; count < 100; count++) expect(fn.call([value])).toBe(value);
        expect(reads).not.toHaveBeenCalled();
        runtime.dispose();
    });

    it.each(['queue', 'deque', 'stack', 'heap'])('does not scan scalar records appended to %s', kind => {
        const runtime = new Interpreter();
        runtime.execute(`use algo\nValues = new ${kind}\nItem = record\n  .priority = 1\n  .payload = 2\nend`);
        runtime.execute('fun Q V note\n  Q push V\n  return Q\nend');
        const value = runtime.variables.get('Values')!;
        if (!(value instanceof RankDeque || value instanceof RankHeap)) throw new Error('expected container');
        const reads = vi.spyOn(value, 'values');
        for (let index = 0; index < 100; index++) {
            runtime.execute(kind === 'heap' ? 'Values 1 Item enqueue' : 'Values Item note');
        }
        expect(value.size).toBe(100);
        expect(reads).not.toHaveBeenCalled();
        runtime.dispose();
    });

    it('invalidates parent proofs when an aliased nested container receives a file', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { io });
        expect(runtime.execute(`
use io
use algo
fun Path build
  Child = new queue
  Parent = new queue
  Parent push Child
  Child push Path open
  return Parent
end
Outer = "/input" build
Inner = Outer peek
File = Inner peek
File size
`)).toBe(4n);
        expect(io.handles[0].closed).toBe(true);
        runtime.dispose();
    });

    it('tracks JS writes to record and index maps, including cyclic parents', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const runtime = new Interpreter(undefined, { persistentResources: true });
        runtime.execute('fun A identity\n  return A\nend\nItem = record\n  .value = 0\nend');
        const item = runtime.variables.get('Item')!;
        const index = newStructure('index');
        if (!isRankIndex(index) || !isRankRecord(item)) throw new Error('expected maps');
        index.entries.set('self', index);
        index.entries.set('item', item);
        expect(isKnownFileFree(index)).toBe(true);
        item.entries.set('value', file);
        expect(isKnownFileFree(index)).toBe(false);
        const fn = runtime.variables.get('identity')!;
        if (!isNativeFunction(fn)) throw new Error('expected function');
        expect(fn.call([index])).toBe(index);
        expect(file.closed).toBe(false);
        runtime.dispose();
        expect(file.closed).toBe(true);
    });

    it('never caches a proof for an untracked mutable array', () => {
        const queue = new RankDeque();
        const input = { kind: 'array' as const, shape: [1], items: [0n] };
        queue.push(input);
        expect(isKnownFileFree(queue)).toBe(false);
    });

    it('still closes local files when returning a proven file-free container', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { io, persistentResources: true });
        runtime.execute(`
use io
use algo
fun Path build
  File = Path open
  Q = new queue
  Q push 7
  return Q
end
Q = "/input" build
`);
        expect(io.handles[0].closed).toBe(true);
        expect(isKnownFileFree(runtime.variables.get('Q'))).toBe(true);
        runtime.dispose();
    });

    it('invalidates cross-interpreter proofs and preserves imported file results', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, {
            io,
            loadModule: () => ({ id: 'helper.ra', source: `
use io
use algo
fun Queue Path append_file
  Queue push Path open
  return Queue
end
` }),
        });
        expect(runtime.execute(`
use io
use algo
use "helper" as Helper
Q = new queue
Q "/input" Helper.append_file
(Q peek) size
`)).toBe(4n);
        expect(io.handles[0].closed).toBe(true);
        runtime.dispose();
    });

    it('retains unknown lazy readers and closes files discovered while reading them', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { persistentResources: true });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        let reads = 0;
        const queue = new RankDeque();
        queue.push({ kind: 'array', shape: [1], get items() { reads++; return [file]; } });
        runtime.variables.set('Q', queue);
        runtime.execute('fun A identity\n  return A\nend\nQ identity');
        expect(reads).toBeGreaterThan(0);
        expect(file.closed).toBe(false);
        runtime.dispose();
        expect(file.closed).toBe(true);
    });
});
