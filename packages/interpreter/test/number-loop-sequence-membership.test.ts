import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isRankSequence, withDemandBudget } from '../src/index.js';
import { createArraySnapshot } from '../src/array-storage.js';
import { compiledNumberSequenceMembership, registerSequenceMembership } from '../src/sequence-membership.js';

const setup = `use numbers
use sequences
Primes = 100 primesieve
`;
function run(source: string, compilation: boolean) {
    const r = new Interpreter(() => {}, { compilation }), d = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try { value = d.run(() => formatValue(r.execute(source)!)); }
        catch (e) { error = String(e); }
        return { value, error, d };
    } finally { r.dispose(); }
}
it.each(['Primes', 'primes', 'fibonacci'])(
    'compiles scalar/vector membership and positions against %s', domain => {
        const source = `${setup}Values = 0 till 100 copy
Total = 0
Positions = array shape 0 fill 0
for Turn in 1 to 3
 Mask = (Values + Turn) in ${domain}
 Positions = Mask indices
 Total += Positions sum
 if Turn in ${domain}
  Total += Turn
 end
end
tuple Total Positions`;
        const expected = run(source, false), actual = run(source, true);
        expect(actual.error).toBeUndefined();
        expect({ value: actual.value, error: actual.error }).toEqual({ value: expected.value, error: expected.error });
        expect(actual.d.numberLoops).toBe(1);
        expect(actual.d.cellsComputed).toBe(0);
    });
it('broadcasts membership through a multidimensional numeric expression', () => {
    const source = `${setup}Values = (array 1 2 3 4 5 6) reshape 2 3
Result = Values
for Turn in 1 to 2
 Mask = (Values + Turn) not in Primes
 Result = Mask choose Values 0
end
Result`;
    const expected = run(source, false), actual = run(source, true);
    expect(actual.error).toBeUndefined();
    expect(actual.value).toBe(expected.value);
    expect(actual.d.numberLoops).toBe(1);
});
it.each(['array shape 0 fill 0', 'array 2 9007199254740993', 'array 9007199254740990 9007199254740991'])(
    'preserves empty and wide integer operands: %s', values => {
        const source = `${setup}Values = ${values}
Result = array shape 0 fill 0
Total = 0
for Turn in 1 to 2
 Values += 1
 Result = (Values in Primes) indices
 Total += Result sum
end
tuple Total Values Result`;
        const expected = run(source, false), actual = run(source, true);
        expect(actual.error).toBeUndefined();
        expect({ value: actual.value, error: actual.error }).toEqual({ value: expected.value, error: expected.error });
    });
it('rebinds a warmed reader and rejects changed membership proofs', () => {
    const r = new Interpreter(() => {});
    const body = `Total = 0
for I in 1 to 10
 if I in Primes
  Total += I
 end
end
Total`;
    try {
        r.execute(setup);
        expect(r.execute(body)).toBe(17n);
        r.execute('Other = 5 primesieve');
        r.variables.set('Primes', r.variables.get('Other')!);
        expect(r.execute(body)).toBe(10n);
        const primes = r.variables.get('Primes')!;
        if (!isRankSequence(primes)) throw Error('missing primes');
        expect(compiledNumberSequenceMembership(primes)).toBeTypeOf('function');
        expect(() => withDemandBudget(1, () => r.execute(body))).toThrow('demand budget exhausted');
        r.variables.set('Primes', createArraySnapshot([1n, 4n, 9n]));
        expect(r.execute(body)).toBe(14n);
    } finally { r.dispose(); }
});
it('does not trust host-provided plans or changed iteration', () => {
    expect(compiledNumberSequenceMembership({ kind: 'sequence', plan: {
        name: 'primesieve', size: { kind: 'exact', value: 0n },
        *iterate() {}, contains: () => true,
    } })).toBeUndefined();
    const r = new Interpreter(() => {});
    try {
        const value = r.execute('use sequences\n100 primesieve')!;
        if (!isRankSequence(value)) throw Error('missing primes');
        const reader = compiledNumberSequenceMembership(value)!;
        expect(reader(2)).toBe(true);
        expect(reader(2.5)).toBe(false);
        expect(reader(Infinity)).toBe(false);
        const plan = { ...value.plan };
        registerSequenceMembership(plan);
        const mutable = { kind: 'sequence' as const, plan };
        expect(compiledNumberSequenceMembership(mutable)).toBeTypeOf('function');
        plan.iterate = function* () {};
        expect(compiledNumberSequenceMembership(mutable)).toBeUndefined();
        registerSequenceMembership(plan);
        plan.contains = () => false;
        expect(compiledNumberSequenceMembership(mutable)).toBeUndefined();
    } finally { r.dispose(); }
});
it.each(['from -999999999999999999999 to 999999999999999999999',
    'from 999999999999999999999', 'to -999999999999999999999', 'from 7 to 17'])(
    'clamps arbitrary exact sieve bounds before Number conversion: %s', bounds => {
        const r = new Interpreter(() => {});
        try {
            const value = r.execute(`use sequences\n100 primesieve ${bounds}`)!;
            if (!isRankSequence(value)) throw Error('missing primes');
            const reader = compiledNumberSequenceMembership(value)!;
            for (const integer of [-1, 0, 2, 3, 7, 17, 19, 97, 100, 2147483648, Number.MAX_SAFE_INTEGER]) {
                expect(reader(integer)).toBe(value.plan.contains!(BigInt(integer)));
            }
        } finally { r.dispose(); }
    });
