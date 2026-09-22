import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type InterpreterOptions } from '../src/index.js';

describe.each([true, false])('array binding rank (compiled=%s)', compiled => {
    const options: InterpreterOptions = { integerLoopCompilation: compiled, nativeLoopCompilation: compiled };
    it('constructs shaped arrays on one line with checked dimensions', () => {
        const runtime = new Interpreter(undefined, options);
        try {
            runtime.execute('M = array 1 2 3 4 shape 2 2');
            expect(runtime.variables.get('M')).toMatchObject({ shape: [2, 2], items: [1n, 2n, 3n, 4n] });
            expect(runtime.execute('M 1 0')).toBe(3n);
            runtime.execute('Rows = 1\nN = array -1 (2 + 3) shape Rows 2');
            expect(runtime.variables.get('N')).toMatchObject({ shape: [1, 2], items: [-1n, 5n] });
            expect(() => runtime.execute('Bad = array 1 2 3 shape 2 2')).toThrow('expects 4 elements, got 3');
            expect(() => runtime.execute('Bad = array 1 shape -1 1')).toThrow();
            runtime.execute('use sequences\nFunctions = array (shape)');
            expect(runtime.variables.get('Functions')).toMatchObject({ shape: [1] });
        } finally { runtime.dispose(); }
    });

    it.each([
        'use sequences\nA = array 1 2 3\nA = array 2 2 2 2 shape 2 2\nA = array shape 2 2\n 2 2\n 2 2\nend',
        'A = array 1 2 3\nA = array shape 2 2\n 2 2\n 2 2\nend',
        'A = array 1 2 3\nA = array shape 0 2 fill 0',
        'use sequences\nA = array 1 2 3 4\nA = A (array 2 2) reshape',
        'A = array 1 2\nA += array shape 2 2 fill 0',
        'A = array 1 2\nfor I in 1 to 2\n A = array shape 2 2 fill I\nend',
        'for I in 1 to 2\n A = array shape I fill 0\n A = array shape I I fill 0\nend',
        'fun check X\n X = array shape 2 2 fill 0\n return X\nend\n(array 1 2) check',
        'fun check N\n A = array 1 2\n for I in 1 to N\n  A = array shape 2 2 fill I\n end\n return A\nend\n2 check',
        'fun check N\n A = array 1 2\n fun change X\n  A = array shape 2 2 fill X\n  return A\n end\n return N change\nend\n2 check',
    ])('rejects axis changes: %s', source => {
        const runtime = new Interpreter(undefined, options);
        try {
            expect(() => runtime.execute(source)).toThrow('has rank 1 and cannot receive rank 2');
        } finally { runtime.dispose(); }
    });

    it('keeps the old value after failure and allows elastic dimensions', () => {
        const runtime = new Interpreter(undefined, options);
        try {
            runtime.execute('use sequences\nA = array 1 2\nA = array 3 4 5');
            expect(() => runtime.execute('A = array shape 2 2 fill 0')).toThrow('has rank 1');
            expect(formatValue(runtime.execute('A')!)).toBe('3 4 5');
            runtime.execute('M = array shape 2 2 fill 0\nM = array shape 3 4 fill 1');
            expect(formatValue(runtime.execute('M shape')!)).toBe('3 4');
            expect(() => runtime.execute('M = array 1 2')).toThrow('has rank 2 and cannot receive rank 1');
            expect(() => runtime.execute('A = 1')).toThrow('cannot receive integer');
        } finally { runtime.dispose(); }
    });

    it('resets local rank contracts for each function invocation', () => {
        const runtime = new Interpreter(undefined, options);
        try {
            runtime.execute('fun check X\n A = X\n for I in 1 to 3\n  A = X\n end\n return A\nend');
            runtime.execute('(array 1 2) check');
            runtime.execute('(array shape 2 2 fill 0) check');
            runtime.execute('(array 3 4) check');
        } finally { runtime.dispose(); }
    });
});

it.each([false, true])('keeps a cached assignment site checked across repeated writes (local=%s)', local => {
    const runtime = new Interpreter(undefined, { integerLoopCompilation: false });
    try {
        const loop = 'for I in 1 to 3\n A = I make\nend';
        const source = 'fun make N\n if N less 3\n  return array 1 2\n end\n return array 1 2 3 4 shape 2 2\nend\n'
            + (local ? `fun check N\n${loop}\n return A\nend\n3 check` : loop);
        expect(() => runtime.execute(source)).toThrow('A has rank 1 and cannot receive rank 2');
    } finally { runtime.dispose(); }
});

it('copies rank contracts into previews and forgets them for removed declarations', () => {
    const runtime = new Interpreter();
    runtime.execute('A = array 1 2');
    const preview = runtime.forkForPreview();
    try {
        expect(() => preview.execute('A = array shape 2 2 fill 0')).toThrow('has rank 1');
        runtime.forgetBindings(['A']);
        runtime.execute('A = array shape 2 2 fill 0');
        expect(runtime.bindingArrayRank('A')).toBe(2);
        expect(preview.bindingArrayRank('A')).toBe(1);
    } finally { preview.dispose(); runtime.dispose(); }
});
