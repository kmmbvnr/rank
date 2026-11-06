import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';

function execute(body: string, input: string, compilation = true, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false, numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const inputValue = runtime.execute(input);
        if (inputValue === undefined || !isRankArray(inputValue)) throw Error('expected array input');
        runtime.variables.set('InputValue', typedArray(BigInt64Array.from(inputValue.items as bigint[]), inputValue.shape));
        const value = diagnostics.run(() => runtime.execute(`use sequences
fun Input calculate
 ${body}
end
Value = 0
for Once in 1 to 1
 Value = InputValue calculate
end
Value`));
        return { result: { value: formatValue(value!) }, diagnostics };
    } catch (error) {
        return { result: { error: error instanceof RankError ? error.format() : String(error) }, diagnostics };
    } finally { runtime.dispose(); }
}

it.each([
    ["Store = array shape 3 fill 1\n Alias = Store\n Values' = Store * 2\n Alias 0 = 99\n Value = Values sum\n return Value + Alias 0", '(array 1)'],
    ["Values' = Input * 2\n Value = Values sum\n return Value", '(array 1 2 3)'],
    ["Values' = -Input\n Value = Values sum\n return Value", '(array -1 2 3)'],
    ["Values' = Input // 2\n Value = Values sum\n return Value", '(array -3 -1 1 3)'],
    ["Values' = Input mod 2\n Value = Values sum\n return Value", '(array -3 -1 1 3)'],
    ["Values' = Input + (array 10)\n Value = Values sum\n return Value", '(array 1 2 3)'],
    ["Products' = Input Input outer *\n Rows' = Products sum rank 1\n Value = Rows sum\n return Value", '(array 1 2 3)'],
    ["Matches' = Input Input outer equal\n Counts' = Matches count rank 1\n Value = Counts sum\n return Value", '(array 1 2 1)'],
])('lowers an integer plan with the shared Number emitter: %s', (body, input) => {
    const actual = execute(body, input);
    expect(actual.result).toEqual(execute(body, input, false).result);
    expect(actual.result.error).toBeUndefined();
    expect(actual.diagnostics.numberFunctions).toBeGreaterThan(0);
    expect(actual.diagnostics.numberFunctionFallbacks).toBe(0);
});

it.each([
    ["Values' = Input * 2\n Value = Values sum\n return Value", '(array 9007199254740991 1)'],
    ["Values' = Input + 0\n Value = Values sum\n return Value", '(array 9007199254740991 1 -1)'],
    ["Values' = -Input\n Value = Values sum\n return Value", '(array -9007199254740992)'],
])('replays unsafe plan intermediates exactly: %s', (body, input) => {
    const actual = execute(body, input);
    expect(actual.result).toEqual(execute(body, input, false).result);
    expect(actual.result.error).toBeUndefined();
    expect(actual.diagnostics.numberFunctionFallbacks + actual.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});

it.each([
    ["Values' = Input // 0\n Value = Values sum\n return Value", '(array 1 2)'],
    ["Values' = Input + (array 1 2)\n Value = Values sum\n return Value", '(array 1 2 3)'],
    ["Values' = Input + (1 // 0)\n Value = Values sum\n return Value", '(array shape 0 fill 1)'],
])('preserves plan error location and demand order: %s', (body, input) => {
    const actual = execute(body, input);
    expect(actual.result).toEqual(execute(body, input, false).result);
    expect(actual.result.error).toBeDefined();
    expect(execute(body, input, true, false).result).toEqual(execute(body, input, false).result);
});


it('preserves an empty consumed plan without entering a numeric traversal', () => {
    const body = "Values' = Input * 2\n Value = Values sum\n return Value";
    const input = '(array shape 0 fill 1)';
    expect(execute(body, input).result).toEqual(execute(body, input, false).result);
    expect(execute(body, input).result.value).toBe('0');
});


it.each([
    "Values' = Input * 2\n return Values sum",
    "Values' = Input * 2\n Value = Values sum\n return Value",
])('consumes a returned plan at the same numeric boundary: %s', body => {
    const actual = execute(body, '(array 1 2 3)');
    expect(actual.result).toEqual(execute(body, '(array 1 2 3)', false).result);
    expect(actual.result.value).toBe('12');
    expect(actual.diagnostics.numberFunctions).toBeGreaterThan(0);
    expect(actual.diagnostics.numberLoopOverflows).toBe(0);
});

it.each([
    "Values' = Input // 0\n return Values sum",
    "Values' = Input + (array 1 2)\n return Values sum",
])('keeps demand errors outside a returned helper frame: %s', body => {
    const reference = execute(body, '(array 1 2 3)', false).result;
    expect(reference.error).toBeDefined();
    expect(execute(body, '(array 1 2 3)').result).toEqual(reference);
    expect(execute(body, '(array 1 2 3)', true, false).result).toEqual(reference);
});


it.each([
    'Value = InputValue forward',
    'Value = (InputValue forward) + (0 failure)',
    "Saved' = InputValue forward\n Value = 1",
])('preserves demand order across a forwarding helper: %s', statement => {
    const results = [false, true].map(compilation => {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        runtime.variables.set('InputValue', typedArray(new Int32Array([1, 2]), [2]));
        try {
            const value = runtime.execute(`fun Input deferred_value
 Values' = Input // 0
 return Values sum
end
fun Input forward
 return Input deferred_value
end
fun X failure
 return 1 // X
end
Value = 0
for Once in 1 to 1
 ${statement}
end
Value`);
            return { value: formatValue(value!) };
        } catch (error) {
            return { error: error instanceof RankError ? error.format() : String(error) };
        } finally { runtime.dispose(); }
    });
    expect(results[1]).toEqual(results[0]);
    if (statement.startsWith('Saved')) expect(results[1].value).toBe('1');
    else expect(results[1].error).toBeDefined();
});

it.each([
    ["return (Input (array 2 0 2)) sum", '(array 10 20 30)'],
    ["Slots' = Input mod 3\n return (Input Slots) sum", '(array 2 0 1)'],
    ["Slots' = Input - 1\n return (Input Slots) sum", '(array 1 2 3)'],
])('compiles a stored vector gather into a helper reduction: %s', (body, input) => {
    const actual = execute(body, input);
    expect(actual.result).toEqual(execute(body, input, false).result);
    expect(actual.result.error).toBeUndefined();
    expect(actual.diagnostics.numberFunctions).toBeGreaterThan(0);
    expect(actual.diagnostics.numberFunctionFallbacks).toBe(0);
    expect(execute(body, input, true, false).result).toEqual(execute(body, input, false).result);
});

it.each([
    ["return (Input (array -1 0)) sum", '(array 10 20 30)'],
    ["return (Input (array 0 3)) sum", '(array 10 20 30)'],
    ["Slots' = Input // (array 1 0)\n return (Input Slots) sum", '(array 10 20)'],
    ["return (Input (array 0 1)) sum", '(array 9007199254740991 1)'],
    ["Unused' = Input (array -1)\n return 7", '(array 10 20)'],
    ["Unused = Input (array -1)\n return 7", '(array 10 20)'],
])('retains gather validation and demand timing: %s', (body, input) => {
    const reference = execute(body, input, false).result;
    expect(execute(body, input).result).toEqual(reference);
    expect(execute(body, input, true, false).result).toEqual(reference);
});

it('keeps an empty gather recipe without numeric entry evidence', () => {
    const body = "Slots' = Input + 1\n return (Input Slots) sum";
    expect(execute(body, '(array shape 0 fill 1)').result)
        .toEqual(execute(body, '(array shape 0 fill 1)', false).result);
});
