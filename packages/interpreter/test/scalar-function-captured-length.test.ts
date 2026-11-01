import {describe, expect, it} from 'vitest';
import {Interpreter, RankError, RuntimeDiagnostics, formatValue} from '../src/index.js';
import {derivedArray, readArrayItem} from '../src/array-storage.js';
import {native} from '../src/modules/shared.js';
import {isNativeFunction, type RankArray} from '../src/value.js';
import {withDemandBudget, DemandBudgetExhausted} from '../src/interrupt.js';

function evaluate(source: string, compilation = true, numberLoopCompilation = true) {
    let entries = 0;
    const runtime = new Interpreter(() => {}, {compilation, numberLoopCompilation, onScalarFunctionExecuted: () => entries++});
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (cause) { if (!(cause instanceof RankError)) throw cause; error = cause.format(); }
        return {entries, diagnostics, state: {error, values: [...runtime.variables]
            .filter(([name]) => ['Result', 'First', 'Second', 'I'].includes(name))
            .map(([name, value]) => [name, formatValue(value)])}};
    } finally {runtime.dispose();}
}
function compare(source: string) {
    const compiled = evaluate(source);
    expect(compiled.state).toEqual(evaluate(source, false).state);
    expect(compiled.state).toEqual(evaluate(source, true, false).state);
    return compiled;
}
const probe = `fun N extent
  return N + (Data len)
end
Result = 0
for I in 1 to 3
  Result += I extent
end`;

