import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeValues, findOperation } from '@arrrank/language';
import { Interpreter, isRankArray, isRankSequence, parse, type RankValue } from '../src/index.js';
import { demandValue } from '../src/plan.js';
import { typedElementKind } from '../src/array-storage.js';

const math: [string, string, RankValue][] = [
    ['abs', '-1', 1n], ['sqrt', '1', 1], ['isqrt', '1', 1n],
    ['exp', '0', 1], ['log', '1', 0], ['sin', '0', 0], ['cos', '0', 1], ['tan', '0', 0],
    ['asin', '0', 0], ['acos', '1', 0], ['atan', '0', 0], ['sinh', '0', 0], ['cosh', '0', 1],
    ['tanh', '0', 0], ['asinh', '0', 0], ['acosh', '1', 0], ['atanh', '0', 0],
    ['floor', '0.5', 0n], ['ceil', '0.5', 1n],
];

for (const compilation of [false, true]) describe(`scalar mapping contracts (compilation=${compilation})`, () => {
    it.each(math)('agrees on %s cells, types and shapes through direct, ranked and higher-order calls', (name, input, expected) => {
        const operation = findOperation(name)!;
        expect(operation.monadicRank).toBe(0);
        expect(operation.mapsScalarCells).toBeUndefined();
        expect(operation.shape?.find(s => s.args.length === 1)).toEqual({ args: [[]], result: [] });
        let r = new Interpreter(undefined, { compilation });
        try {
            for (const shape of [[0, 3], [2, 2], [2, 1, 2]]) {
                for (const call of [`A ${name}`, `A ${name} rank 0`, 'A cast', `A apply cast`]) {
                    const source = `use numbers\nfun X apply f\n return X f\nend\ncast = ${name}\n`
                        + `A = array shape ${shape.join(' ')} fill ${input}\nR = ${call}`;
                    const facts = analyzeValues(parse(source)).bindings.get('R');
                    r.dispose();
                    r = new Interpreter(undefined, { compilation });
                    const value = r.execute(source + '\nR')!;
                    expect(isRankArray(value)).toBe(true);
                    if (!isRankArray(value)) continue;
                    expect(value.shape, call).toEqual(shape);
                    expect(value.items, call).toEqual(Array(shape.reduce((a, b) => a * b, 1)).fill(expected));
                    if (call === 'A apply cast') {
                        // Callback parameters remain unknown in static function analysis.
                        expect(facts?.types).toEqual([]);
                    } else {
                        expect(facts?.shape, call).toEqual(shape);
                        expect(facts?.elements, call).toContain(typeof expected === 'bigint' ? 'integer' : 'real');
                    }
                }
            }
            expect(() => r.execute(`(array 1 1 shape 1 2) ${name} rank 1`)).toThrow(/cell shape/);
        } finally { r.dispose(); }
    });

    it('preserves real conversion shapes and whole text in analysis and runtime', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            for (const [expression, shape, types] of [
                ['(array "1.5" "2.5" shape 1 2) real', [1, 2], ['array']],
                ['(array shape 0 3 fill 1) real', [0, 3], ['array']],
                ['"12.5" real', [], ['real']], ['"1203" real rank 0', [4], ['array']],
            ] as const) {
                const source = `R = ${expression}`;
                const facts = analyzeValues(parse(source)).bindings.get('R');
                expect(facts?.types).toEqual(types);
                expect(facts?.shape).toEqual(shape);
                const value = r.execute(expression)!;
                expect(isRankArray(value) ? value.shape : []).toEqual(shape);
            }
            const value = r.execute('(array shape 32 32 fill 2) real')!;
            if (!isRankArray(value)) throw Error('expected real array');
            expect(typedElementKind(value)).toBe('real');
            expect(value.items).toEqual(Array(1024).fill(2));
        } finally { r.dispose(); }
    });

    it('keeps sequence kind and defers errors until the requested cell', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            for (const call of ['real', 'integer', 'sin', 'sqrt', 'floor', 'ceil']) {
                const source = `use numbers\nValues' = 1 to #\nR' = Values ${call}`;
                const facts = analyzeValues(parse(source)).bindings.get('R');
                r.execute(source);
                expect(facts?.types).toEqual(['sequence']);
                const value = demandValue(r.variables.get('R')!);
                expect(isRankSequence(value)).toBe(true);
                if (!isRankSequence(value)) continue;
                expect(value.plan.size).toEqual({ kind: 'infinite' });
                expect(value.plan.iterate().next().value).toEqual(call === 'sin' ? Math.sin(1) : call === 'integer' || call === 'floor' || call === 'ceil' ? 1n : 1);
            }
            r.execute("use sequences\nBad' = (array 1.0 -1.0) log");
            expect(r.execute('Bad 0')).toBe(0);
            expect(() => r.execute('Bad 1')).toThrow(/outside its domain/);
            r.execute("Zero' = (array 1 0) // (array 1 0)\nRoots' = Zero sqrt");
            expect(r.execute('Roots 0')).toBe(1);
            expect(() => r.execute('Roots 1')).toThrow();
        } finally { r.dispose(); }
    });

    it('runs the k-means demo with direct real conversion', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            expect(() => r.execute(readFileSync(new URL('../../../demos/deepml/017_kmeans.ra', import.meta.url), 'utf8'))).not.toThrow();
        } finally { r.dispose(); }
    });
});
