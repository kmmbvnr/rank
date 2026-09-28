import { expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

it.each([true, false])('enforces return contracts with compilation %s', compiled => {
    for (const [returned, kind] of [['"text"', 'ReturnRankMismatch'], ['array 1', 'ReturnRankMismatch'],
        ['true', 'ReturnTypeMismatch']] as const) {
        const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: compiled,
            functionBodyCompilation: compiled, scalarEntryCompilation: compiled });
        expect(() => runtime.execute(`fun pick X\n if X equal 0\n return 1\n end\n return ${returned}\nend\n0 pick\n1 pick`))
            .toThrowError(expect.objectContaining({ rankKind: kind }));
    }
});

it('specializes independently for scalar, vector and matrix inputs', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('use sequences\nfun identity X\n return X\nend\n1 identity\n(array 1 2) identity\n((array 1 2 3 4) (array 2 2) reshape) identity');
    expect(formatValue(runtime.execute('(array 3 4 5) identity')!)).toBe('3 4 5');
});

it('checks a tail-called specialization even when its caller is new', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('fun pick X\n if X equal 0\n return 1\n end\n return true\nend\n0 pick\nfun forward X\n return X pick\nend');
    expect(() => runtime.execute('1 forward')).toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
});

it('rejects element type changes while allowing empty and differently sized arrays', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('fun pick X\n if X equal 0\n return array 1 2\n end\n return array "x"\nend\n0 pick');
    expect(() => runtime.execute('1 pick')).toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
});

it('keeps closure instances and newly defined functions independent', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('fun outer X\n fun value\n return X\n end\n return value\nend');
    // Local declarations are recreated on each invocation.
    expect(runtime.execute('1 outer')).toBe(1n);
    expect(runtime.execute('true outer')).toBe(true);
    runtime.execute('fun value X\n return 1\nend\n0 value');
    expect(runtime.execute('fun value X\n return true\nend\n0 value')).toBe(true);
});
it('checks memoized functions and preserves successful cache entries after failure', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('memo pick X\n if X equal 0\n return 1\n end\n return true\nend\n0 pick');
    expect(() => runtime.execute('1 pick')).toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
    expect(runtime.execute('0 pick')).toBe(1n);
    expect(() => runtime.execute('1 pick')).toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
});
it('allows rank-changing recursion to use distinct argument specializations', () => {
    const runtime = new Interpreter(() => {});
    expect(runtime.execute('fun scalar X\n if X is .array\n return (X 0) scalar\n end\n return X\nend\n(array 7) scalar')).toBe(7n);
});
it('reuses a prepared body for equal input ranks with different lengths', () => {
    let compiled = 0;
    const runtime = new Interpreter(() => {}, { onFunctionBodyCompiled: () => compiled++ });
    runtime.execute('fun identity X\n Y = X\n return Y\nend\n(array 1) identity\n(array 1 2) identity');
    expect(compiled).toBe(1);
    runtime.execute('(array 1 2 3 4 shape 2 2) identity');
    expect(compiled).toBe(2);
    runtime.execute('(array 1 2 3) identity');
    expect(compiled).toBe(2);
});
it('allows empty results and changes of axis lengths within one rank', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('fun sized N\n return array shape N fill 1\nend\n0 sized\n1 sized');
    expect(formatValue(runtime.execute('3 sized')!)).toBe('1 1 1');
});
it('defers lazy element validation until a consumer reads the result', () => {
    const runtime = new Interpreter(() => {});
    let reads = 0;
    runtime.variables.set('Lazy', { kind: 'array', shape: [1], items: [], containsFiles: false,
        itemAt: () => { reads++; return 'wrong'; } });
    runtime.execute('fun pick Flag\n if Flag\n return array 1\n end\n return Lazy\nend\ntrue pick');
    runtime.execute('Result = false pick');
    const result = runtime.variables.get('Result')!;
    expect(reads).toBe(0);
    expect(() => formatValue(result)).toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
    expect(reads).toBe(1);
});
it('does not use an empty argument to create a different return-rank contract', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('fun pick X\n if (X len) equal 0\n return 0\n end\n return X\nend\n(array shape 0 fill 1) pick');
    expect(() => runtime.execute('(array 1 2) pick')).toThrowError(expect.objectContaining({ rankKind: 'ReturnRankMismatch' }));
});
it('normalizes both vectors and matrices with the same function', () => {
    const runtime = new Interpreter(() => {});
    runtime.execute('use numbers\nfun normalize V\n Min = V min\n Max = V max\n return (V - Min) / (Max - Min)\nend\nVector = (array 2 4) normalize\nMatrix = (array 2 4 6 8 shape 2 2) normalize');
    expect(runtime.variables.get('Vector')).toMatchObject({ shape: [2], items: [0, 1] });
    expect(runtime.variables.get('Matrix')).toMatchObject({ shape: [2, 2], items: [0, 1 / 3, 2 / 3, 1] });
});
