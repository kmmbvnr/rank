import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, typeName } from '../src/index.js';
import { withDemandBudget, DemandBudgetExhausted, withInterrupt, InterruptedError } from '../src/interrupt.js';

function execute(source: string, compilation = true, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try { const result = diagnostics.run(() => runtime.execute(source)); value = result === undefined ? undefined : formatValue(result); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { value, error,
            variables: [...runtime.variables].map(([name, item]) => [name, typeName(item), formatValue(item)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.observation).toEqual(execute(source, false).observation);
    expect(result.observation).toEqual(execute(source, true, false).observation);
    return result;
}
const loop = (body: string, setup = 'A = array shape 8 fill 1') => `use sequences\n${setup}\nfor Pass in 1 to 2\n${body}\nend\nA`;

describe('numeric regions with native stages', () => {
    it.each(['primes to 31', 'primes from 5 till 31', 'primes after 5 to 31', 'primes to 1'])('lowers bounded %s with an ordinal', primes => {
        const result = compare(loop(`for P I in ${primes}\n A += P + I\nend`, 'A = 0'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('captures prime bounds before their names change', () => {
        expect(compare('use sequences\nBound = 11\nA = 0\nfor P in primes to Bound\n A += P\n Bound = 2\nend\nA').observation.value).toBe('28');
    });
    it.each(['1 to 5 by 2', '5 to 1 by -2', '3 till 3', '2 to 3'])('keeps selector %s as a completed array with captured bounds', range => {
        const result = compare(loop(`Slots = ${range}\nA Slots *= 3\nA Slots += 2`, 'A = array shape 8 fill 1\nSaved = A\nSlots = 0 till 0') + '\nAfter = Slots copy\nA');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
    });
    it('retains a range after its bounds change, including as a loop result', () => {
        compare('use sequences\nA = array shape 10 fill 0\nStart = 1\nStop = 5\nfor I in 1 to 2\n Slots = Start till Stop by 2\n Start += 1\n Stop -= 1\n A Slots += I\n Slots\nend');
    });
    it('uses captured named bounds after their scalar names change', () => {
        const result = compare(loop('Slots = Start till Stop by Step\nStart += 1\nStop -= 1\nStep = 0\nA Slots += Pass', 'A = array shape 8 fill 0\nSlots = 0 till 0\nStart = 1\nStop = 5\nStep = 2').replace('for Pass in 1 to 2', 'for Pass in 1 to 1'));
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.value).toBe('0 1 0 1 0 0 0 0');
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('retains named row-slice geometry and RHS snapshots', () => {
        const result = compare(loop('Slots = 1 to 3\nA Pass Slots += B Pass Slots', 'A = array shape 3 5 fill 2\nB = array shape 3 5 fill 3\nSlots = 0 till 0'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each(['1 to 3 by 0', '-1 to 2', '1 to 9', '7 to 1 by -2'])('matches errors and earlier writes for %s', range => {
        compare(loop(`A 0 = 7\nSlots = ${range}\nA Slots *= 2`, 'A = array shape 5 fill 0'));
    });
    it('snapshots overlapping named slices before compound stores', () => {
        compare(loop('Target = 1 to 5\nSource = 0 till 5\nA Target += A Source', 'A = 1 to 8 copy'));
    });
    it.each(['After = Slots copy', 'Slots 0 = 8', 'Slots += 1', 'for J in Slots\n A J += 1\nend'])('retains ordinary array consumers: %s', consumer => {
        compare(loop(`Slots = 1 to 3\n${consumer}`, 'A = array shape 8 fill 0\nSlots = 0 till 0'));
    });
    it('keeps ordinary range arrays on the existing numeric arithmetic path', () => {
        const result = compare(loop('Slots = 1 to 3\nA = Slots + 1', 'A = array 0'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('keeps an unentered conditional range unavailable', () => {
        compare(loop('if Pass greater 1\n Slots = 1 to 2\nend\nA Slots = 5'));
    });
    it.each(['Slots = 7', 'Slots = array 1 2', 'Slots = 1 to 2'])('retains the earlier binding contract %s', setup => {
        compare(loop('Slots = 2 till 4\nA Slots = 3', `A = array shape 5 fill 0\n${setup}`));
    });
    it.each(['+', '-', '*', '//', 'mod'])('compiles array %s= with broadcasting and an alias', op => {
        const result = compare(loop(`A ${op}= B`, 'A = array 12 18 24\nSaved = A\nB = array 2'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each(['array 1 2', 'array 0', 'array 1.5'])('retains compound fallback for %s', rhs => {
        compare(loop(`A //= ${rhs}`, 'A = array 12 18 24'));
    });
    it('mixes wide totals with slice stores and retries only overflowing cells', () => {
        const result = compare(loop('Slots = 0 to 3\nA Slots += 1\nS += A * B + B sum', 'A = array 2 1000000000 3 4\nB = array 5 1000000000 7 11\nS = 9007199254740993') + '\nS');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
        expect(result.diagnostics.costs['number-loop.wide-vector']?.boxedCells).toBe(2);
        expect(result.diagnostics.costs['number-loop.wide-vector']?.unboxedCells).toBe(6);
    });
    it('flushes numeric subtotals when the aggregate alone is wide', () => {
        const result = compare(loop('S += A + 1 sum', 'A = array 3000000000000001 3000000000000003 3000000000000005 3000000000000007\nS = 9007199254740993') + '\nS');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.costs['number-loop.wide-vector']?.boxedCells).toBe(0);
        expect(result.diagnostics.costs['number-loop.wide-vector']?.unboxedCells).toBe(8);
    });
    it.each(['array 0', 'array -1 2 3', 'array shape 0 fill 2', 'array 9007199254740993'])('preserves wide reduction fallback for %s', a => {
        compare(loop('S += A * B sum', `A = ${a}\nB = array 1 2 3\nS = 9007199254740993`) + '\nS');
    });
    it('keeps numeric slice stages when a captured scalar makes every summand wide', () => {
        const result = compare(loop('A (0 to 2) += 1\nTotal += A * Scale sum', 'A = array 1 2 3\nScale = 9007199254740993\nTotal = 0') + '\nTotal');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
        expect(result.diagnostics.costs['number-loop.wide-vector']?.boxedCells).toBe(6);
        expect(result.diagnostics.costs['number-loop.wide-vector']?.unboxedCells).toBe(0);
    });
    it('retains separately completed wide array intermediates', () => {
        compare(loop('Whole = A * A\nS += Whole + A sum', 'A = array 1000000000 2\nS = 9007199254740993') + '\nWhole');
    });
    it('keeps mixed slice failures and preceding completed stores', () => {
        compare(loop('Slots = 0 till 2\nA Slots = 7\nS += A * 9007199254740991 sum\nSlots = 1 till 9\nA Slots = 2', 'A = array shape 4 fill 0\nS = 9007199254740993'));
    });
    it('honors budgets and cancellation, then permits an ordinary invocation', () => {
        const runtime = new Interpreter(() => {});
        const source = 'use sequences\nA = array shape 1000 fill 0\nS = 9007199254740993\nfor P in primes to 100\n Slots = 0 till 1000 by P\n A Slots += 1\n S += A * P sum\nend\nS';
        try {
            expect(() => withDemandBudget(15, () => runtime.execute(source))).toThrow(DemandBudgetExhausted);
            const signal = new Int32Array(new SharedArrayBuffer(4)); Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute(source))).toThrow(InterruptedError);
            expect(() => runtime.execute(source)).not.toThrow();
        } finally { runtime.dispose(); }
    });
});
