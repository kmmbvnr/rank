import { describe, expect, it } from 'vitest';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type InterpreterOptions } from '../src/index.js';

function run(source: string, compilation: boolean, options: InterpreterOptions = {}) {
    const output: string[] = [], sources: string[] = [];
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const runtime = new Interpreter(line => output.push(String(line)), { ...options, compilation,
        onFunctionBodyCompiled: source => sources.push(source) });
    let result: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try {
                const value = runtime.execute(source);
                if (value !== undefined) result = formatValue(value);
            } catch (cause) {
                if (!(cause instanceof RankError)) throw cause;
                error = cause.format();
            }
        });
        return { result, error, output, sources, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string, functions: string[], options?: InterpreterOptions) {
    const reference = run(source, false, options), compiled = run(source, true, options);
    expect({ result: compiled.result, error: compiled.error, output: compiled.output })
        .toEqual({ result: reference.result, error: reference.error, output: reference.output });
    for (const name of functions) expect(compiled.diagnostics.compilerObservations.some(entry =>
        entry.backend === 'framed-function' && entry.phase === 'execute' && entry.source.function === name)).toBe(true);
    if (functions.length) expect(compiled.sources.some(source => source.includes('"use strict";'))).toBe(true);
    return compiled;
}

describe('compiled function control flow with runtime frames', () => {
    it('compiles the outer body around a nested helper', () => {
        expect(compare(`fun Offset outer
 fun X shifted
  return X + Offset
 end
 Result = 3 shifted
 return Result + 1
end
4 outer`, ['outer']).result).toBe('8');
    });
    it('keeps independent closure invocations and current capture values', () => {
        expect(compare(`fun Offset outer
 fun X shifted
  return X + Offset
 end
 First = 3 shifted
 Offset += 1
 Second = 3 shifted
 return First + Second
end
First = 4 outer
Second = 10 outer
First + Second`, ['outer']).result).toBe('42');
    });
    it('compiles both ends of a mutually recursive tail graph', () => {
        expect(compare(`fun N even
 if N equal 0
  return true
 end
 return (N - 1) odd
end
fun N odd
 if N equal 0
  return false
 end
 return (N - 1) even
end
100 even`, ['even', 'odd'], { maxCallDepth: 1 }).result).toBe('true');
    });
    it('resumes a non-tail mutual graph without replaying effects', () => {
        const result = compare(`use io
fun N first
 N print
 if N equal 0
  return 0
 end
 return ((N - 1) second) + 1
end
fun N second
 N print
 if N equal 0
  return 0
 end
 return ((N - 1) first) + 1
end
4 first`, ['first', 'second']);
        expect(result.result).toBe('4');
        expect(result.output).toEqual(['4', '3', '2', '1', '0']);
    });
    it('retains branch-local scopes and the location of an invalid escaping name', () => {
        expect(compare(`fun N outer
 fun X shifted
  return X + N
 end
 if N greater 0
  Hidden = 1 shifted
 end
 return Hidden
end
2 outer`, []).error).toContain('does not exist after it');
    });
    it('handles nested elif/else branches and early returns', () => {
        for (const value of [-1, 0, 1, 2]) compare(`fun N outer
 fun X shifted
  return X + N
 end
 if N less 0
  return 0 shifted
 elif N equal 0
  return 1 shifted
 else
  if N equal 1
   return 2 shifted
  else
   return 3 shifted
  end
 end
end
${value} outer`, ['outer']);
    });
    it('preserves recursive call-depth errors', () => {
        expect(compare(`fun N first
 if N equal 0
  return 0
 end
 return ((N - 1) second) + 1
end
fun N second
 if N equal 0
  return 0
 end
 return ((N - 1) first) + 1
end
8 first`, ['first', 'second'], { maxCallDepth: 3 }).error).toContain('function call depth exceeds 3');
    });
    it('preserves protected capture errors and function retention rules', () => {
        for (const body of ['Offset = X\n  return Offset', 'return shifted']) {
            compare(`fun Offset outer
 fun X shifted
  ${body}
 end
 Value = 3 shifted
 return Value
end
4 outer`, []);
        }
    });
    it('keeps array aliases, returned values and callback forwarding', () => {
        expect(compare(`use sequences
fun X apply op
 return X op
end
fun Offset outer
 fun X pair
  return array X (X + Offset)
 end
 Values = 3 apply pair
 Before = Values copy
 Values 0 = 9
 return array (Before sum) (Values sum)
end
4 outer`, ['outer']).result).toBe('10 16');
    });
    for (const rank of [0, 1]) for (const value of ['3', '3.5']) for (const forwarded of [false, true]) {
        it(`composes rank ${rank}, input ${value}, forwarding ${forwarded}`, () => {
            compare(`fun X apply op
 return (X op) + 1
end
fun Offset outer
 fun X shifted rank ${rank}
  return X + Offset
 end
 if Offset greater 0
  Result = ${value} ${forwarded ? 'apply shifted' : 'shifted'}
  return Result + 1
 else
  return 0
 end
end
4 outer`, ['outer']);
        });
    }
    it('keeps lexical shadowing across multiple nested declarations', () => {
        expect(compare(`fun Offset outer
 fun Offset middle
  fun X shifted
   return Offset + X
  end
  Result = 1 shifted
  return Result
 end
 First = 3 middle
 Second = 5 middle
 return First + Second
end
9 outer`, ['outer', 'middle']).result).toBe('10');
    });
    it('preserves return contracts across a recursive graph', () => {
        expect(compare(`fun N first
 if N equal 0
  return 0
 end
 return (N - 1) second
end
fun N second
 if N equal 0
  return "text"
 end
 return (N - 1) first
end
Before = 1 first
After = 2 first
After`, ['first', 'second']).error).toBeDefined();
    });
    it.each([false, true])('cancels without replaying output and restores the caller frame (compiled=%s)', compilation => {
        const signal = new Int32Array(new SharedArrayBuffer(4)), output: string[] = [];
        const runtime = new Interpreter(line => {
            output.push(String(line));
            if (output.length === 3) Atomics.store(signal, 0, 1);
        }, { compilation });
        try {
            expect(() => withInterrupt(signal, () => runtime.execute(`use io
fun N first
 N print
 if N equal 0
  return 0
 end
 return (N - 1) second
end
fun N second
 N print
 if N equal 0
  return 0
 end
 return (N - 1) first
end
6 first`))).toThrow(InterruptedError);
            expect(output).toEqual(['6', '5', '4']);
            Atomics.store(signal, 0, 0);
            expect(runtime.execute('2 + 3')).toBe(5n);
        } finally { runtime.dispose(); }
    });
    it('keeps protected callouts and finally effects around suspended calls', () => {
        const result = compare(`use io
fun N visit
 fun X identity
  return X
 end
 if N equal 0
  return 42 identity
 end
 try
  return (N - 1) visit
 finally
  N print
 end
 return 0
end
3 visit`, ['visit']);
        expect(result.result).toBe('42');
        expect(result.output).toEqual(['1', '2', '3']);
    });
    it('honors the function-body capability switch', () => {
        const result = run(`fun Offset outer
 fun X shifted
  return X + Offset
 end
 Result = 3 shifted
 return Result + 1
end
4 outer`, true, { functionBodyCompilation: false });
        expect(result.result).toBe('8');
        expect(result.diagnostics.compiledFramedFunctions).toBe(0);
    });
    it('resumes a large body after a numeric prefix without replaying writes', () => {
        expect(compare(`fun N total
 Total = 0
${Array.from({ length: 70 }, () => ' Total += 1').join('\n')}
 for I in 1 to N
  Total += I
 end
 if N greater 0
  Total += 1
 end
 return Total
end
4 total`, []).result).toBe('81');
    });
    it('bounds generated code and retains the ordinary large-body path', () => {
        const result = compare(`fun Offset outer
 fun X shifted
  return X + Offset
 end
 Total = 0
${Array.from({ length: 260 }, () => ' Total += 1').join('\n')}
 return Total
end
4 outer`, []);
        expect(result.result).toBe('260');
        expect(result.diagnostics.compiledFramedFunctions).toBe(0);
        expect(result.diagnostics.compilerObservations.some(entry => entry.backend === 'framed-function'
            && entry.reasons.some(reason => reason.includes('statement-budget')))).toBe(true);
    });

});
