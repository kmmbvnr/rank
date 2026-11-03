import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

const definition = `fun N total
 S = 0
 for I in 1 to N
  S += I
 end
 return S
end`;
function runtime() { return new Interpreter(() => {}, { scalarEntryCompilation: false }); }

describe('numeric loop polling policies', () => {
    it('reuses a warmed region across ordinary, atomic and budgeted scopes', () => {
        const r = runtime(), d = new RuntimeDiagnostics();
        try {
            r.execute(definition);
            d.run(() => {
                expect(r.execute('10 total')).toBe(55n);
                withInterrupt(new Int32Array(1), () => expect(r.execute('100 total')).toBe(5050n));
                withDemandBudget(1000, () => expect(r.execute('50 total')).toBe(1275n));
                expect(r.execute('20 total')).toBe(210n);
            });
            expect(d.numberLoops).toBe(4);
            expect(d.numberLoopUnpolled).toBe(2);
            expect(d.numberLoopBatched).toBe(1);
        } finally { r.dispose(); }
    });

    it.each([1, 7, 30, 70])('retains the checked path under a %i-unit demand budget', budget => {
        const r = runtime(), d = new RuntimeDiagnostics();
        try {
            r.execute(definition);
            expect(r.execute('10 total')).toBe(55n);
            expect(() => withDemandBudget(budget, () => d.run(() => r.execute('1000000 total')))).toThrow(DemandBudgetExhausted);
            expect(d.numberLoopUnpolled).toBe(0);
            expect(d.numberLoopBatched).toBe(0);
            expect(r.execute('20 total')).toBe(210n);
        } finally { r.dispose(); }
    });

    it('flushes short nested regions so repeated calls cannot starve cancellation', () => {
        const r = runtime(), d = new RuntimeDiagnostics(), flag = new Int32Array(1);
        try {
            r.execute(definition);
            r.execute('100 total');
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => d.run(() => r.execute(`Last = 0
for Outer in 1 to 100
 Last = Outer
 100 total
end`)))).toThrow('Interrupted');
            expect(r.variables.get('Last')).toBeGreaterThan(0n);
            expect(r.variables.get('Last')).toBeLessThan(30n);
            expect(d.numberLoopBatched).toBeGreaterThan(0);
        } finally { r.dispose(); }
    });

    it('publishes committed stores and finally on batched cancellation, retaining snapshots', () => {
        const r = runtime(), d = new RuntimeDiagnostics(), flag = new Int32Array(1);
        try {
            r.execute('A = array shape 10000 fill 0\nAlias = A');
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => d.run(() => r.execute(`S = 0
Last = 0
Done = 0
try
 for I in 0 till 10000
  A I = I
  S += I
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            const last = r.variables.get('Last') as bigint;
            expect(last).toBeGreaterThan(0n);
            expect(last).toBeLessThan(2048n);
            expect(r.variables.get('S')).toBe(last * (last + 1n) / 2n);
            expect(r.variables.get('Done')).toBe(1n);
            expect(r.execute(`A ${last}`)).toBe(last);
            expect(r.execute(`A ${last + 1n}`)).toBe(0n);
            expect(r.execute(`Alias ${last}`)).toBe(0n);
            expect(d.numberLoopBatched).toBe(1);
        } finally { r.dispose(); }
    });

    it.each([false, true])('replays an overflowing private region exactly (atomic=%s)', atomic => {
        const r = runtime(), d = new RuntimeDiagnostics();
        const execute = () => d.run(() => r.execute(`A = array 1 2
Alias = A
S = 9007199254740990
for I in 1 to 10
 A 0 += I
 S += I
end
S`));
        try {
            const value = atomic ? withInterrupt(new Int32Array(1), execute) : execute();
            expect(value).toBe(9007199254741045n);
            expect(r.execute('A 0')).toBe(56n);
            expect(r.execute('Alias 0')).toBe(1n);
            expect(d.numberLoopOverflows).toBe(1);
            expect(atomic ? d.numberLoopBatched : d.numberLoopUnpolled).toBeGreaterThan(0);
        } finally { r.dispose(); }
    });

    it('retains error precedence and prior stores before a partial polling batch', () => {
        const r = runtime(), d = new RuntimeDiagnostics(), flag = new Int32Array(1);
        try {
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => d.run(() => r.execute(`A = array 0
Done = 0
try
 for I in 1 to 10
  A 0 = I
  Bad = 1 // 0
 end
finally
 Done = 1
end`)))).toThrow('division by zero');
            expect(r.execute('A 0')).toBe(1n);
            expect(r.variables.get('Done')).toBe(1n);
            expect(d.numberLoopBatched).toBe(1);
        } finally { r.dispose(); }
    });

    it.each([false, true])('keeps custom polling and inspection observable (inspection=%s)', inspection => {
        const r = runtime(), d = new RuntimeDiagnostics();
        const custom = {length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {}};
        try {
            r.execute(definition);
            expect(withInterrupt(inspection ? new Int32Array(1) : custom,
                () => d.run(() => r.execute('100 total')), inspection ? () => {} : undefined)).toBe(5050n);
            expect(d.numberLoops).toBe(0);
            expect(d.numberLoopUnpolled).toBe(0);
            expect(d.numberLoopBatched).toBe(0);
        } finally { r.dispose(); }
    });
});
