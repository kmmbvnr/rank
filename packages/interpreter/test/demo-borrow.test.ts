import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction, isRankArray } from '../src/index.js';
import { arrayForWrite, isFlatScalarArray, noteArrayBinding, ownedArray } from '../src/array-storage.js';

function demo(runtime: Interpreter, path: string, name: string) {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    runtime.execute(source.slice(source.search(new RegExp(`\\bfun (?:[A-Z]\\w*[ \t]+)*${name}\\b`))));
    const function_ = runtime.variables.get(name);
    if (!function_ || !isNativeFunction(function_)) throw new Error(`missing ${name}`);
    return function_;
}

function input(value: bigint, size = 64) {
    const array = ownedArray(Array(size).fill(value));
    noteArrayBinding(array);
    return array;
}

it('borrows the unchanged scalar-reader demos without copying their inputs on a later write', () => {
    for (const integerLoopCompilation of [false, true]) {
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            const max = demo(runtime, 'demos/cses/sortnsrch/008_maxsubarray.ra', 'max_subarray');
            const vacation = demo(runtime, 'demos/atcoder/edpc/03_vacation.ra', 'best_score');
            // Element iteration is outside the borrow proof, so a later write may copy.
            const values = input(1n);
            expect(max.call([values])).toBe(64n);
            const writable = arrayForWrite(values) ?? values;
            writable.items[0] = 9n;
            expect(max.call([writable])).toBe(72n);

            const stats = new RuntimeDiagnostics();
            stats.run(() => {
                const arrays = [input(1n), input(2n), input(3n)];
                expect(vacation.call(arrays)).toBe(160n);
                const identities: boolean[] = [];
                for (const array of arrays) {
                    const writable = arrayForWrite(array) ?? array;
                    writable.items[0] = 9n;
                    identities.push(writable === array);
                }
                expect(identities).toEqual([true, true, true]);
            });
            expect(stats.cowCopies).toBe(0);
        } finally { runtime.dispose(); }
    }
});

it('rechecks builtin identity before borrowing after a host replacement', () => {
    const runtime = new Interpreter();
    try {
        const max = demo(runtime, 'demos/cses/sortnsrch/008_maxsubarray.ra', 'max_subarray');
        const first = input(1n);
        expect(max.call([first])).toBe(64n);
        runtime.execute('fun X Y hostreplacement\n return X\nend');
        runtime.variables.set('max', runtime.variables.get('hostreplacement')!);
        const next = input(1n);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(max.call([next])).toBe(1n);
            const writable = arrayForWrite(next) ?? next;
            writable.items[0] = 9n;
            expect(writable).not.toBe(next);
            expect(next.items[0]).toBe(1n);
        });
        expect(stats.cowCopies).toBe(1);
    } finally { runtime.dispose(); }
});

it('falls back when the host replaces len after a previously borrowed call', () => {
    const runtime = new Interpreter();
    try {
        const max = demo(runtime, 'demos/cses/sortnsrch/008_maxsubarray.ra', 'max_subarray');
        expect(max.call([input(1n)])).toBe(64n);
        runtime.execute('fun X hostreplacement\n return 64\nend');
        runtime.variables.set('len', runtime.variables.get('hostreplacement')!);
        const values = input(1n);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(max.call([values])).toBe(64n);
            expect(arrayForWrite(values)).not.toBe(values);
        });
        expect(stats.cowCopies).toBe(1);
    } finally { runtime.dispose(); }
});

it('invalidates a cached reader-helper proof when that helper starts returning the input', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute('fun X read\n return X 0\nend\nfun A outer\n return A read\nend');
        const outer = runtime.variables.get('outer');
        if (!outer || !isNativeFunction(outer)) throw new Error('missing outer');
        const first = input(1n);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(outer.call([first])).toBe(1n);
            expect(arrayForWrite(first) ?? first).toBe(first);
        });
        expect(stats.cowCopies).toBe(0);

        runtime.forgetBindings(['read']);
        runtime.execute('fun X read\n return X\nend');
        const next = input(2n);
        stats.run(() => {
            expect(() => outer.call([next])).toThrow('outer returns rank 0 and cannot return rank 1');
            expect(arrayForWrite(next)).not.toBe(next);
        });
        expect(stats.cowCopies).toBe(1);
    } finally { runtime.dispose(); }
});