describe('compiled length of captured collections', () => {
    it.each([
        ['Data = array 10 20 30', '15'],
        ['Data = array shape 2 3 fill 0.5', '12'],
        ['Data = array shape 0 3 fill 0', '6'],
        ['Data = "a😀é"', '18'],
        ['Data = 1 to 6', '24'],
    ])('links %s without rejecting len', (setup, total) => {
        const r = compare(`${setup}\n${probe}`);
        expect(r.state.error).toBeUndefined();
        expect(r.state.values).toContainEqual(['Result', total]);
        expect(r.entries).toBeGreaterThan(0);
        expect(r.diagnostics.compilerRejections.some(rejection => rejection.name === 'len')).toBe(false);
    });

    it('resolves a rebound collection on each invocation', () => {
        const r = compare(`Data = array 1 2
fun N extent
 return N + (Data len)
end
First = 1 extent
Data = array 3 4 5
Second = 1 extent`);
        expect(r.state.values).toContainEqual(['First', '3']);
        expect(r.state.values).toContainEqual(['Second', '4']);
        expect(r.entries).toBeGreaterThan(0);
    });

    it('keeps nested closure instances separate', () => {
        const r = compare(`fun Size make_extent
 Data = array shape Size fill 0
 fun N inner_extent
  return N + (Data len)
 end
 return 1 inner_extent
end
First = 2 make_extent
Second = 5 make_extent`);
        expect(r.state.values).toContainEqual(['First', '3']);
        expect(r.state.values).toContainEqual(['Second', '6']);
    });

    it('reads changing shapes in a caller loop', () => {
        const r = compare(`use sequences
Data = array shape 1 6 fill 0
fun N extent
 return N + (Data len)
end
Result = 0
for I in 1 to 3
 Data = Data reshape I (6 // I)
 Result += I extent
end`);
        expect(r.state.error).toBeUndefined();
        expect(r.state.values).toContainEqual(['Result', '12']);
        expect(r.entries).toBeGreaterThan(0);
    });

    it.each(['Data = 7', "use sequences\nData' = primes"])('retains preceding state and the error for %s', setup => {
        expect(compare(`${setup}\n${probe}`).state.error).toBeDefined();
    });

    it('does not evaluate a failing length in an unused branch', () => {
        const r = compare(`Data = 7
fun N extent
 if N greater 0
  return N
 end
 return Data len
end
Result = 1 extent`);
        expect(r.state.error).toBeUndefined();
        expect(r.state.values).toContainEqual(['Result', '1']);
        expect(r.entries).toBeGreaterThan(0);
    });

    it('does not force an unused deferred sequence capture', () => {
        const r = compare(`use sequences
Data' = primes
fun N extent
 if N greater 0
  return N
 end
 return Data len
end
Result = 1 extent`);
        expect(r.state.error).toBeUndefined();
        expect(r.state.values).toContainEqual(['Result', '1']);
    });

    it('reads array headers without reading cells or hoisting an unused header', () => {
        const observations: number[] = [];
        for (const compilation of [true, false]) {
            let cells = 0, shapes = 0, entries = 0;
            const runtime = new Interpreter(() => {}, {compilation, onScalarFunctionExecuted: () => entries++});
            try {
                runtime.execute(`Data = array 0
fun N extent
 if N equal 0
  return 0
 end
 return Data len
end`);
                runtime.variables.set('Data', {kind: 'array', get shape() {shapes++; return [7, 9];},
                    get items(): RankArray['items'] {cells++; throw Error('cells must stay lazy');}});
                expect(runtime.execute('0 extent')).toBe(0n);
                expect(shapes).toBe(0);
                expect(runtime.execute('1 extent')).toBe(7n);
                observations.push(shapes);
                expect(cells).toBe(0);
                expect(entries).toBe(0);
            } finally {runtime.dispose();}
        }
        expect(observations[0]).toBe(observations[1]);
    });

    it('compiles native lazy array headers without evaluating elements', () => {
        let cells = 0, entries = 0;
        const runtime = new Interpreter(() => {}, {onScalarFunctionExecuted: () => entries++});
        try {
            runtime.execute(`Data = array 0
fun N extent
 if N equal 0
  return 0
 end
 return Data len
end`);
            runtime.variables.set('Data', derivedArray([7, 9], [], () => {cells++; throw Error('cell forced');}, true));
            expect(runtime.execute('0 extent')).toBe(0n);
            expect(runtime.execute('1 extent')).toBe(7n);
            expect(cells).toBe(0);
            expect(entries).toBe(2);
        } finally {runtime.dispose();}
    });

    it('observes capture changes made by a host header reader', () => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                runtime.execute(`Data = array 0
Flag = true
fun N extent
 Size = Data len
 if Flag
  return N + Size
 end
 return N + Size + 100
end`);
                runtime.variables.set('Data', {kind: 'array', get shape() {runtime.variables.set('Flag', false); return [2];}, items: []});
                expect(runtime.execute('1 extent')).toBe(103n);
            } finally {runtime.dispose();}
        }
    });

    it.each([false, true])('publishes caller writes before a header callback, nested=%s', nested => {
        const observations: bigint[][] = [];
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, {compilation});
            const observed: bigint[] = [];
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute(`Data = array 0
Out = array 0
fun N extent
 return N + (Data len)
end
fun N nested_extent
 return N extent
end`);
                runtime.variables.set('Data', {kind: 'array', get shape() {
                    observed.push(readArrayItem(runtime.variables.get('Out') as RankArray, 0) as bigint);
                    return [1];
                }, items: []});
                diagnostics.run(() => runtime.execute(`for I in 1 to 3
 Out 0 = I
 Result = I ${nested ? 'nested_extent' : 'extent'}
end`));
                observations.push(observed);
                expect([...new Set(observed)]).toEqual([1n, 2n, 3n]);
                expect(diagnostics.numberLoops).toBe(0);
            } finally {runtime.dispose();}
        }
        expect(observations[0]).toEqual(observations[1]);
    });

    it('keeps owned-array length helpers linked without private caller publication', () => {
        const observed: bigint[] = [];
        const runtime = new Interpreter(() => {}, {onScalarFunctionExecuted: () => {
            observed.push(readArrayItem(runtime.variables.get('Out') as RankArray, 0) as bigint);
        }});
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`Data = array 0
Out = array 0
fun N extent
 return N + (Data len)
end
for I in 1 to 3
 Out 0 = I
 Result = I extent
end`));
            expect(observed).toEqual([1n, 2n, 3n]);
            expect(diagnostics.compiledLoops).toBeGreaterThan(0);
            expect(diagnostics.numberLoops).toBe(0);
        } finally {runtime.dispose();}
    });

    it.each([false, true])('rechecks a warm len binding, same-object override=%s', sameObject => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                runtime.execute(`Data = array 1 2
fun N extent
 return N + (Data len)
end
fun N caller
 return N extent
end`);
                expect(runtime.execute('1 caller')).toBe(3n);
                const len = runtime.execute('len');
                if (!len || !isNativeFunction(len)) throw Error('missing len');
                if (sameObject) Object.defineProperty(len, 'call', {value: () => 90n});
                else runtime.variables.set('len', native('len', 1, () => 90n));
                expect(runtime.execute('1 caller')).toBe(91n);
            } finally {runtime.dispose();}
        }
    });

    it('keeps ordinary budgeted execution', () => {
        const runtime = new Interpreter(() => {});
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`Data = array 1 2
fun N extent
 return N + (Data len)
end`);
            expect(() => withDemandBudget(50, () => diagnostics.run(() => runtime.execute(`for I in 1 to 100
 Result = I extent
end`)))).toThrow(DemandBudgetExhausted);
        } finally {runtime.dispose();}
    });
});
