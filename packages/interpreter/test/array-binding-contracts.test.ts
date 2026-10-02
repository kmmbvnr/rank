import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MISSING, type RankArray } from '../src/value.js';
import { LocalFrame } from '../src/frame.js';
import { ownedArray, readArrayItem, typedArray } from '../src/array-storage.js';

for (const compiled of [true, false]) describe(`array binding contracts (compiled ${compiled})`, () => {
    const runtime = () => new Interpreter(() => {}, { integerLoopCompilation: compiled, scalarCompilation: compiled,
        tensorCellCompilation: compiled });
    it.each(['A = array "x" "y"', 'A 0 = "x"', 'A # = "x"',
        'A (array 0 1) = array 3 "x"', 'A (array true true) = array 3 "x"', 'A 0 /= 2'])
    ('rejects %s without modifying the old value or its alias', write => {
        const r = runtime();
        r.execute('A = array 1 2\nAlias = A');
        const old = r.variables.get('A');
        expect(() => r.execute(write)).toThrowError(expect.objectContaining({ rankKind: 'TypeError' }));
        expect(r.variables.get('A')).toBe(old);
        expect(formatValue(r.variables.get('A')!)).toBe('1 2');
        expect(formatValue(r.variables.get('Alias')!)).toBe('1 2');
    });
    it('rejects mixed initialization and keeps the single established domain', () => {
        const r = runtime();
        expect(() => r.execute('A = array 1 "x"')).toThrow(/one element type/);
        r.execute('A = array 1 2\nA = array 2 3 4');
        expect(() => r.execute('A 0 = "y"')).toThrow(/array elements/);
        expect(formatValue(r.variables.get('A')!)).toBe('2 3 4');
    });
    it('keeps contracts through empty and missing replacements', () => {
        const r = runtime();
        r.execute('A = array shape 0 fill 0\nA = array .NA .NA\nA 0 = 1\nA 1 = .NA\nA = array shape 0 fill 0\nA = .NA');
        expect(() => r.execute('A = array "x"')).toThrow(/array elements/);
        r.execute('A = array 2 3 4');
        expect(formatValue(r.variables.get('A')!)).toBe('2 3 4');
    });
    it('distinguishes numeric domains, including infinity', () => {
        const r = runtime();
        r.execute('use numbers\nA = array infinity');
        r.execute('A 0 = 1');
        expect(() => r.execute('A 0 = 1.0')).toThrow(/array elements/);
        r.execute('A 0 = infinity\nA 0 = 2');
        expect(() => r.execute('B = array 1 2.0')).toThrow(/one element type/);
    });
    it('checks parameters and captured locals and resets contracts on each invocation', () => {
        const r = runtime();
        r.execute('fun replace A\n A = array "x"\n return A\nend');
        expect(() => r.execute('(array 1) replace')).toThrow(/array elements/);
        expect(formatValue(r.execute('(array "a") replace')!)).toBe('x');
        r.execute('fun outer X\n A = array 1\n fun mutate Y\n A 0 = "x"\n end\n X mutate\nend');
        expect(() => r.execute('0 outer')).toThrow(/array elements/);
    });
    it('keeps compiled selection writes within the established domain', () => {
        const r = runtime();
        r.execute('A = array 1 2 3\nfor I in 0 to 2\n A I += 1\nend');
        expect(formatValue(r.variables.get('A')!)).toBe('2 3 4');
        expect(() => r.execute('for I in 0 to 2\n A I = "x"\nend')).toThrow(/array elements/);
    });
    it('keeps text rank one and checks nested ranks and cells', () => {
        const r = runtime();
        r.execute('Text = "one"\nText = "two words"');
        // Host arrays retain nesting; Rank array literals normally form tensors.
        r.variables.set('Nested', ownedArray([ownedArray([1n], [1])], [1]));
        r.execute('A = Nested');
        r.variables.set('Other', ownedArray([ownedArray(['x', 'y'], [1, 2])], [1]));
        expect(() => r.execute('A = Other')).toThrow(/array elements/);
        expect(() => r.execute('A = array 1')).toThrow(/array elements/);
    });
});

it('validates lazy cells at observation without reading ahead', () => {
    const r = new Interpreter(() => {});
    let reads = 0;
    const lazy: RankArray = { kind: 'array', shape: [2], items: [],
        itemAt: i => { reads++; return i ? 'bad' : 1n; } };
    r.variables.set('Lazy', lazy);
    r.execute('A = array 1\nA = Lazy');
    expect(reads).toBe(0);
    const a = r.variables.get('A') as RankArray;
    expect(readArrayItem(a, 0)).toBe(1n);
    expect(() => readArrayItem(a, 1)).toThrow(/array elements/);
    expect(reads).toBe(2);
});

