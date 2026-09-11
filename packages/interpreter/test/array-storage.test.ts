import { describe, expect, it, vi } from 'vitest';
import { Interpreter, createArraySnapshot, isNativeFunction, isRankQueue, type RankArray, type RankValue } from '../src/index.js';
import { privateArrayStorage } from '../src/array-storage.js';
import { MemoryIo } from './support.js';
import { native } from '../src/modules/shared.js';

const plain = (items: RankValue[]): RankArray => ({ kind: 'array', shape: [items.length], items, containsFiles: false });
function runtime() {
    const instance = new Interpreter();
    instance.execute(`fun fused A
  return (A * 2) + reduce
end
fun ordinary A
  T = A * 2
  return T + reduce
end`);
    return instance;
}
function call(instance: Interpreter, name: string, input: RankValue) {
    const fn = instance.variables.get(name);
    if (!fn || !isNativeFunction(fn)) throw new Error(name);
    return fn.call([input]);
}

describe('private array storage', () => {
    it('preserves large real, boolean, integer and mixed snapshots through exposure', () => {
        const real = createArraySnapshot(Array.from({ length: 256 }, (_, i) => i === 0 ? -0 : i / 4));
        const bool = createArraySnapshot(Array.from({ length: 256 }, (_, i) => i % 2 === 0));
        expect(Object.is(privateArrayStorage(real)!.read(0), -0)).toBe(true);
        expect(privateArrayStorage(bool)!.read(0)).toBe(true);
        expect(privateArrayStorage(bool)!.read(1)).toBe(false);
        expect(createArraySnapshot([1, 2]).items).toEqual([1, 2]);
        expect(createArraySnapshot(Array(256).fill(2n ** 100n)).items).toEqual(Array(256).fill(2n ** 100n));
        const mixed = Array.from({ length: 256 }, (_, i) => i % 2 ? i : BigInt(i));
        expect(createArraySnapshot(mixed).items).toEqual(mixed);
        real.items[0] = 2n ** 100n;
        bool.items[0] = 'mutable';
        expect(real.items[0]).toBe(2n ** 100n);
        expect(bool.items[0]).toBe('mutable');
        expect(privateArrayStorage(real)).toBeUndefined();
        expect(privateArrayStorage(bool)).toBeUndefined();
    });

    it('rejects unknown and wrapped objects without invoking proxy traps', () => {
        const traps: string[] = [];
        const proxy = (value: RankArray) => new Proxy(value, {
            get(target, key, receiver) { traps.push(`get ${String(key)}`); return Reflect.get(target, key, receiver); },
            has(target, key) { traps.push(`has ${String(key)}`); return Reflect.has(target, key); },
            getOwnPropertyDescriptor(target, key) { traps.push(`descriptor ${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
        });
        expect(privateArrayStorage(proxy(plain([1n])))).toBeUndefined();
        expect(privateArrayStorage(proxy(createArraySnapshot([1n])))).toBeUndefined();
        expect(traps).toEqual([]);
    });

    it('repairs the existing inline reduction descriptor-probe regression', () => {
        const instance = runtime();
        let probes = 0;
        const input = () => new Proxy(plain([1n]), {
            getOwnPropertyDescriptor(target, key) {
                if (key === 'items') { probes++; target.items[0] = 100n; }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        expect(call(instance, 'ordinary', input())).toBe(2n);
        expect(call(instance, 'fused', input())).toBe(2n);
        expect(probes).toBe(0);
        instance.dispose();
    });

    it('fuses private numeric snapshots but not mutable public item storage', () => {
        const instance = runtime();
        const reduce = vi.spyOn(instance as unknown as { reduceCell(operator: string, value: RankValue): RankValue }, 'reduceCell');
        const input = createArraySnapshot([1n, 2n]);
        expect(privateArrayStorage(input)).toBeDefined();
        expect(call(instance, 'fused', input)).toBe(6n);
        expect(reduce).not.toHaveBeenCalled();
        input.items[0] = 10n;
        expect(privateArrayStorage(input)).toBeUndefined();
        expect(call(instance, 'fused', input)).toBe(24n);
        expect(reduce).toHaveBeenCalledOnce();
        instance.dispose();
    });

    it('copies host input and keeps BigInt, signed zero and boolean values exact', () => {
        const values = [2n ** 100n, -0, NaN, true];
        const input = createArraySnapshot(values, [2, 2]);
        values[0] = 0n;
        expect(privateArrayStorage(input)!.read(0)).toBe(2n ** 100n);
        expect(Object.is(privateArrayStorage(input)!.read(1), -0)).toBe(true);
        expect(input.items).toEqual([2n ** 100n, -0, NaN, true]);
        expect(() => createArraySnapshot([1n], [2])).toThrow('shape');
        expect(() => createArraySnapshot([], [-1])).toThrow('shape');
    });

    it('rejects changed descriptors without executing their getters', () => {
        for (const property of ['items', 'shape', 'kind', 'itemAt']) {
            const input = createArraySnapshot([1n]);
            Object.defineProperty(input, property, { get() { throw new Error('unexpected getter'); } });
            expect(privateArrayStorage(input)).toBeUndefined();
        }
        const input = createArraySnapshot([1n]);
        Object.defineProperty(input.shape, 0, { get() { throw new Error('shape getter'); } });
        expect(privateArrayStorage(input)).toBeUndefined();
    });

    it('leaves mixed object arrays ordinary and clears file-free status on exposure', () => {
        const input = createArraySnapshot([1n]);
        expect(input.containsFiles).toBe(false);
        void input.items;
        expect(input.containsFiles).toBeUndefined();
        expect(privateArrayStorage(createArraySnapshot([plain([1n])]))).toBeUndefined();
    });

    it('preserves replacement of public items and notices later accessors', () => {
        const instance = runtime();
        const input = createArraySnapshot([1n]);
        (input as { items: RankValue[] }).items = [3n];
        expect(call(instance, 'fused', input)).toBe(6n);
        expect(privateArrayStorage(input)).toBeUndefined();
        Object.defineProperty(input.items, 0, { get: () => 4n });
        expect(call(instance, 'fused', input)).toBe(8n);
        instance.dispose();
    });

    it('keeps sealed getters and proxy-wrapped snapshots readable', () => {
        const instance = runtime();
        const sealed = Object.seal(createArraySnapshot([2n, 3n]));
        const getter = Object.getOwnPropertyDescriptor(sealed, 'items')!.get;
        expect(sealed.items).toEqual([2n, 3n]);
        expect(Object.getOwnPropertyDescriptor(sealed, 'items')!.get).toBe(getter);
        sealed.items[0] = 4n;
        expect(call(instance, 'fused', sealed)).toBe(14n);
        const wrapped = new Proxy(createArraySnapshot([5n]), {});
        expect(call(instance, 'fused', wrapped)).toBe(10n);
        wrapped.items[0] = 6n;
        expect(call(instance, 'fused', wrapped)).toBe(12n);
        instance.dispose();
    });

    it('creates private storage for Rank literals and observes Rank writes through aliases', () => {
        const instance = runtime();
        instance.execute('A = array 1 2\nB = A');
        const a = instance.variables.get('A')!;
        expect(privateArrayStorage(a)).toBeDefined();
        expect(call(instance, 'fused', a)).toBe(6n);
        instance.execute('B 0 = 10');
        expect(call(instance, 'fused', a)).toBe(24n);
        expect(privateArrayStorage(a)).toBeUndefined();
        instance.dispose();
    });

    it('retains a file inserted into a numeric array before closing its scope', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const instance = new Interpreter(undefined, { io });
        expect(instance.execute(`use io
fun build Path
  A = array 0
  A 0 = Path open
  return A
end
A = "/input" build
File = A 0
File size`)).toBe(4n);
        expect(io.handles[0].closed).toBe(true);
        instance.dispose();
    });

    it('revalidates source storage after each loop body', () => {
        const instance = new Interpreter();
        const input = createArraySnapshot([1n, 2n], [2, 1]);
        instance.variables.set('Input', input);
        instance.variables.set('poke', native('poke', 1, () => {
            Object.defineProperty(input, 'items', { get: () => [10n, 20n] });
            return 0n;
        }));
        instance.execute(`use algo
fun collect A
  for Row in A
    queue push Row 0
    Row poke
  end
  return queue
end`);
        const result = call(instance, 'collect', input);
        if (!isRankQueue(result)) throw new Error('expected queue');
        expect(result.items).toEqual([1n, 20n]);
        instance.dispose();
    });

    it('keeps foreign items getters before the shape read used for offsets', () => {
        const instance = new Interpreter();
        const reads: string[] = [];
        const input: RankArray = {
            kind: 'array', containsFiles: false,
            get shape() { reads.push('shape'); return [1, 1]; },
            get items() { reads.push('items'); return [7n]; },
        };
        instance.execute(`use algo
fun collect A
  for Row in A
    queue push Row 0
  end
  return queue
end`);
        call(instance, 'collect', input);
        const firstItem = reads.indexOf('items');
        expect(firstItem).toBeGreaterThanOrEqual(0);
        expect(reads[firstItem + 1]).toBe('shape');
        instance.dispose();
    });

    it('preserves the shared cell shape when a loop body changes it', () => {
        const instance = new Interpreter();
        instance.variables.set('shorten', native('shorten', 1, ([row]) => {
            (row as unknown as { shape: number[] }).shape[0] = 1;
            return 0n;
        }));
        const result = instance.execute(`use algo
use sequences
A = array shape 2 3
  1 2 3 4 5 6
end
for Row in A
  queue push Row len
  Row shorten
end
queue`);
        if (!result || !isRankQueue(result)) throw new Error('expected queue');
        expect(result.items).toEqual([3n, 1n]);
        instance.dispose();
    });

    it('does not add reads of a getter installed on the shared cell shape', () => {
        const instance = new Interpreter();
        let reads = 0;
        instance.variables.set('shorten', native('shorten', 1, ([row]) => {
            Object.defineProperty((row as RankArray).shape, 0, {
                get() { reads++; return 1; }, configurable: true,
            });
            return 0n;
        }));
        const result = instance.execute(`use algo
use sequences
A = array shape 2 3
  1 2 3 4 5 6
end
for Row in A
  queue push Row len
  Row shorten
end
queue`);
        if (!result || !isRankQueue(result)) throw new Error('expected queue');
        expect(result.items).toEqual([3n, 1n]);
        // Size once, coordinate calculation twice, len once, as before fusion.
        expect(reads).toBe(4);
        instance.dispose();
    });

    it('keeps coordinate mapping if a host callback changes cell rank', () => {
        const instance = new Interpreter();
        instance.variables.set('reshape', native('reshape', 1, ([row]) => {
            (row as unknown as { shape: number[] }).shape.splice(0, 1, 1, 3);
            return 0n;
        }));
        const result = instance.execute(`use algo
use numbers
A = array shape 2 3
  1 2 3 4 5 6
end
for Row in A
  queue push Row sum
  Row reshape
end
queue`);
        if (!result || !isRankQueue(result)) throw new Error('expected queue');
        expect(result.items).toEqual([6n, 12n]);
        instance.dispose();
    });
});
