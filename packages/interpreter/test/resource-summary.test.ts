import { describe, expect, it, vi } from 'vitest';
import { Interpreter, isNativeFunction, isRankIndex, isRankRecord, type RankFile } from '../src/index.js';
import { newStructure } from '../src/collections.js';
import { RankDeque, RankHeap } from '../src/containers.js';
import { isKnownFileFree } from '../src/resource-summary.js';
import { MemoryIo } from './support.js';

describe('container resource summaries', () => {
    it.each(['index', 'set', 'counter'])('does not walk a growing numeric %s on return', kind => {
        const runtime = new Interpreter();
        runtime.execute(`use algo\nfun identity A\n  return A\nend\nValues = new ${kind}`);
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
        runtime.execute('fun note Q V\n  Q push V\n  return Q\nend');
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
fun build Path
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
        runtime.execute('fun identity A\n  return A\nend\nItem = record\n  .value = 0\nend');
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

    it('invalidates cross-interpreter proofs and preserves imported file results', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, {
            io,
            loadModule: () => ({ id: 'helper.ra', source: `
use io
use algo
fun fill Queue Path
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
Q "/input" Helper.fill
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
        runtime.execute('fun identity A\n  return A\nend\nQ identity');
        expect(reads).toBeGreaterThan(0);
        expect(file.closed).toBe(false);
        runtime.dispose();
        expect(file.closed).toBe(true);
    });
});
