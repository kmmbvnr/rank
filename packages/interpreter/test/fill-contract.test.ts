import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { type RankArray } from '../src/value.js';
import { argumentSignature } from '../src/return-contract.js';

for (const compiled of [true, false]) describe(`fill contracts (compiled ${compiled})`, () => {
    const runtime = () => new Interpreter(() => {}, { integerLoopCompilation: compiled, scalarCompilation: compiled,
        tensorCellCompilation: compiled });
    it.each([['0', '1', '"bad"'], ['0.0', '1.0', '1'], ['""', '"ok"', '1']])
    ('retains %s cells with no stored values', (fill, good, bad) => {
        const r = runtime();
        r.execute(`A = array shape 0 fill ${fill}`);
        expect(() => r.execute(`A = array shape 0 fill ${bad}`)).toThrow(/array elements/);
        r.execute(`A = array ${good}`);
        expect(() => r.execute(`A = array ${bad}`)).toThrow(/array elements/);
    });
    it('preserves recursive fill types through empty copies and record fields', () => {
        const r = runtime();
        r.execute('use sequences\nA = array shape 0 fill (array 1)\nB = A copy\nR = record\n .items = A\nend');
        expect(() => r.execute('B = array shape 0 fill (array "x")')).toThrow(/array elements/);
        expect(() => r.execute('R .items = array shape 0 fill (array "x")')).toThrow();
    });
    it('leaves missing and numeric infinity seeds open', () => {
        const r = runtime();
        r.execute('use numbers\nA = array shape 0 fill .NA\nA = array "x"\nB = array shape 0 fill infinity\nB = array 1');
        expect(() => r.execute('B = array 1.0')).toThrow(/array elements/);
    });
    it('retains filled empty result contracts in either call order', () => {
        for (const first of ['true', 'false']) {
            const r = runtime();
            r.execute('fun result Flag\n if Flag\n return array shape 0 fill 0\n end\n return array "x"\nend');
            r.execute(`${first} result`);
            expect(() => r.execute(`${first === 'true' ? 'false' : 'true'} result`)).toThrow();
        }
    });
    it('uses the same specialization for empty and nonempty integer fills', () => {
        const r = runtime();
        const empty = r.execute('array shape 0 fill 0')!;
        const nonempty = r.execute('array 1')!;
        expect(argumentSignature([empty])).toBe(argumentSignature([nonempty]));
    });
});


it('evaluates an empty fill once without reading a nested lazy prototype', () => {
    const r = new Interpreter();
    let reads = 0;
    r.variables.set('Lazy', { kind: 'array', shape: [1], items: [], containsFiles: false, itemAt: () => { reads++; return 1n; } } as RankArray);
    r.execute('State = record\n .count = 0\nend\nfun seed\n State .count += 1\n return Lazy\nend\nA = array shape 0 fill seed');
    expect(r.execute('State .count')).toBe(1n);
    expect(reads).toBe(0);
});

it.each(['(tuple 1 "x")', '(record\n .x = 1\nend)'])('retains recursive positional and field types: %s', fill => {
    const r = new Interpreter();
    r.execute(`A = array shape 0 fill ${fill}`);
    const bad = fill.includes('tuple') ? '(tuple 1 2)' : '(record\n .x = "x"\nend)';
    expect(() => r.execute(`A = array shape 0 fill ${bad}`)).toThrow(/array elements/);
});
