import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { derivedArray, materializedArrayItems } from '../src/array-storage.js';

describe.each([false, true])('native array demand (compilation=%s)', compilation => {
    it('repeats host cell work until an ordinary binding retains the result', () => {
        const reads: number[] = [];
        const source = derivedArray([2], [], index => { reads.push(index); return BigInt(index + 1); });
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Native', source);
            runtime.execute("G' = Native");
            expect(runtime.execute('G sum')).toBe(3n);
            expect(runtime.execute('G sum')).toBe(3n);
            expect(reads).toEqual([0, 1, 0, 1]);
            expect(materializedArrayItems(source)).toBeUndefined();
            runtime.execute('Saved = G');
            expect(reads).toEqual([0, 1, 0, 1, 0, 1]);
            expect(runtime.execute('Saved sum')).toBe(3n);
            expect(runtime.execute('Saved sum')).toBe(3n);
            expect(reads).toEqual([0, 1, 0, 1, 0, 1]);
        } finally { runtime.dispose(); }
    });

    it('retries a failed completion from its beginning without publishing a partial binding', () => {
        const reads: number[] = [];
        let broken = true;
        const source = derivedArray([2], [], index => {
            reads.push(index);
            if (index === 1 && broken) throw Error('cell failure');
            return BigInt(index + 1);
        });
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Native', source);
            expect(() => runtime.execute('Saved = Native')).toThrow('cell failure');
            expect(runtime.variables.has('Saved')).toBe(false);
            broken = false;
            runtime.execute('Saved = Native');
            expect(reads).toEqual([0, 1, 0, 1]);
            expect(runtime.execute('Saved sum')).toBe(3n);
        } finally { runtime.dispose(); }
    });
});
