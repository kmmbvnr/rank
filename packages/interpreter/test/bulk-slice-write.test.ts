import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { prepareStoredScalarView } from '../src/integer-view.js';

for (const compilation of [false, true]) describe(`bulk writes beside retained slices (${compilation})`, () => {
    const buffer = (runtime: Interpreter, name: string) => {
        const view = prepareStoredScalarView(runtime.variables.get(name)!, true)!;
        return (view.compact ?? view.items as BigInt64Array).buffer;
    };

    it('writes disjoint prefix and reverse-strided suffix ranges without copying', () => {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 0 till 10000 array\nS = A (100 till 200 array)');
            const original = buffer(runtime, 'A');
            diagnostics.run(() => runtime.execute(`A (0 till 100 array) = 7
A (299 to 200 by -3 array) += 2
A (300 till 400 array) = 1000 till 1100 array`));
            expect(buffer(runtime, 'A')).toBe(original);
            expect(diagnostics.cowCopiedCells).toBe(0);
            expect(runtime.execute('S sum')).toBe(14950n);
            expect(runtime.execute('A 99')).toBe(7n);
            expect(runtime.execute('A 200')).toBe(202n);
            expect(runtime.execute('A 201')).toBe(201n);
            expect(runtime.execute('A 399')).toBe(1099n);
        } finally { runtime.dispose(); }
    });

    it('detaches when a reversed range crosses a retained slice', () => {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 0 till 10000 array\nS = A (100 till 200 array)');
            const original = buffer(runtime, 'A');
            diagnostics.run(() => runtime.execute('A (220 to 180 by -2 array) = 9'));
            expect(buffer(runtime, 'A')).not.toBe(original);
            expect(diagnostics.cowCopies).toBe(1);
            expect(runtime.execute('S sum')).toBe(14950n);
            expect(runtime.execute('A 180')).toBe(9n);
            expect(runtime.execute('A 181')).toBe(181n);
        } finally { runtime.dispose(); }
    });

    it('protects whole-array aliases even when the range misses every slice', () => {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 0 till 10000 array\nS = A (100 till 200 array)\nAlias = A');
            diagnostics.run(() => runtime.execute('A (200 till 300 array) = 7'));
            expect(diagnostics.cowCopies).toBe(1);
            expect(runtime.execute('Alias 250')).toBe(250n);
            expect(runtime.execute('A 250')).toBe(7n);
            expect(runtime.execute('S sum')).toBe(14950n);
        } finally { runtime.dispose(); }
    });

    it('snapshots an overlapping RHS before writing a disjoint destination', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
A = 0 till 10000 array
S = A (100 till 200 array)
A (201 till 301 array) = A (200 till 300 array)`);
            expect(runtime.execute('A 201')).toBe(200n);
            expect(runtime.execute('A 202')).toBe(201n);
            expect(runtime.execute('A 300')).toBe(299n);
            expect(runtime.execute('S sum')).toBe(14950n);
        } finally { runtime.dispose(); }
    });

    it('widens disjoint writes without changing the old slice buffer', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
A = 0 till 10000 array
S = A (100 till 200 array)
A (200 till 203 array) = 2 ** 40
A (203 till 206 array) = 2 ** 80
A (100 till 103 array) = 7`);
            expect(runtime.execute('S sum')).toBe(14950n);
            expect(runtime.execute('A 202')).toBe(2n ** 40n);
            expect(runtime.execute('A 205')).toBe(2n ** 80n);
            expect(runtime.execute('A 100')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('leaves both values intact when RHS shape or division fails', () => {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 0 till 10000 array\nS = A (100 till 200 array)');
            const original = buffer(runtime, 'A');
            diagnostics.run(() => {
                expect(() => runtime.execute('A (200 till 203 array) = array 1 2')).toThrow(/shape/);
                expect(() => runtime.execute('A (200 till 203 array) = (array 1 2 3) // (array 1 0 1)')).toThrow();
            });
            expect(buffer(runtime, 'A')).toBe(original);
            expect(diagnostics.cowCopies).toBe(0);
            expect(runtime.execute('S sum')).toBe(14950n);
            expect(runtime.execute('A 201')).toBe(201n);
        } finally { runtime.dispose(); }
    });
});
