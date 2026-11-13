import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { answerOf } from './support.js';

type Scope = (run: () => void) => void;
function outcome(source: string, options: InterpreterOptions = {}, scope: Scope = run => run()) {
    let loops = 0;
    const runtime = new Interpreter(() => {}, { ...options, onIntegerLoopExecuted: () => loops++ });
    try {
        try {
            let value: ReturnType<Interpreter['execute']>;
            scope(() => { value = runtime.execute(source); });
            return { value: value === undefined ? undefined : formatValue(value), loops };
        } catch (error) { return { error: error instanceof RankError ? error.format() : String(error), loops }; }
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const compiled = outcome(source);
    for (const options of [{ compilation: false }, { numberLoopCompilation: false }]) {
        const other = outcome(source, options);
        expect({ ...compiled, loops: 0 }).toEqual({ ...other, loops: 0 });
    }
    return compiled;
}
const sum = (range: string) => `use sequences
Total = 0
for P in ${range}
 Total += P
end
Total`;

describe('compiled finite reversed prime plans', () => {
    it.each(['primes from 3 to 7', 'primes after 2 till 8', '(primes till 8) from 3',
        'primes from 2 to 2', 'primes after 7 till 3'])('preserves order and ordinal for %s', range => {
        const result = compare(`use sequences
Total = 0
for P I in (${range}) reverse
 Total = Total * 100 + P + I
end
Total`);
        expect(result.loops).toBe(1);
    });
    it('snapshots bounds before the first body iteration and preserves break', () => {
        const result = compare(`use sequences
High = 20
Total = 0
for P I in (primes from 3 to High) reverse
 High = 3
 Total += P * (I + 1)
 if I equal 2
  break
 end
end
Total`);
        expect(result.value).toBe('92');
        expect(result.loops).toBe(1);
    });
    it('guards rebound primes and reverse', () => {
        for (const binding of ['primes = array 3 5 7', 'fun X reverse = X']) {
            const result = compare(`use sequences\n${binding}\nTotal = 0\nfor P in (primes from 3 to 7) reverse\n Total = Total * 100 + P\nend\nTotal`);
            expect(result.loops).toBe(0);
        }
    });
    it('retains ordinary errors for infinite and invalid plans', () => {
        for (const range of ['primes', 'primes till "bad"']) {
            const result = compare(sum(`(${range}) reverse`));
            expect(result.loops).toBe(0);
            expect(result).toHaveProperty('error');
        }
    });
    it.each([1, 20, 1000])('retains budget observation with %s units', budget => {
        const source = sum('(primes from 3 to 100) reverse');
        const scope = (run: () => void) => withDemandBudget(budget, run);
        expect(outcome(source, {}, scope)).toEqual(outcome(source, { compilation: false }, scope));
    });
    it('retains custom cancellation polling', () => {
        const scope = (run: () => void) => {
            let exchanges = 0;
            const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {},
                exchange: () => ++exchanges >= 2 ? 1 : 0 };
            withInterrupt(signal, run);
        };
        const source = sum('(primes from 3 to 5000) reverse');
        expect(outcome(source, {}, scope)).toEqual(outcome(source, { compilation: false }, scope));
    });
    it('rechecks guards after warming the same function', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(`use sequences
fun total
 Sum = 0
 for P in (primes from 3 to 100) reverse
  Sum += P
 end
 return Sum
end`);
            const invoke = () => runtime.execute('Answer = total');
            invoke();
            expect(answerOf(runtime)).toBe(1058n);
            expect(() => withDemandBudget(1, invoke)).toThrow();
            invoke();
            expect(answerOf(runtime)).toBe(1058n);
        } finally { runtime.dispose(); }
    });
});
