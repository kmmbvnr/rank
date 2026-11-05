import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

type Scope = (run: () => void) => void;
function execute(source: string, compilation = true, scope: Scope = run => run()) {
    const r = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { scope(() => diagnostics.run(() => r.execute(source))); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            values: [...r.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, scope?: Scope) {
    const actual = execute(source, true, scope);
    expect(actual.observation).toEqual(execute(source, false, scope).observation);
    return actual;
}
const accumulator = `Total = 0
for I in 1 to 3
 Term = I * 3
 Total += 9007199254740991 + Term
end`;

describe('exact outputs before wide intermediates', () => {
    it('keeps the output exact with checked intermediate arithmetic', () => {
        const { diagnostics, observation } = compare(accumulator);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['Total', '27021597764222991']);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });
    it('keeps independent terms checked beside an exact modulus and accumulator', () => {
        const { diagnostics, observation } = compare(`Modulus = 1000000000000000000
Total = 0
for I in 1 to 4
 Term = I * 123
 Total = (Total + Term) mod Modulus
end`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['Total', '1230']);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });
    it('replays the boundary tier when an independent term becomes wide', () => {
        const { diagnostics, observation } = compare(`Modulus = 1000000000000000000
A = array 0 0
Alias = A
Total = 0
for I in 0 to 1
 A I += 1
 Term = 9007199254740991 + I
 Total = (Total + Term) mod Modulus
end`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['A', '1 1']);
        expect(observation.values).toContainEqual(['Alias', '0 0']);
        expect(observation.values).toContainEqual(['Total', '18014398509481983']);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });
    it('publishes boundary-tier writes before a failing exact expression', () => {
        const { observation } = compare(`Modulus = 1000000000000000000
A = array 0 0
Total = 0
for I in 0 to 1
 A I += 1
 Total = (Total + I) mod (Modulus * (1 - I))
end`);
        expect(observation.error).toContain('zero');
        expect(observation.values).toContainEqual(['A', '1 1']);
    });
    it('reuses boundary plans across small and exact external inputs', () => {
        const { observation } = compare(`fun score Modulus
 Total = 0
 for I in 1 to 4
  Term = I * 123
  Total = (Total + Term) mod Modulus
 end
 return Total
end
Small = score 100
Wide = score 1000000000000000000
Again = score 100`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['Small', '30']);
        expect(observation.values).toContainEqual(['Wide', '1230']);
        expect(observation.values).toContainEqual(['Again', '30']);
    });
    it.each([1, 1000])('retains boundary-tier demand guards at %s', budget => {
        const { observation } = execute(`Modulus = 1000000000000000000
Total = 0
for I in 1 to 4
 Term = I * 123
 Total = (Total + Term) mod Modulus
end`, true, run => withDemandBudget(budget, run));
        if (budget === 1) expect(observation.error).toContain('demand budget exhausted');
        else {
            expect(observation.error).toBeUndefined();
            expect(observation.values).toContainEqual(['Total', '1230']);
        }
    });
    it('replays private array and index writes through both mixed tiers', () => {
        const { diagnostics, observation } = compare(`use algo
A = array 0 0 0
Alias = A
Cache = new index
Total = 0
for I in 0 to 2
 A I += 1
 Cache I = I
 Term = 9007199254740991 + I
 Total += Term
end`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['A', '1 1 1']);
        expect(observation.values).toContainEqual(['Alias', '0 0 0']);
        expect(observation.values).toContainEqual(['Total', '27021597764222976']);
        expect(diagnostics.mixedIntegerLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });
    it('retains the broad tier for a wide loop-carried predicate', () => {
        const { diagnostics, observation } = compare(`Total = 0
State = 9007199254740991
for I in 1 to 3
 State += I
 if State greater 9007199254740991
  Total += State
 end
end`);
        expect(observation.error).toBeUndefined();
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    });
    it('reuses both tiers across safe and wide function inputs', () => {
        const { observation } = compare(`fun score Base
 Total = 0
 for I in 1 to 3
  Term = Base * I
  Total += Term
 end
 return Total
end
One = score 1
Wide = score 9007199254740991
Huge = score 100000000000000000000
Two = score 2`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['One', '6']);
        expect(observation.values).toContainEqual(['Wide', '54043195528445946']);
        expect(observation.values).toContainEqual(['Huge', '600000000000000000000']);
        expect(observation.values).toContainEqual(['Two', '12']);
    });
    it('publishes preceding writes and the original error after replay', () => {
        const { observation } = compare(`A = array 0 0
Total = 0
for I in 0 to 2
 A I += 1
 Term = 9007199254740991 + I
 Total += Term
end`);
        expect(observation.error).toContain('out of bounds');
    });
    it('retains exact fallback when the broader tier cannot store a cell', () => {
        const { observation } = compare(`A = array 0 0
Total = 0
for I in 0 to 1
 Term = 9007199254740991 + I
 A I = Term
 Total += Term
end`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['A', '9007199254740991 9007199254740992']);
    });
    it('uses the same policy in a fresh-array function prefix', () => {
        const { observation, diagnostics } = compare(`fun score N
 A = array shape N fill 0
 Total = 0
 for I in 0 till N
  A I = I
  Term = I * 3
  Total += 9007199254740991 + Term
 end
 for J in 0 till N
  A J += 1
 end
 return A
end
Answer = score 3`);
        expect(observation.error).toBeUndefined();
        expect(observation.values).toContainEqual(['Answer', '1 2 3']);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    });
    it.each([1, 10, 50, 200])('retains private-loop demand-budget behavior at %s', budget => {
        // Budgets count backend work, not identical reference instructions.
        const { observation } = execute(accumulator, true, run => withDemandBudget(budget, run));
        if (budget === 1) {
            expect(observation.error).toContain('demand budget exhausted');
            expect(observation.values).toContainEqual(['Total', '0']);
        } else {
            expect(observation.error).toBeUndefined();
            expect(observation.values).toContainEqual(['Total', '27021597764222991']);
        }
    });
    it('preserves statement boundaries under an observable interrupt callback', () => {
        function scope(run: () => void) {
            let polls = 0;
            const signal: InterruptSignal = { length: 1,
                load: () => ++polls > 25 ? 1 : 0,
                store() {}, exchange: () => 0, wait() {} };
            withInterrupt(signal, run);
        }
        compare(accumulator, scope);
    });
});