it('settles a homogeneous lazy domain at its first observation without reading ahead', () => {
    const frame = new LocalFrame(undefined);
    let reads = 0;
    const lazy: RankArray = { kind: 'array', shape: [2], items: [], itemAt: i => { reads++; return i ? 'x' : 1n; } };
    frame.define('A', lazy, new Set(['array']));
    const held = frame.get('A') as RankArray;
    expect(reads).toBe(0);
    expect(readArrayItem(held, 0)).toBe(1n);
    expect(() => frame.set('A', ownedArray(['y']))).toThrow(/array elements/);
    expect(() => readArrayItem(held, 1)).toThrow(/array elements/);
    expect(reads).toBe(2);
    frame.set('A', ownedArray([2n, MISSING]));
    expect(() => frame.set('A', ownedArray([true]))).toThrow(/array elements/);
});

it('checks nested lazy arrays without observing their cells on assignment', () => {
    const frame = new LocalFrame(undefined);
    frame.define('A', ownedArray([ownedArray([1n])]), new Set(['array']));
    let reads = 0;
    const nested: RankArray = { kind: 'array', shape: [1], items: [], itemAt: () => { reads++; return 'bad'; } };
    frame.set('A', ownedArray([nested]));
    expect(reads).toBe(0);
    const inner = readArrayItem(frame.get('A') as RankArray, 0) as RankArray;
    expect(() => readArrayItem(inner, 0)).toThrow(/array elements/);
    expect(reads).toBe(1);
});

it('checks recursive record fields and preserves the old binding on failure', () => {
    const r = new Interpreter();
    r.execute('R = record\n .items = array 1 2\nend\nA = array R\nS = record\n .items = array "x"\nend');
    const old = r.variables.get('A');
    expect(() => r.execute('A = array S')).toThrow(/array elements/);
    expect(r.variables.get('A')).toBe(old);
});

it('copies frame contracts without sharing later empty-array refinements and resets locals', () => {
    const first = new LocalFrame(undefined);
    first.define('A', ownedArray([], [0]), new Set(['array']));
    const fork = new LocalFrame(undefined);
    fork.adoptContracts(first);
    first.set('A', ownedArray([1n]));
    fork.set('A', ownedArray(['x']));
    expect(() => first.set('A', ownedArray(['x']))).toThrow(/array elements/);
    expect(first.reset()).toBe(true);
    first.define('A', ownedArray(['x']), new Set(['array']));
});

it('keeps RHS effects but rejects an eager write before publishing any cell', () => {
    const r = new Interpreter();
    r.execute('State = record\n .count = 0\nend\nfun wrong X\n State .count += 1\n return "bad"\nend\nA = array 1 2');
    expect(() => r.execute('A # = 0 wrong')).toThrow(/array elements/);
    expect(formatValue(r.variables.get('A')!)).toBe('1 2');
    expect(r.execute('State .count')).toBe(1n);
});

it('keeps the homogeneous domain in independent aliases', () => {
    const r = new Interpreter();
    r.execute('A = array 1 2\nA = array 2 3\nB = A\nA 0 = 9');
    expect(() => r.execute('B 0 = "z"')).toThrow(/array elements/);
    expect(formatValue(r.variables.get('B')!)).toBe('2 3');
});

it('reports a deep nested mismatch without overflowing the host stack', () => {
    const frame = new LocalFrame(undefined);
    let original: import('../src/value.js').RankValue = 1n;
    let replacement: import('../src/value.js').RankValue = 'bad';
    for (let depth = 0; depth < 10000; depth++) {
        original = { kind: 'array', shape: [1], items: [original] };
        replacement = { kind: 'array', shape: [1], items: [replacement] };
    }
    frame.define('A', original, new Set(['array']));
    expect(() => frame.set('A', replacement)).toThrowError(expect.objectContaining({ rankKind: 'TypeError' }));
    expect(frame.get('A')).toBe(original);
});

it('does not establish a contract or reject a type for an empty selection', () => {
    const r = new Interpreter();
    r.execute('A = array .NA .NA\nA (array false false) = "unused"\nA 0 = 1');
    expect(() => r.execute('A 1 = "x"')).toThrow(/array elements/);
    r.execute('A (array false false) = "unused"');
});

it('keeps empty nested domains open until a populated replacement settles them', () => {
    const frame = new LocalFrame(undefined);
    const nested = (...items: import('../src/value.js').RankValue[]) => ownedArray([ownedArray(items)]);
    frame.define('A', nested(), new Set(['array']));
    frame.set('A', nested(1n, 2n));
    frame.set('A', nested());
    expect(() => frame.set('A', nested('bad'))).toThrow(/array elements/);
});

it('leaves empty typed storage unresolved just like other empty arrays', () => {
    for (const data of [new BigInt64Array(0), new Float64Array(0)]) {
        const frame = new LocalFrame(undefined);
        frame.define('A', typedArray(data), new Set(['array']));
        expect(() => frame.set('A', ownedArray(['x']))).not.toThrow();
        expect(() => frame.set('A', ownedArray([1n]))).toThrow(/array elements/);
    }
});
