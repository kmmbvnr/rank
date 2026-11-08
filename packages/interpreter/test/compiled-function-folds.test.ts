import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { materializeValue } from '../src/materialize.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
const prefix = 'use numbers\nuse sequences\n';
function observe(source: string, compilation: boolean) {
    const output: string[] = [], d = new RuntimeDiagnostics();
    const r = new Interpreter(line => output.push(line), { compilation });
    try { return { value: formatValue(d.run(() => r.execute(prefix + source))!), output, folds: d.compiledFunctionFolds }; }
    catch (error) { return { error: error instanceof RankError ? error.format() : String(error), output, folds: d.compiledFunctionFolds }; }
    finally { r.dispose(); }
}
function compare(source: string, compiled = true) {
    const a = observe(source, false), b = observe(source, true);
    expect({ ...b, folds: 0 }).toEqual({ ...a, folds: 0 });
    if (compiled) expect(b.folds).toBeGreaterThan(0);
    return b;
}
it('preserves seeded scalar fold order', () => {
    expect(compare(`fun State digit Value
 return State * 10 + Value
end
fun Values total
 Result = Values reduce digit with 0
 return Result
end
(array 1 2 3) total`).value).toBe('123');
});
it('folds matrix rows into a changing-length state', () => {
    expect(compare(`fun State append_row Row
 return concat State Row copy
end
fun Matrix total
 Seed = array 0
 Result = Matrix reduce append_row rank 1 axis 0 with Seed
 return Result
end
Matrix = (1 to 6) reshape 3 2
Matrix total`).value).toBe('0 1 2 3 4 5 6');
});
it('folds matrix rows with scalar accumulators', () => {
    expect(compare(`fun State add_row Row
 Value = Row sum
 return State + Value
end
fun Matrix total
 Result = Matrix reduce add_row rank 1 axis 0 with 7
 return Result
end
Matrix = (1 to 6) reshape 3 2
Matrix total`).value).toBe('28');
});
it('returns the seed without invoking a failing callback on an empty matrix', () => {
    expect(compare(`fun State failing Row
 return State + Row 99
end
fun Matrix total
 Result = Matrix reduce failing rank 1 axis 0 with 7
 return Result
end
Matrix = array shape 0 2 fill 0
Matrix total`).value).toBe('7');
});
it('retains callback errors and their caller locations', () => {
    compare(`fun State failing Row
 Value = Row 9
 return State + Value
end
fun Matrix total
 Result = Matrix reduce failing rank 1 axis 0 with 7
 return Result
end
Matrix = array shape 2 2 fill 1
Matrix total`);
});
it('keeps last lazy results at their ordinary consumer', () => {
    compare(`fun State append_row Row
 return concat State Row
end
fun Matrix total
 Seed = array 0
 Result = Matrix reduce append_row rank 1 axis 0 with Seed
 return Result
end
Matrix = (1 to 4) reshape 2 2
Matrix total`);
});
it('keeps callback parameter mutation and printing on ordinary execution', () => {
    compare(`use io
fun State noisy Row
 "step" print
 return State + Row 0
end
fun Matrix total
 Result = Matrix reduce noisy rank 1 axis 0 with 0
 return Result
end
Matrix = array shape 2 1 fill 1
Matrix total`, false);
    compare(`fun State changed Row
 State 0 += Row 0
 return State
end
fun Matrix total
 Seed = array 0
 Result = Matrix reduce changed rank 1 axis 0 with Seed
 return Result
end
Matrix = array shape 2 1 fill 1
Matrix total`, false);
});
it('rechecks callback identity after a compiled call', () => {
    const r = new Interpreter(), d = new RuntimeDiagnostics();
    try {
        r.execute(prefix + `fun A add B
 return A + B
end
fun A multiply B
 return A * B
end
fun Values total
 Result = Values reduce add with 1
 return Result
end`);
        expect(d.run(() => r.execute('(array 2 3) total'))).toBe(6n);
        expect(d.compiledFunctionFolds).toBeGreaterThan(0);
        r.variables.set('add', r.variables.get('multiply')!);
        expect(r.execute('(array 2 3) total')).toBe(6n);
        expect(r.execute('(array 4 5) total')).toBe(20n);
    } finally { r.dispose(); }
});
// Budget units already differ between interpreter and compiled fallbacks.
// Warming the new fold must not alter that existing fallback policy.
it('declines execution hooks, budgets and opaque cancellation after warming', () => {
    const definition = prefix + `fun A add B
 return A + B
end
fun Values total
 Result = Values reduce add with 0
 return Result
end`;
    for (const budget of [1, 10, 1000, 1000000]) {
        const run = (warm: boolean) => {
            const r = new Interpreter();
            try {
                r.execute(definition); if (warm) r.execute('(array 2 3) total');
                try { return withDemandBudget(budget, () => r.execute('Answer = (array 2 3) total')); }
                catch (error) { return { kind: (error as Error).constructor.name, published: r.variables.has('Answer') }; }
            } finally { r.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    }
    const d = new RuntimeDiagnostics(), r = new Interpreter(() => {}, { onScalarFunctionExecuted: () => {} });
    try {
        expect(d.run(() => r.execute(definition + '\n(array 2 3) total'))).toBe(5n);
        expect(d.compiledFunctionFolds).toBe(0);
    } finally { r.dispose(); }
    const host = new Interpreter();
    try {
        host.execute(definition); host.execute('(array 2 3) total');
        host.execute('Input = 1 to 4096');
        let polls = 0;
        expect(() => withInterrupt({ length: 1, load: () => 0, store() {}, wait() {}, exchange: () => ++polls > 1 ? 1 : 0 },
            () => host.execute('Answer = Input total'))).toThrow();
        expect(host.variables.has('Answer')).toBe(false);
    } finally { host.dispose(); }
});
it('supports stacks and count-derived nonnegative array powers', () => {
    const r = new Interpreter(), d = new RuntimeDiagnostics();
    try {
        expect(formatValue(d.run(() => r.execute(prefix + `fun Values powers
 Grid = Values Values outer equal
 Counts = Grid count rank 1
 Result = Values ** Counts
 Matrix = stack Values Result axis 1
 return Matrix
end
(array 2 3 2) powers`))!)).toContain('4');
    } finally { r.dispose(); }
    for (const body of ['return -(Values 3 7 powmod)', 'return +(Values 3 7 powmod)']) {
        const reference = observe(`fun Values signs\n ${body}\nend\n(array 2 3) signs`, false);
        const compiled = observe(`fun Values signs\n ${body}\nend\n(array 2 3) signs`, true);
        expect({ ...compiled, folds: 0 }).toEqual({ ...reference, folds: 0 });
    }
});
it('preserves stack shape failures and empty geometry', () => {
    for (const dims of ['2 2', '0 2']) {
        const body = `fun Values paired
 Result = stack Values Values axis 1
 return Result
end
Values = array shape ${dims} fill 1
Values paired`;
        expect({ ...observe(body, true), folds: 0 }).toEqual({ ...observe(body, false), folds: 0 });
    }
    const body = `fun Left paired Right
 Result = stack Left Right axis 1
 return Result
end
(array 1 2) paired (array 3)`;
    expect({ ...observe(body, true), folds: 0 }).toEqual({ ...observe(body, false), folds: 0 });
});

it('preserves array callback failures at their eventual consumer', () => {
    compare(`fun State failing Row
 return Row // 0
end
fun Matrix total
 Seed = array 0
 Result = Matrix reduce failing rank 1 axis 0 with Seed
 return Result
end
Matrix = array shape 2 1 fill 1
Matrix total`);
});

it('retains returned array recipes without demanding unused cells', () => {
    expect(compare(`fun State ignored Row
 return Row // 0
end
fun Matrix total
 Seed = array 0
 Result' = Matrix reduce ignored rank 1 axis 0 with Seed
 return 7
end
Matrix = array shape 2 1 fill 1
Matrix total`, false).value).toBe('7');
});
it('preserves returned array shape failures', () => {
    compare(`fun Values bad
 return Values + (array 1 2 3)
end
Input = array 1 2
Answer = Input bad`, false);
});
it('protects inputs captured by returned array recipes', () => {
    expect(compare(`fun Values doubled
 return Values * 2
end
Input = array 1 2
Saved' = Input doubled
Input 0 = 9
Saved`, false).error).toContain('read-only because plan Saved');
});
it('completes returned recipes at ordinary bindings across helper chains', () => {
    expect(compare(`fun Values doubled
 return Values * 2
end
fun Values relay
 return Values doubled
end
fun Values total
 Ready = Values relay
 return Ready sum
end
(array 1 2) total`, false).value).toBe('6');
});

it.each(['Values + (array 1 2 3)', 'Values // 0'])('preserves dense typed return construction and demand errors: %s', expression => {
    const run = (compilation: boolean) => {
        let entries = 0;
        const r = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => entries++ });
        try {
            r.execute(`fun Values bad\n return ${expression}\nend`);
            const fn = r.variables.get('bad');
            if (!fn || typeof fn !== 'object' || fn.kind !== 'function') throw Error('missing function');
            try { return { value: formatValue(materializeValue(fn.call([typedArray(new Int32Array([1, 2]), [2])]))), entries }; }
            catch (error) { return { error: error instanceof RankError ? error.format() : String(error), entries }; }
        } finally { r.dispose(); }
    };
    const before = run(false), after = run(true);
    expect({ ...after, entries: 0 }).toEqual({ ...before, entries: 0 });
    expect(after.entries).toBeGreaterThan(0);
});

it('keeps argument failures inside an array-returning forwarding helper', () => {
    compare(`fun Values paired N
 return Values * N
end
fun Values relay
 return Values paired (Values 5)
end
Input = array 1 2
Input relay`, false);
});

it('completes strict array arguments even when a callee only reads their length', () => {
    for (const expression of ['Values // 0', '(Values 3 7 powmod) // 0']) compare(`fun Values size
 return Values len
end
fun Values total
 return (${expression}) size
end
Input = array 1 2
Input total`, false);
});
it('keeps argument failures before a forwarded scalar recipe', () => {
    compare(`fun Values delayed N
 Result' = N + 1
 return Result
end
fun Values relay
 return Values delayed (Values 5)
end
Input = array 1 2
Result = 0
for Once in 1 to 1
 Result = Input relay
end
Result`, false);
});
