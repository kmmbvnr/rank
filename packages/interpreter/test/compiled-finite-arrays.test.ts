import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { native } from '../src/modules/shared.js';
import { typedArray } from '../src/array-storage.js';
const prefix = 'use numbers\nuse sequences\n';
function observe(body: string, compilation: boolean) {
    let calls = 0;
    const r = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try { return { value: formatValue(r.execute(prefix + body)!), calls }; }
    catch (error) { return { error: error instanceof RankError ? error.format() : String(error), calls }; }
    finally { r.dispose(); }
}
function compare(body: string, compiled = true) {
    const reference = observe(body, false), result = observe(body, true);
    expect({ ...result, calls: 0 }).toEqual({ ...reference, calls: 0 });
    if (compiled) expect(result.calls).toBeGreaterThan(0);
    return result;
}
describe('finite arrays inside exact compiled functions', () => {
    it('builds prime powers with a materialized factorization and mask counts', () => {
        const helper = `fun N powers
 Factors = N factors array
 Primes = Factors unique
 Count = Primes len
 Powers = array shape Count fill 1
 for Prime I in Primes
  Degree = Factors equal Prime count
  Powers I = Prime ** Degree
 end
 return Powers
end\n`;
        for (const n of [1, 2, 12, 360, 1000003]) compare(helper + `${n} powers`);
        expect(compare(helper + '360 powers').value).toBe('8 9 5');
    });
    it.each(['0 till N', '1 to N', 'N to 0 by -2', '0 till N by 2', '0 to N by 0'])('completes a bound range at its ordinary binding: %s', expression => {
        for (const n of [0, 1, 7]) compare(`fun N values
 Items = ${expression}
 return Items
end
${n} values`);
    });
    it.each(['2 3', '# 3', '3 #', '#', '4 2', '-1 6', '0 #', '# #'])('preserves reshape values and errors: %s', dimensions => {
        compare(`fun Values shaped
 Matrix = Values reshape ${dimensions}
 return Matrix
end
(array 1 2 3 4 5 6) shaped`, dimensions !== '# #');
    });
    it('keeps reshape aliases independent after local writes', () => {
        compare(`fun N shaped
 Items = N factors array
 Matrix = Items reshape 1 #
 Alias = Items
 Matrix 0 0 = 99
 return Alias
end
360 shaped`);
    });
    it.each(['Values 3 Mod powmod + 1', '(Values + 1) 3 Mod powmod', 'Values (array 0 1 2) Mod powmod'])('lowers an array powmod with surrounding arithmetic: %s', expression => {
        for (const modulus of [7, 2000000011, 2147483649]) compare(`fun Values powered Mod
 Result = ${expression}
 return Result
end
(array 2 3 4) powered ${modulus}`);
    });
    it('broadcasts powmod and consumes a boolean selector', () => {
        expect(compare(`fun Values powered Mod
 Matrix = Values reshape 3 1
 Powers = Matrix (array 0 1 2) Mod powmod
 Flat = Powers reshape #
 Mask = Flat mod 2 equal 1
 return Flat Mask
end
(array 2 3 4) powered 7`).value).toBe('1 1 3 1');
    });
    it.each(['-1', '0'])('keeps powmod errors for %s', value => {
        const expression = value === '-1' ? `Values (-1) 7 powmod` : 'Values 3 0 powmod';
        compare(`fun Values powered
 Result = ${expression}
 return Result
end
(array 1 2 3) powered`);
    });
    it('does not infer a nonnegative exponent after reassignments', () => {
        compare(`fun Values powered
 Degree = Values equal 1 count
 Degree -= 2
 return 2 ** Degree
end
(array 1) powered`, false);
        compare(`fun Values powered
 Degree = Values len
 if Degree equal 1
  Degree = -1
 end
 return 2 ** Degree
end
(array 1) powered`, false);
    });
    it('guards native array calls after warming the helper', () => {
        const r = new Interpreter();
        try {
            r.execute(prefix + `fun Values powered Mod
 Result = Values 3 Mod powmod
 return Result
end`);
            expect(formatValue(r.execute('(array 2 3) powered 7')!)).toBe('1 6');
            r.variables.set('powmod', native('replacement', 3, () => ({ kind: 'array', shape: [2], items: [17n, 19n] })));
            expect(formatValue(r.execute('(array 2 3) powered 7')!)).toBe('17 19');
        } finally { r.dispose(); }
    });
    it('retains cached helper budget and cancellation boundaries', () => {
        const source = prefix + `fun N values
 Factors = N factors array
 Items = 0 till N
 Values = Items 3 2000000011 powmod + 1
 Shape = Values reshape 1 #
 return Shape
end`;
        for (const budget of [1, 100, 10000, 1000000]) {
            const run = (compilation: boolean) => {
                const r = new Interpreter(() => {}, { compilation });
                try {
                    r.execute(source); r.execute('12 values');
                    try { return formatValue(withDemandBudget(budget, () => r.execute('Answer = 12 values'))!); }
                    catch (error) { return { error: (error as Error).constructor.name, published: r.variables.has('Answer') }; }
                } finally { r.dispose(); }
            };
            expect(run(true)).toEqual(run(false));
        }
        const r = new Interpreter();
        try {
            r.execute(source); r.execute('12 values');
            const signal = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => r.execute('Answer = 12 values'))).toThrow();
            expect(r.variables.has('Answer')).toBe(false);
        } finally { r.dispose(); }
    });
});

