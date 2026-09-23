import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction } from '../src/index.js';
import { arrayForWrite, isFlatScalarArray, noteArrayBinding, ownedArray } from '../src/array-storage.js';

function demo(runtime: Interpreter, path: string, name: string) {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    runtime.execute(source.slice(source.indexOf(`fun ${name}`)));
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
            const stats = new RuntimeDiagnostics();
            stats.run(() => {
                const values = input(1n);
                expect(max.call([values])).toBe(64n);
                const writable = arrayForWrite(values) ?? values;
                writable.items[0] = 9n;
                expect(writable).toBe(values);

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

it('rechecks builtin identity before borrowing after a redefinition', () => {
    const runtime = new Interpreter();
    try {
        const max = demo(runtime, 'demos/cses/sortnsrch/008_maxsubarray.ra', 'max_subarray');
        const first = input(1n);
        expect(max.call([first])).toBe(64n);
        runtime.execute('fun max X Y\n return X\nend');
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

it('falls back when len is redefined after a previously borrowed call', () => {
    const runtime = new Interpreter();
    try {
        const max = demo(runtime, 'demos/cses/sortnsrch/008_maxsubarray.ra', 'max_subarray');
        expect(max.call([input(1n)])).toBe(64n);
        runtime.execute('fun len X\n return 64\nend');
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
        runtime.execute('fun read X\n return X 0\nend\nfun outer A\n return A read\nend');
        const outer = runtime.variables.get('outer');
        if (!outer || !isNativeFunction(outer)) throw new Error('missing outer');
        const first = input(1n);
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            expect(outer.call([first])).toBe(1n);
            expect(arrayForWrite(first) ?? first).toBe(first);
        });
        expect(stats.cowCopies).toBe(0);

        runtime.execute('fun read X\n return X\nend');
        const next = input(2n);
        stats.run(() => {
            expect(outer.call([next])).toBe(next);
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
        runtime.execute('fun leak X\n return X\nend');
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
        runtime.execute('fun closure X\n fun nested\n  return X\n end\n return X 0\nend\n'
            + 'fun generated X\n yield X\nend\n'
            + 'fun container X\n Saved = array X\n return X 0\nend');
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
