import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

function primes(low: number, high: number) {
    const result: bigint[] = [];
    for (let n = Math.max(2, low); n <= high; n++) {
        let prime = true;
        for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
        if (prime) result.push(BigInt(n));
    }
    return result;
}
for (const lower of ['from', 'after']) for (const upper of ['to', 'till']) {
    it(`copies bounded primes ${lower}/${upper} in changing local arrays`, () => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        const source = `use sequences\nTotal = 0\nfor N in 10 to 70\n A = primes ${lower} 11 ${upper} N copy\n Total += A sum\nend`;
        try {
            diagnostics.run(() => runtime.execute(source));
            const expected = Array.from({ length: 61 }, (_, i) => primes(lower === 'after' ? 12 : 11, i + 10 - (upper === 'till' ? 1 : 0)).reduce((a, b) => a + b, 0n)).reduce((a, b) => a + b, 0n);
            expect(runtime.variables.get('Total')).toBe(expected);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
}
it('publishes the last empty vector and preserves an earlier alias', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
Saved = array shape 0 fill 0
A = array shape 0 fill 0
Empty = array shape 0 fill 0
for Limit in 10 to 12
  A = primes from 2 to Limit copy
  if Limit equal 10
    Saved = A
  end
end
for Limit in 1 to 2
  Empty = primes from 100 to Limit copy
end`));
        expect((runtime.variables.get('Saved') as RankArray).items).toEqual([2n, 3n, 5n, 7n]);
        expect((runtime.variables.get('A') as RankArray).items).toEqual([2n, 3n, 5n, 7n, 11n]);
        expect((runtime.variables.get('Empty') as RankArray).shape).toEqual([0]);
        expect((runtime.variables.get('Empty') as RankArray).items).toEqual([]);
        expect(diagnostics.numberLoops).toBe(2);
    } finally { runtime.dispose(); }
});
it('keeps primes above int32 exact', () => {
    const source = 'use sequences\nA = array shape 0 fill 0\nTotal = 0\nfor I in 1 to 3\n A = primes from 2147483547 to 2147483747 copy\n Total += A sum\nend';
    const run = (compilation: boolean) => {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try { diagnostics.run(() => runtime.execute(source)); return { total: runtime.variables.get('Total'), values: (runtime.variables.get('A') as RankArray).items, loops: diagnostics.numberLoops }; }
        finally { runtime.dispose(); }
    };
    const compiled = run(true), reference = run(false);
    expect(compiled.total).toBe(reference.total);
    expect(compiled.values).toEqual(reference.values);
    expect(compiled.loops).toBe(1);
});
it('falls back for bounds outside exact Number integers', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute('use sequences\nA = array shape 0 fill 0\nLow = 9007199254740993\nHigh = Low + 100\nfor I in 1 to 2\n A = primes from Low to High copy\nend'));
        const values = (runtime.variables.get('A') as RankArray).items;
        expect(values.length).toBeGreaterThan(0);
        expect(values.every(value => typeof value === 'bigint' && value >= 9007199254740993n && value <= 9007199254741093n)).toBe(true);
        expect(diagnostics.numberLoops).toBe(0);
    } finally { runtime.dispose(); }
});
for (const name of ['primes', 'copy']) it(`rechecks ${name} after a previous compiled call`, () => {
    const runtime = new Interpreter();
    const definition = `use sequences
fun Bound prime_sum
  Total = 0
  for Limit in 10 to Bound
    A = primes to Limit copy
    Total += A sum
  end
  return Total
end
First = 20 prime_sum`;
    try {
        const warm = new RuntimeDiagnostics();
        warm.run(() => runtime.execute(definition));
        expect(warm.numberLoops).toBe(1);
        let calls = 0;
        runtime.variables.set(name, name === 'primes' ? ownedArray([4n, 9n]) : native('copy', 1, () => { calls++; return ownedArray([99n]); }));
        const next = new RuntimeDiagnostics();
        next.run(() => runtime.execute('Next = 20 prime_sum'));
        expect(runtime.variables.get('Next')).toBe(name === 'primes' ? 13n * 11n : 99n * 11n);
        expect(next.numberLoops).toBe(0);
        if (name === 'copy') expect(calls).toBe(11);
    } finally { runtime.dispose(); }
});
describe('observable execution', () => {
    const source = 'use sequences\nTotal = 0\nfor N in 10 to 20\n A = primes to N copy\n Total += A sum\nend';
    it.each(['budget', 'polling'])('retains the ordinary %s path', mode => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
        try {
            const run = () => diagnostics.run(() => runtime.execute(source));
            if (mode === 'budget') withDemandBudget(1000000, run); else withInterrupt(signal, run);
            const expected = Array.from({ length: 11 }, (_, i) => primes(2, i + 10).reduce((a, b) => a + b, 0n)).reduce((a, b) => a + b, 0n);
            expect(runtime.variables.get('Total')).toBe(expected);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('keeps a scoped demand failure observable', () => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        try {
            expect(() => withDemandBudget(100, () => diagnostics.run(() => runtime.execute(source)))).toThrow(DemandBudgetExhausted);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });
});
it.each([['to', 'from'], ['till', 'after']] as const)('keeps reversed bound clauses %s/%s', (upper, lower) => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences\nTotal = 0\nfor Limit in 20 to 30\n A = primes ${upper} Limit ${lower} 11 copy\n Total += A sum\nend`));
        const expected = Array.from({ length: 11 }, (_, i) => primes(lower === 'from' ? 11 : 12, i + 20 - (upper === 'till' ? 1 : 0)).reduce((a, b) => a + b, 0n)).reduce((a, b) => a + b, 0n);
        expect(runtime.variables.get('Total')).toBe(expected);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { runtime.dispose(); }
});
it('does not demand an unused deferred prime copy', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute("use sequences\nTotal = 0\nfor I in 1 to 3\n Unused' = primes to (1 // 0) copy\n Total += 1\nend");
        expect(runtime.variables.get('Total')).toBe(3n);
    } finally { runtime.dispose(); }
});
it('keeps a wide scalar total exact after constructing local prime arrays', () => {
    const source = 'use sequences\nTotal = 0\nfor I in 1 to 3\n A = primes to 20 copy\n Total += A sum\n if I equal 2\n  Total += 10 ** 40\n end\nend';
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try { runtime.execute(source); expect(runtime.variables.get('Total')).toBe(10n ** 40n + 231n); }
        finally { runtime.dispose(); }
    }
});
it('does not call a shadowed function in an unused branch', () => {
    const runtime = new Interpreter();
    let calls = 0;
    try {
        runtime.execute('use sequences');
        runtime.variables.set('primes', native('primes', 0, () => { calls++; throw Error('unexpected call'); }));
        runtime.execute('Total = 0\nfor I in 1 to 3\n if I less 0\n  A = primes to 20 copy\n end\n Total += 1\nend');
        expect(runtime.variables.get('Total')).toBe(3n);
        expect(calls).toBe(0);
    } finally { runtime.dispose(); }
});
it('joins bounded prime copies with fresh array writes in a function region', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
fun Limit columns
  Left = array shape (Limit + 1) fill 1
  Right = array shape (Limit + 1) fill 1
  for Bound in 2 to Limit
    Primes = primes to Bound copy
    Left Primes = Bound
    Right Primes = Bound + 1
  end
  return tuple Left Right
end
unpack A B = 40 columns`));
        const expected = Array<bigint>(41).fill(1n), other = [...expected];
        for (const prime of primes(2, 40)) { expected[Number(prime)] = 40n; other[Number(prime)] = 41n; }
        expect((runtime.variables.get('A') as RankArray).items).toEqual(expected);
        expect((runtime.variables.get('B') as RankArray).items).toEqual(other);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopCopyProbes).toBe(0);
    } finally { runtime.dispose(); }
});