it('requires every other array read by the vacation function to be flat', () => {
    const runtime = new Interpreter();
    try {
        const vacation = demo(runtime, 'demos/atcoder/edpc/03_vacation.ra', 'best_score');
        const first = input(1n), third = input(3n);
        const middle = runtime.execute('(array shape 64 fill 2) * 1');
        if (middle === undefined) throw new Error('missing derived array');
        expect(isFlatScalarArray(middle)).toBe(false);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(vacation.call([first, middle, third])).toBe(160n);
            expect(arrayForWrite(first)).not.toBe(first);
            expect(arrayForWrite(third)).not.toBe(third);
        });
        expect(stats.cowCopies).toBe(2);
    } finally { runtime.dispose(); }
});

it('can borrow the same flat value in three read-only parameters', () => {
    const runtime = new Interpreter();
    try {
        const vacation = demo(runtime, 'demos/atcoder/edpc/03_vacation.ra', 'best_score');
        const values = input(1n);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(vacation.call([values, values, values])).toBe(64n);
            const writable = arrayForWrite(values) ?? values;
            expect(writable).toBe(values);
            writable.items[0] = 9n;
        });
        expect(stats.cowCopies).toBe(0);
    } finally { runtime.dispose(); }
});

it('does not borrow a returned array alias', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute('fun X leak\n return X\nend');
        const function_ = runtime.variables.get('leak');
        if (!function_ || !isNativeFunction(function_)) throw new Error('missing leak');
        const values = input(1n);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(function_.call([values])).toBe(values);
            expect(arrayForWrite(values)).not.toBe(values);
        });
        expect(stats.cowCopies).toBe(1);
    } finally { runtime.dispose(); }
});

it('keeps the ordinary copy path for closure capture, yielded input and container retention', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute('fun X closure\n fun nested\n  return X\n end\n return X 0\nend\n'
            + 'fun X generated\n yield X\nend\n'
            + 'fun X container\n Saved = array X\n return X 0\nend');
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            for (const name of ['closure', 'generated', 'container']) {
                const function_ = runtime.variables.get(name);
                if (!function_ || !isNativeFunction(function_)) throw new Error(`missing ${name}`);
                const values = input(1n);
                function_.call([values]);
                expect(arrayForWrite(values), name).not.toBe(values);
            }
        });
        expect(stats.cowCopies).toBe(3);
    } finally { runtime.dispose(); }
});

it.each([false, true])('borrows the unchanged queens safety reader (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        const source = readFileSync(new URL('../../../demos/classic/queens_iterative.ra', import.meta.url), 'utf8');
        runtime.execute('use numbers\n' + source.slice(source.indexOf('fun Board Row safe'), source.indexOf('\nfor Board in 8 queens')));
        const safe = runtime.variables.get('safe');
        if (!safe || !isNativeFunction(safe)) throw Error('missing safe');
        const board = ownedArray([0n, 2n, 4n]);
        noteArrayBinding(board);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(safe.call([board, 2n])).toBe(true);
            expect(arrayForWrite(board) ?? board).toBe(board);
            board.items[2] = 3n;
            expect(safe.call([board, 2n])).toBe(false);
        });
        expect(stats.cowCopies).toBe(0);

        // Replacing a previously guarded builtin must invalidate the proof.
        runtime.variables.set('abs', { kind: 'function', name: 'hostabs', arities: [1], monadicRank: 'all',
            call: values => { const n = values[0] as bigint; return n < 0n ? -n : n; } });
        const next = ownedArray([0n, 2n, 4n]);
        noteArrayBinding(next);
        stats.run(() => {
            expect(safe.call([next, 2n])).toBe(true);
            expect(arrayForWrite(next)).not.toBe(next);
        });
        expect(stats.cowCopies).toBe(1);
    } finally { runtime.dispose(); }
});

it.each([false, true])('keeps yielded queens boards independent without copying for safe calls (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    const stats = new RuntimeDiagnostics();
    try {
        const source = readFileSync(new URL('../../../demos/classic/queens_iterative.ra', import.meta.url), 'utf8')
            .split('\nfor Board in 8 queens')[0];
        const solutions = stats.run(() => runtime.execute(source + '\n4 queens array'));
        if (!solutions || !isRankArray(solutions)) throw Error('missing solutions');
        expect(solutions).toMatchObject({ shape: [2, 4] });
        expect(solutions.items).toEqual([1n, 3n, 0n, 2n, 2n, 0n, 3n, 1n]);
        expect(stats.cowCopies).toBe(0);
    } finally { runtime.dispose(); }
});