it('keeps scalar proof work linear while admitting array operators', () => {
    let expression = 'N';
    for (let i = 0; i < 15; i++) expression = `(${expression} + 1) * 2`;
    const d = new RuntimeDiagnostics(), r = new Interpreter();
    try {
        expect(d.run(() => r.execute(`fun N nested\n return ${expression}\nend\n1 nested`))).toBe(98302n);
        expect(d.numberFunctions).toBeGreaterThan(0);
    } finally { r.dispose(); }
});

it('leaves metadata-only range consumers lazy', () => {
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute('use sequences\nfun N size\n return (1 to N) len\nend');
            const n = 10n ** 40n;
            expect(withDemandBudget(10000, () => r.execute(`${n} size`))).toBe(n);
        } finally { r.dispose(); }
    }
});

it('compiles literal nonnegative array exponents and retains negative fallback', () => {
    for (const expression of ['Values ** (array 0 2)', '-Values ** (array 0 2)', 'Values ** (array -1 -2)']) {
        const result = compare(`fun Values powers
 Result = ${expression}
 return Result
end
(array 2 3) powers`, !expression.includes('-1'));
        expect(result.error).toBeUndefined();
    }
});

it('compiles count-derived powers and stacks with exact array geometry', () => {
    const result = compare(`fun Values powers
 Grid = Values Values outer equal
 Counts = Grid count rank 1
 Powers = Values ** Counts
 Matrix = stack Values Powers axis 1
 return Matrix
end
(array 2 3 2) powers`);
    expect(result.value).toBe('2 4 3 3 2 4');
});

it.each(['array shape 0 fill 0', 'array -2 3 4', 'array 2 0 9', 'array 9007199254740991 2', 'array (2 ** 80) 3'])('compiles an exact ordered product, including empty and wide values: %s', input => {
    compare(`fun Values product
 Result = Values reduce *
 return Result
end
(${input}) product`);
});

it('uses checked Number products and replays unsafe prefixes exactly', () => {
    const r = new Interpreter(), d = new RuntimeDiagnostics();
    try {
        r.execute('fun Values product\n Result = Values reduce *\n return Result\nend');
        r.variables.set('Input', typedArray(new Int32Array([2, 3, 4]), [3]));
        expect(d.run(() => r.execute('Input product'))).toBe(24n);
        expect(d.numberFunctions).toBeGreaterThan(0);
        r.variables.set('Input', typedArray(new BigInt64Array([9007199254740991n, 2n]), [2]));
        expect(d.run(() => r.execute('Input product'))).toBe(18014398509481982n);
        expect(d.numberFunctionFallbacks).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
