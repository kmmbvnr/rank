import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}, budget?: number, setup = '') {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, blockCompilation: budget === undefined, ...options });
    const diagnostics = new RuntimeDiagnostics();
    try {
        if (setup) runtime.execute(setup);
        let value: string | undefined, error: string | undefined;
        try {
            const execute = () => diagnostics.run(() => runtime.execute(source));
            const result = budget === undefined ? execute() : withDemandBudget(budget, execute);
            if (result !== undefined) value = formatValue(result);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { diagnostics, state: { value, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, budget?: number, setup = '') {
    const result = run(source, {}, budget, setup);
    expect(result.state).toEqual(run(source, { compilation: false }, budget, setup).state);
    expect(result.state).toEqual(run(source, { numberLoopCompilation: false }, budget, setup).state);
    return result;
}
const loop = `for Turn in 1 to 3
 First = A first
 Last = A last
end`;
it.each(['array 4 5 6', 'array 1.25 0.0 -3.5', 'array true false', 'array 7'])('compiles completed endpoints of %s', expression => {
    const result = compare(`use sequences\nA = ${expression}\n${loop}`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('keeps a host scalar named last as an index without sequences', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('last', 1n);
            expect(diagnostics.run(() => runtime.execute(`A = array 3 4 5
for Turn in 1 to 3
 Value = A last
end`))).toBe(4n);
            if (compilation) expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    }
});
it('reads logical endpoints of a reversed strided view', () => {
    const result = compare(`use sequences
Full = 1 to 10 copy
A = Full (9 to 0 by -2)
${loop}`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.value).toBe('2');
});
it('reads endpoints of fresh local prefix sums', () => {
    const result = compare(`use sequences
for Turn in 1 to 3
 A = 1 to Turn copy
 Prefix = A scan +
 First = Prefix first
 Last = Prefix last
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['first', 'last'])('replays empty %s with previous stores intact', end => {
    const result = compare(`use sequences
A = array 1 2 3
Saved = A
for Turn in 1 to 3
 A 0 += 1
 if Turn equal 2
  A = array shape 0 fill 0
 end
 Value = A ${end}
end`);
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});
it.each(['first', 'last'])('completes every eager cell before %s', end => {
    const result = compare(`use sequences
Divisors = array 1 0 2
for Turn in 1 to 3
 A = 12 // Divisors
 Value = A ${end}
end`);
    expect(result.state.error).toContain('division by zero');
});
it.each([['first', '12'], ['last', '6']])('keeps native inline-expression demand for %s', (end, wanted) => {
    const result = compare(`use sequences
Divisors = array 1 0 2
for Turn in 1 to 3
 Value = (12 // Divisors) ${end}
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.value).toBe(wanted);
});
it('retains row results for rank-two endpoints', () => {
    const result = compare(`use sequences
A = 1 to 6 reshape 2 3
${loop}`);
    expect(result.state.error).toBeUndefined();
});
it('retains exact values outside the Number domain', () => {
    expect(compare(`use sequences\nA = array 9007199254740993 2\n${loop}`).state.error).toBeUndefined();
});
it('keeps endpoints exact while the surrounding total widens', () => {
    const result = compare(`use sequences
A = array 3 4
Total = 9007199254740990
for Turn in 1 to 3
 Total += A first
 Total += A last
end
Total`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.value).toBe('9007199254741011');
    expect(result.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
});
it.each([0, 1, 3, 10, 100])('keeps endpoint work at budget %s', budget => {
    compare(loop, budget, 'use sequences\nA = array 1 2 3');
});
it('rechecks a replaced last binding after warming', () => {
    const states: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            runtime.execute(`use sequences\nfun Value replacement\n return -1\nend\nA = array 4 5 6\n${loop}`);
            runtime.variables.set('last', runtime.variables.get('replacement')!);
            states.push(formatValue(runtime.execute(loop)!));
        } finally { runtime.dispose(); }
    }
    expect(states).toEqual(['-1', '-1']);
});
it('does not borrow a custom item reader installed after warming', () => {
    const states: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            runtime.execute(`use sequences\nA = array 4 5 6\n${loop}`);
            let reads = 0;
            Object.defineProperty(runtime.variables.get('A'), 'itemAt', { configurable: true,
                value: (index: number) => { reads++; return BigInt(100 + index); } });
            states.push({ value: formatValue(runtime.execute(loop)!), reads });
        } finally { runtime.dispose(); }
    }
    expect(states[1]).toEqual(states[0]);
});
it('keeps a warmed endpoint function reusable across polling scopes', () => {
    const states: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            runtime.execute(`use sequences\nfun Values endpoints\n Total = 0\n for Turn in 1 to 20\n  Total += Values first\n  Total += Values last\n end\n return Total\nend\nA = array 2 3 4`);
            expect(runtime.execute('A endpoints')).toBe(120n);
            states.push(withInterrupt(new Int32Array(1), () => runtime.execute('A endpoints')));
            states.push(runtime.execute('A endpoints'));
        } finally { runtime.dispose(); }
    }
    expect(states).toEqual([120n, 120n, 120n, 120n]);
});
