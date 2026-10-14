import { expect, it, vi } from 'vitest';
import { Interpreter, formatValue, type InterpreterOptions } from '../src/index.js';

const probes: { tier: keyof InterpreterOptions; source: string; options?: InterpreterOptions }[] = [
    { tier: 'onIntegerLoopExecuted', source: 'Sum = 0\nfor I in 1 to 20\n Sum += I\nend\nSum' },
    { tier: 'onScalarExecuted', options: { scalarEntryCompilation: false, scalarFunctionCompilation: false },
        source: 'fun calc A B\n return A * 3 + B\nend\n2 4 calc' },
    { tier: 'onScalarFunctionExecuted', source: 'use sequences\nfun palindrome X\n Text = X text\n Back = Text reverse\n return Text equal Back\nend\n121 palindrome' },
    { tier: 'onBlockExecuted', source: 'Sum = 0\nfor I in 1 to 10\n X = I * 2\n if I equal 3\n continue\n end\n if I equal 7\n break\n end\n Sum += X\nend\nSum' },
    { tier: 'onTensorKernelExecuted', source: `use sequences
fun probe A B Limit
 Result = false
 for Tick in 1 to 2
  Mask = A less Limit
  Chosen = A Mask
  Scaled = Chosen * 2
  Indices = Scaled - 1
  Gathered = B Indices
  Inverted = not Gathered
  Result = Inverted all
 end
 return Result
end
A = array 1 2 3
B = array true false true false true
A B 3 probe` },
];

it.each(probes)('executes $tier only with compilation enabled', ({ tier, source, options }) => {
    const run = (compilation: boolean) => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { ...options, compilation, [tier]: () => entries++ });
        try { return { value: formatValue(runtime.execute(source)!), entries }; }
        finally { runtime.dispose(); }
    };
    const compiled = run(true), reference = run(false);
    expect(compiled.value).toEqual(reference.value);
    expect(compiled.entries).toBeGreaterThan(0);
    expect(reference.entries).toBe(0);
});

it('disables all compilation switches even when individual tiers are explicitly enabled', () => {
    const runtime = new Interpreter(undefined, { compilation: false, tensorCellCompilation: true, scalarCompilation: true });
    try {
        for (const [name, value] of Object.entries(runtime.options)) {
            if (name.endsWith('Compilation') || name === 'tensorFusion') expect(value, name).toBe(false);
        }
    } finally { runtime.dispose(); }
});

it('inherits reference execution into imported functions and test blocks', () => {
    const compiled = vi.fn();
    const runtime = new Interpreter(undefined, { compilation: false, testing: true, onIntegerLoopExecuted: compiled,
        loadModule: () => ({ id: '/helper.ra', source: 'fun total N\n Sum = 0\n for I in 1 to N\n Sum += I\n end\n return Sum\nend' }),
    });
    try {
        expect(runtime.execute('use "helper.ra"\n10 total')).toBe(55n);
        runtime.execute('test "loop"\n Sum = 0\n for I in 1 to 10\n Sum += I\n end\n Sum equal 55\nend');
        expect(runtime.testResults).toMatchObject([{ passed: true }]);
        expect(compiled).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
});
