import { describe, expect, it } from 'vitest';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function run(source: string, compilation: boolean) {
    const output: string[] = [];
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const runtime = new Interpreter(line => output.push(line), {
        compilation, scalarEntryCompilation: false, loopYieldCompilation: false,
    });
    try {
        let value: string | undefined, error: string | undefined;
        diagnostics.run(() => {
            try {
                const result = runtime.execute(source);
                if (result !== undefined) value = formatValue(result);
            } catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        });
        return { observation: { value, error, output }, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = run(source, true);
    expect(candidate.observation).toEqual(run(source, false).observation);
    expect(candidate.observation.error).toBeUndefined();
    return candidate;
}

describe('compiled effect and suspension boundaries', () => {
    it('compiles a loop whose yield is inside a protected block', () => {
        const result = compare(`use io
fun values
 for N in 1 to 3
  try
   yield N
   "resumed" print
  finally
   N print
  end
 end
end
values 0`);
        expect(result.observation.value).toBe('1');
        expect(result.observation.output).toEqual(['1']);
        expect(result.diagnostics.compiledGeneratorLoops).toBe(1);
    });

    it('compiles an outer generator loop around a nested suspending loop', () => {
        const result = compare(`fun values
 for N in 1 to 2
  for I in 1 to 2
   yield N * 10 + I
  end
 end
end
values array`);
        expect(result.observation.value).toBe('11 12 21 22');
        expect(result.diagnostics.compiledGeneratorLoops).toBe(3);
    });

    it('stops a generated generator body after return', () => {
        const result = compare(`fun values
 for N in 1 to 3
  yield N
  return
 end
end
values array`);
        expect(result.observation.value).toBe('1');
        expect(result.diagnostics.compiledGeneratorLoops).toBe(1);
    });

    it('keeps generated function control around a protected return', () => {
        const result = compare(`use io
fun N work
 try
  N print
  return N * 2
 finally
  "closed" print
 end
end
3 work`);
        expect(result.observation.value).toBe('6');
        expect(result.observation.output).toEqual(['3', 'closed']);
        expect(result.diagnostics.compilerObservations.some(entry =>
            entry.backend === 'framed-function' && entry.phase === 'execute'
            && entry.outcome === 'completed' && entry.execution?.paths.includes('framed-function'))).toBe(true);
    });

    it('keeps generated loop control around an effectful helper', () => {
        const result = compare(`use io
fun N report
 N print
 return N + 1
end
Total = 0
for I in 1 to 3
 Before = I * I + 1
 Current = I report
 Total += Before + Current
end
Total`);
        expect(result.observation.value).toBe('26');
        expect(result.observation.output).toEqual(['1', '2', '3']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });
    it('resumes protected yields through catch and finally in order', () => {
        const result = compare(`use io
fun values
 for N in 1 to 2
  try
   yield N
   .Failure raise
  catch .Failure Error
   yield N + 10
  finally
   N print
   yield N + 20
  end
 end
end
values array`);
        expect(result.observation.value).toBe('1 11 21 2 12 22');
        expect(result.observation.output).toEqual(['1', '2']);
        expect(result.diagnostics.compiledGeneratorLoops).toBe(1);
    });

    it('unwinds protected jumps before continuing the generated loop', () => {
        const result = compare(`use io
fun values
 for N in 1 to 4
  try
   yield N
   if N equal 2
    break
   end
   continue
  finally
   N print
  end
  yield 99
 end
end
values array`);
        expect(result.observation.value).toBe('1 2');
        expect(result.observation.output).toEqual(['1', '2']);
        expect(result.diagnostics.compiledGeneratorLoops).toBe(1);
    });

    it('keeps exact arithmetic after an effect without replay', () => {
        const result = compare(`use io
fun N report
 N print
 return N
end
Total = 9007199254740990
for I in 1 to 4
 Current = I report
 Total += Current
end
Total`);
        expect(result.observation.value).toBe('9007199254741000');
        expect(result.observation.output).toEqual(['1', '2', '3', '4']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });

    it('preserves the first error and cleanup after a checked call', () => {
        const source = `use io
fun N report
 N print
 .Failure N raise
 return N
end
Total = 0
for I in 1 to 3
 try
  Current = I report
  Total += Current
 finally
  "closed" print
 end
end
Total`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toContain('Failure');
        expect(result.observation.output).toEqual(['1', 'closed']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });

    it('resumes after a callback with current captured values', () => {
        const result = compare(`use io
fun X apply op
 return X op
end
fun Offset work
 fun X report
  Offset print
  return X + Offset
 end
 Total = 0
 for I in 1 to 3
  Offset += 1
  Current = I apply report
  Total += Current + Offset
 end
 return Total
end
10 work`);
        expect(result.observation.value).toBe('78');
        expect(result.observation.output).toEqual(['11', '12', '13']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });

    it.each([false, true])('unwinds suspended protected loops on cancellation (compiled=%s)', compilation => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const output: string[] = [];
        const runtime = new Interpreter(line => {
            output.push(line);
            if (line === 'entered') Atomics.store(signal, 0, 1);
        }, { compilation, loopYieldCompilation: false });
        try {
            expect(() => withInterrupt(signal, () => runtime.execute(`use io
fun values
 for N in 1 to 3
  try
   "entered" print
   yield N
  finally
   "closed" print
  end
 end
end
values array`))).toThrow(InterruptedError);
            expect(output).toEqual(['entered', 'closed']);
            Atomics.store(signal, 0, 0);
            expect(runtime.execute('2 + 3')).toBe(5n);
        } finally { runtime.dispose(); }
    });

    it('retains array snapshots across protected suspension', () => {
        const result = compare(`use io
fun values
 Values = array shape 2 fill false
 for I in 0 to 1
  try
   yield Values
  finally
   Values (0 to I) = true
   I print
  end
 end
end
values array`);
        expect(result.observation.value).toBe('false false true false');
        expect(result.observation.output).toEqual(['0', '1']);
        expect(result.diagnostics.compiledGeneratorLoops).toBe(1);
    });

    it('does not prepare a suspending backend when a specialized consumer wins', () => {
        const sources: string[] = [];
        const runtime = new Interpreter(undefined, {
            onGeneratorLoopCompiled: source => sources.push(source),
        });
        try {
            expect(runtime.execute(`fun values
 for N in 1 to 3
  for I in 1 to 2
   yield N + I
  end
 end
end
values sum`)).toBe(21n);
            expect(sources).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('preserves deferred capture protection across a suspended callout', () => {
        const source = `fun values
 Values = array shape 2 fill false
 for I in 0 to 1
  Pending' = Values
  try
   yield Pending
  finally
   Values (0 to I) = true
  end
 end
end
values array`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toContain('Values is read-only because plan Pending reads it');
        // Capture validation rejects this body before generator execution.
        expect(result.diagnostics.compiledGeneratorLoops).toBe(0);
    });

    it('evaluates effectful operands once and in order across a callout', () => {
        const result = compare(`use io
fun N report
 N print
 return N
end
Total = 0
for I in 1 to 2
 Current = (I report) * 10 + ((I + 2) report)
 Total += Current
end
Total`);
        expect(result.observation.value).toBe('37');
        expect(result.observation.output).toEqual(['1', '3', '2', '4']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });

    it('retains the cleanup error when finally replaces a protected return', () => {
        const source = `use io
fun N work
 try
  N print
  return N * 2
 finally
  "closed" print
  .Cleanup raise
 end
end
3 work`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toContain('Cleanup');
        expect(result.observation.output).toEqual(['3', 'closed']);
        expect(result.diagnostics.compiledFramedFunctions).toBe(1);
    });

});
