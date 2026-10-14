import { expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

// Disable every compiled tier, as inspection does, while leaving debugger state alone.
const referenceOptions: InterpreterOptions = {
    integerLoopCompilation: false, scalarFunctionCompilation: false, scalarEntryCompilation: false,
    blockCompilation: false, scalarCompilation: false, tensorFusion: false,
    arrayFunctionCompilation: false, rankedArrayCompilation: false, functionBodyCompilation: false,
    tensorCellCompilation: false,
};

function execute(source: string, compiled: boolean) {
    const output: string[] = [];
    let loops = 0;
    const runtime = new Interpreter(line => output.push(line), {
        ...compiled ? {} : referenceOptions,
        onIntegerLoopExecuted: () => loops++,
    });
    let value: string | undefined, error: string | undefined;
    try {
        const result = runtime.execute(source);
        value = result === undefined ? undefined : formatValue(result);
    } catch (caught) {
        if (!(caught instanceof RankError)) throw caught;
        error = caught.format();
    }
    const variables = [...runtime.variables].map(([name, item]) => [name, formatValue(item)]);
    runtime.dispose();
    return { result: { value, error, output, variables }, loops };
}

it.each([
    ['tensor indices', `use sequences
M = ((1 to 8) array) reshape 2 2 2
Total = 0
for Value Row Column Depth in M rank 0
  Total += Value + Row + Column + Depth
end
Total`, '48'],
    ['tensor placeholders', `use sequences
M = ((1 to 4) array) reshape 2 2
Total = 0
for # Row Column in M rank 0
  Total += Row + Column
end
Total`, '4'],
    ['effects and continue', `use io
Total = 0
for Value in 1 to 4
  if Value equal 2
    continue
  end
  Total += Value
  Total print
end
Total`, '8'],
    ['conditional loop', `I = 0
Total = 0
for I less 1000
  I += 1
  Total += I
end
Total`, '500500'],
    ['arity error', `use io
"before" print
M = array 1 2
for Value Row Column in M
end`, undefined],
] as const)('%s agrees across compilation modes', (name, source, expected) => {
    const reference = execute(source, false);
    const compiled = execute(source, true);
    expect(compiled.result).toEqual(reference.result);
    expect(compiled.result.value).toBe(expected);
    expect(reference.loops).toBe(0);
    if (name === 'conditional loop') expect(compiled.loops).toBeGreaterThan(0);
    if (name === 'arity error') {
        expect(compiled.result.error).toContain('value/index names');
        expect(compiled.result.output).toEqual(['before']);
    } else expect(compiled.result.error).toBeUndefined();
    if (name === 'effects and continue') expect(compiled.result.output).toEqual(['1', '4', '8']);
});
