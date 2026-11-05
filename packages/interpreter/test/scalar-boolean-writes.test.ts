import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { fillBooleanSelection, filledArray, readArrayItem, writeArrayCell } from '../src/array-storage.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`scalar boolean writes (${compilation})`, () => {
    it('preserves aliases, duplicate indices and errors without generated code', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = array shape 65 fill false\nSaved = A');
            diagnostics.run(() => runtime.execute('A (array 32 1 32 64) = true'));
            expect(diagnostics.bulkArrayWrites).toBeGreaterThan(0);
            expect(runtime.execute('A count')).toBe(3n);
            expect(runtime.execute('Saved count')).toBe(0n);
            expect(() => runtime.execute('A (array 0 65) = true')).toThrow(/bounds/);
            expect(runtime.execute('A 0')).toBe(false);
            expect(() => runtime.execute('A (array 0 1) = 7')).toThrow();
            expect(runtime.execute('A 0')).toBe(false);
            runtime.execute('A (0 till 0) = true');
            expect(runtime.execute('A count')).toBe(3n);
        } finally { runtime.dispose(); }
    });
});

it('pauses inside a fill and resumes after inspection unpacks the bitmap', () => {
    const runtime = new Interpreter(undefined, { compilation: false });
    runtime.execute('use sequences\nA = array shape 8192 fill false');
    const words = [0, 0, 0];
    let paused = false;
    const signal: InterruptSignal = {
        length: 3, load: index => words[index],
        store: (index, value) => { words[index] = value; },
        exchange(index, value) {
            const array = runtime.variables.get('A') as RankArray;
            if (!paused && readArrayItem(array, 0) === true && readArrayItem(array, 8191) === false) words[1] = 1;
            const previous = words[index];
            words[index] = value;
            return previous;
        },
        wait() { throw new Error('host must resume'); },
    };
    try {
        withInterrupt(signal, () => runtime.execute('A (0 till 8192) = true'), () => {
            paused = true;
            const array = runtime.variables.get('A') as RankArray;
            expect(readArrayItem(array, 0)).toBe(true);
            expect(readArrayItem(array, 8191)).toBe(false);
            expect(Array.isArray(array.items)).toBe(true);
            words[1] = 0;
        });
        expect(paused).toBe(true);
        expect(runtime.execute('A count')).toBe(8192n);
    } finally { runtime.dispose(); }
});

it('reloads storage after an observable host callback converts it', () => {
    const array = filledArray(false, [8192]);
    let polled = false;
    const signal: InterruptSignal = {
        length: 1, load: () => 0, store() {}, wait() {},
        exchange() {
            if (!polled) { polled = true; writeArrayCell(array, 8191, 42n); }
            return 0;
        },
    };
    withInterrupt(signal, () => fillBooleanSelection(array, 8192, index => index, true));
    expect(polled).toBe(true);
    expect(readArrayItem(array, 2048)).toBe(true);
    expect(readArrayItem(array, 8191)).toBe(true);
});

it.each([0, 1, 1023, 1024, 1025])('commits exactly %s cells under a demand budget', budget => {
    const array = filledArray(false, [8192]);
    expect(() => withDemandBudget(budget, () => fillBooleanSelection(array, 8192, index => index, true)))
        .toThrow(DemandBudgetExhausted);
    if (budget) expect(readArrayItem(array, budget - 1)).toBe(true);
    expect(readArrayItem(array, budget)).toBe(false);
});
