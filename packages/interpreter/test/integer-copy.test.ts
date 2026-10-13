import { expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, isRankArray, type RankValue } from '../src/index.js';

it('copies a selected integer view into independent writable storage', () => {
    const runtime = new Interpreter();
    runtime.execute(`use sequences
M = (array 1 2 3 4 5 6) reshape 3 2
M = M copy
P = M (array 2 0 2)
C = P copy
C 0 0 = 99`);
    expect(runtime.execute('C 0 0')).toBe(99n);
    expect(runtime.execute('P 0 0')).toBe(5n);
    expect(runtime.execute('M 2 0')).toBe(5n);
    expect(runtime.execute('C 2 0')).toBe(5n);
});

it('does not bypass host readers or force their items getter', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    const reads: number[] = [];
    runtime.variables.set('Host', { kind: 'array', shape: [3], get items(): RankValue[] { throw Error('forced'); },
        itemAt: i => { reads.push(i); return BigInt(i); } });
    runtime.execute('C = Host copy');
    expect(reads).toEqual([0, 1, 2]);
    const copied = runtime.variables.get('C')!;
    expect(isRankArray(copied) && copied.items).toEqual([0n, 1n, 2n]);
});

it('retains late failures in a lazy integer-looking input', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    const reads: number[] = [];
    runtime.variables.set('Host', { kind: 'array', shape: [3], items: [], itemAt: i => {
        reads.push(i);
        if (i === 2) throw Error('late failure');
        return BigInt(i);
    } });
    expect(() => runtime.execute('Host copy')).toThrow('late failure');
    expect(reads).toEqual([0, 1, 2]);
});

it('rechecks an escaped snapshot instead of trusting a stale integer proof', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    const source = createArraySnapshot([1n, 2n]);
    runtime.variables.set('Input', source);
    runtime.execute('First = Input copy');
    source.items[1] = 'bad';
    expect(() => runtime.execute('Second = Input copy')).toThrow();
});
