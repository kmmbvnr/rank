import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';

const recursion = `fun N total
 if N equal 0
  return Offset
 end
 Next = (N - 1) total
 return Next + Offset
end`;

function execute(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { value: formatValue(value!), diagnostics };
    } finally { runtime.dispose(); }
}

it('refreshes global scalar captures between calls, including wide integers', () => {
    const source = `Offset = 9007199254740993
${recursion}
First = 4 total
Offset += 7
Second = 4 total
array First Second`;
    const result = execute(source);
    expect(result.value).toBe(execute(source, false).value);
    expect(result.diagnostics.compilerObservations.some(entry => entry.source.function === 'total'
        && entry.backend === 'scalar-function-direct' && entry.outcome === 'selected')).toBe(true);
});

it('keeps local capture instances and rebindings separate', () => {
    const source = `fun Offset outer
 ${recursion.replace(/\n/g, '\n ')}
 First = 4 total
 Offset += 7
 Second = 4 total
 return First + Second
end
First = 9007199254740993 outer
Second = 9007199254741093 outer
array First Second`;
    expect(execute(source).value).toBe(execute(source, false).value);
});

it('retains live reads when a recursive invocation hook changes the capture', () => {
    let calls = 0;
    const runtime = new Interpreter(() => {}, {
        onScalarFunctionExecuted: () => { runtime.variables.set('Offset', BigInt(++calls)); },
    });
    try {
        runtime.execute(`Offset = 1
fun N total
 Before = Offset
 if N equal 0
  return Before
 end
 Next = (N - 1) total
 return Before + Next + Offset
end`);
        expect(runtime.execute('3 total')).toBe(22n);
        expect(calls).toBe(4);
    } finally { runtime.dispose(); }
});

it('observes host Map changes after a prepared call', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`Offset = 9007199254740993\n${recursion}`);
        expect(runtime.execute('2 total')).toBe(27021597764222979n);
        Map.prototype.set.call(runtime.variables, 'Offset', 9007199254741000n);
        expect(runtime.execute('2 total')).toBe(27021597764223000n);
    } finally { runtime.dispose(); }
});

it('retains live parent captures when deep fallback executes a body hook', () => {
    function observed(disableCache: boolean) {
        let bodies = 0;
        const runtime = new Interpreter(() => {}, {
            onScalarFunctionExecuted: disableCache ? () => {} : undefined,
            onFunctionBodyExecuted: () => {
                bodies++;
                runtime.variables.set('Offset', 9007199254740993n + BigInt(bodies));
            },
        });
        try {
            runtime.execute(`Offset = 9007199254740993\n${recursion}`);
            const value = runtime.execute('200 total');
            return { value, bodies };
        } finally { runtime.dispose(); }
    }
    const reference = observed(true);
    expect(reference.bodies).toBeGreaterThan(0);
    expect(observed(false)).toEqual(reference);
});
