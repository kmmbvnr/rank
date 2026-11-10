import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isNativeFunction } from '../src/index.js';

function execute(source: string, compilation: boolean) {
    const output: string[] = [];
    const runtime = new Interpreter(value => output.push(String(value)), { compilation });
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    try {
        let result: string | undefined, error: string | undefined;
        diagnostics.run(() => {
            try { const value = runtime.execute(source); result = value === undefined ? undefined : formatValue(value); }
            catch (cause) {
                if (!(cause instanceof RankError)) throw cause;
                error = cause.format();
            }
        });
        return { result, error, output, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string, compiledFunction?: string) {
    const reference = execute(source, false), compiled = execute(source, true);
    expect({ result: compiled.result, error: compiled.error, output: compiled.output }).toEqual({ result: reference.result, error: reference.error, output: reference.output });
    if (compiledFunction) expect(compiled.diagnostics.compilerObservations.some(entry =>
        entry.source.function === compiledFunction && /^scalar-function(?:-|$)/.test(entry.backend)
        && entry.phase === 'execute' && ['selected', 'threw'].includes(entry.outcome))).toBe(true);
    return compiled;
}

describe('function composition', () => {
    it.each(['0', '1', '-1'])('links scalar cells through declared rank %s', rank => {
        expect(compare(`fun X square rank ${rank}
 return X * X
end
fun X helper
 return (X square) + 1
end
3 helper`, 'helper').result).toBe('10');
    });
    it.each(['1', '2'])('links whole Unicode text through declared rank %s', rank => {
        expect(compare(`fun Text size rank ${rank}
 return Text len
end
fun Text helper
 return (Text size) + 1
end
"A😀" helper`, 'helper').result).toBe('3');
    });
    it.each(['0', '-1'])('keeps text rank %s mapping at the ranked boundary', rank => {
        compare(`fun Text size rank ${rank}
 return Text len
end
fun Text helper
 return Text size
end
"A😀" helper`);
    });
    it.each(['3', '9007199254740993', '2.5'])('specializes a function argument with input %s', value => {
        compare(`fun X square
 return X * X
end
fun X apply op
 return (X op) + 1
end
${value} apply square`, 'apply');
    });
    it('changes callable identity without reusing the previous target', () => {
        expect(compare(`fun X square
 return X * X
end
fun X doubled
 return X + X
end
fun X apply op
 return (X op) + 1
end
First = 3 apply square
Second = 3 apply doubled
Third = 4 apply square
First + Second + Third`, 'apply').result).toBe('34');
    });
    it('retains captured values for nested callable arguments', () => {
        expect(compare(`fun X apply op
 return (X op) + 1
end
fun Offset outer
 fun X shifted
  return X + Offset
 end
 return 3 apply shifted
end
First = 4 outer
Second = 10 outer
First + Second`, 'apply').result).toBe('22');
    });
    it('preserves errors in a linked function argument', () => {
        expect(compare(`fun X inverse
 return 10 // X
end
fun X apply op
 return X op
end
0 apply inverse`, 'apply').error).toContain('zero');
    });
    it('preserves ranked callable argument dispatch', () => {
        expect(compare(`fun X square rank 0
 return X * X
end
fun X apply op
 return (X op) + 1
end
3 apply square`, 'apply').result).toBe('10');
        compare(`fun X square rank 0
 return X * X
end
fun Values apply op
 return Values op
end
(array 1 2 3) apply square`);
    });
    it('forwards callable parameters through another helper', () => {
        expect(compare(`fun X square
 return X * X
end
fun X apply op
 return X op
end
fun X forward op
 return (X apply op) + 1
end
3 forward square`, 'forward').result).toBe('10');
    });
    it('keeps side effects in their ordinary order at an unsupported callable boundary', () => {
        const result = compare(`use io
fun X loud
 X print
 return X + 1
end
fun X apply op
 return (X op) + (X op)
end
3 apply loud`);
        expect(result.result).toBe('8');
        expect(result.output).toEqual(['3', '3']);
    });
    it('keeps a callable separate from array and scalar representations', () => {
        for (const expression of ['op + X', 'op[0]', 'op len', 'op sum']) {
            compare(`fun X square
 return X * X
end
fun X apply op
 return ${expression}
end
3 apply square`);
        }
    });
    it('preserves owned array results from a callable', () => {
        expect(compare(`fun X pair
 return array X (X + 1)
end
fun X apply op
 return X op
end
3 apply pair`, 'apply').result).toBe('3 4');
    });
    it('bounds callable specializations and keeps later functions executable', () => {
        const declarations = Array.from({ length: 20 }, (_, i) => `fun X helper${i}\n return X + ${i}\nend`).join('\n');
        const calls = Array.from({ length: 20 }, (_, i) => `Value${i} = 1 apply helper${i}`).join('\n');
        const result = compare(`fun X apply op
 return (X op) + 1
end
${declarations}
${calls}
Value19`, 'apply');
        expect(result.result).toBe('21');
        expect(result.diagnostics.compilerObservations.some(entry => entry.reasons.some(reason => reason.includes('callable-specialization-limit')))).toBe(true);
    });

    it('links recursive calls carrying the same callable', () => {
        expect(compare(`fun X square
 return X * X
end
fun Count total op
 if Count equal 0
  return 0
 end
 return (Count op) + ((Count - 1) total op)
end
4 total square`, 'total').result).toBe('30');
    });
    it('preserves errors when a closure writes an enclosing binding', () => {
        expect(compare(`fun X apply op
 return (X op) + 1
end
fun Offset outer
 Local = 10
 fun X shifted
  Local = X + Offset
  return Local
 end
 Result = 3 apply shifted
 return Result + Local
end
4 outer`).error).toBeDefined();
    });

    it('links whole array cells without applying the declared rank twice', () => {
        expect(compare(`use sequences
fun Values total rank 1
 return Values sum
end
fun Values helper
 return (Values total) + 1
end
(array 1 2 3) helper`, 'helper').result).toBe('7');
    });
    it('checks replacement of a callable implementation', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`fun X square
 return X * X
end
fun X apply op
 return (X op) + 1
end`);
            expect(runtime.execute('3 apply square')).toBe(10n);
            const fn = runtime.execute('square');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
            runtime.variables.set('square', { ...fn, call: () => 20n });
            expect(runtime.execute('3 apply square')).toBe(21n);
        } finally { runtime.dispose(); }
    });

    it('reads changed captures through a reused callable specialization', () => {
        expect(compare(`Scale = 3
fun X scaled
 return X * Scale
end
fun X apply op
 return (X op) + 1
end
Before = 2 apply scaled
Scale = 5
After = 2 apply scaled
Before + After`, 'apply').result).toBe('18');
    });

    it('links a dyadic callable with two data operands', () => {
        expect(compare(`fun Left add Right
 return Left + Right
end
fun Left Right apply op
 return Left op Right
end
3 4 apply add`, 'apply').result).toBe('7');
    });

    it('keeps the owning interpreter when a callable crosses an interpreter boundary', () => {
        const owner = new Interpreter(), caller = new Interpreter();
        try {
            const fn = owner.execute(`Scale = 8
fun X scaled
 return X * Scale
end
scaled`);
            if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
            caller.variables.set('foreign', fn);
            caller.execute(`Scale = 100
fun X apply op
 return X op
end`);
            expect(caller.execute('3 apply foreign')).toBe(24n);
            owner.execute('Scale = 9');
            expect(caller.execute('3 apply foreign')).toBe(27n);
        } finally { caller.dispose(); owner.dispose(); }
    });

});
