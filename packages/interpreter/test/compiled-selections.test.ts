import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type InterpreterOptions } from '../src/index.js';

function execute(source: string, compilation: boolean, options: InterpreterOptions = {}) {
    const output: string[] = [];
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const runtime = new Interpreter(line => output.push(String(line)), { ...options, compilation });
    let result: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try { const value = runtime.execute(source); result = value === undefined ? undefined : formatValue(value); }
            catch (cause) { if (!(cause instanceof RankError)) throw cause; error = cause.format(); }
        });
        return { result, error, output, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string, backend?: string) {
    const reference = execute(source, false), compiled = execute(source, true);
    const observable = ({ result, error, output }: ReturnType<typeof execute>) => ({ result, error, output });
    expect(observable(compiled)).toEqual(observable(reference));
    if (backend) expect(compiled.diagnostics.compilerObservations.some(entry => entry.backend === backend
        && entry.phase === 'execute' && entry.outcome === 'selected'), JSON.stringify(observable(compiled))).toBe(true);
    return compiled;
}
const matrix = 'use sequences\nM = (0 till 24) reshape 2 3 4\n';

describe('compiled selection boundaries', () => {
    it.each(['M 1', 'M 1 2', 'M # 1 #', 'M (array 1 0 1) # (array 3 1)',
        'M (array true false) # #', 'M (array false false) # #',
        'M 1 (0 till 2) #', '(M 1) (array 2 0)',
        'M (array 1 0) # (array 3 0) rank 0 # 0'])('keeps values and shapes: %s', selection => {
        const result = compare(matrix + `Selected = ${selection}\ntuple (Selected shape) Selected`, 'selection-expression');
        expect(result.error).toBeUndefined();
    });
    it.each(['array 1.5 2.5 3.5 4.5', 'array true false true false', 'array "a" "b" "c" "d"',
        'array (record\n .count = 1\nend) (record\n .count = 2\nend) (record\n .count = 3\nend) (record\n .count = 4\nend)'])(
        'supports element representation %s', values => {
            expect(compare(`use sequences\nM = (${values}) reshape 2 2\nM # (array 1 0 1)`, 'selection-expression').error).toBeUndefined();
        });
    it('keeps a strided selection alive across source writes', () => {
        expect(compare(matrix + 'Saved = M # 1 #\nM # 1 # = 99\ntuple Saved M', 'selection-write').error).toBeUndefined();
    });
    it.each(['=', '+=', '-=', '*='])('supports repeated scatter %s', operator => {
        const result = compare(`use sequences\nM = (array 2 3 4) reshape 1 3\nSaved = M\nKeys = array 1 1 2\nM 0 Keys ${operator} array 5 6 7\ntuple M Saved`, 'selection-write');
        expect(result.error).toBeUndefined();
    });
    it.each(['+=', '-=', '*='])('supports repeated accumulating scatter %s', operator => {
        expect(compare(`M = array 2 3 4\nKeys = array 1 1 2\nM Keys ${operator} array 5 6 7 .accumulate\nM`, 'selection-write').error).toBeUndefined();
    });
    it('compiles paired scatter and keeps Cartesian scatter separate', () => {
        expect(compare(matrix + 'M (array 1 0) # (array 3 0) rank 0 # 0 = 77\nM', 'selection-write').error).toBeUndefined();
    });
    it.each(['M 9', 'M (array true false true)', 'M 0 0 9', 'M (array 0 3) # #',
        'M 0 0 0 0', 'M 0.5', 'M # 0 = array 1 2 3', 'M # 8 = 1'])(
        'preserves errors: %s', expression => {
            expect(compare(matrix + expression).error).toBeDefined();
        });
    it('resumes effectful source and selectors once in source order', () => {
        const result = compare(`use io
use sequences
fun N source
 "source" print
 return (0 till 6) reshape 2 3
end
fun N pick
 N print
 return N
end
(0 source) (1 pick) (2 pick)`, 'selection-expression');
        expect(result.result).toBe('5');
        expect(result.output).toEqual(['source', '1', '2']);
    });
    it('validates the address before evaluating the write RHS', () => {
        const result = compare(`use io
fun N pick
 N print
 return N
end
M = array shape 2 3 fill 0
M (9 pick) (1 pick) = (7 pick)`);
        expect(result.error).toBeDefined();
        expect(result.output).toEqual(['9', '1']);
    });
    it('resumes write selectors and RHS once', () => {
        const result = compare(`use io
fun N pick
 N print
 return N
end
M = array shape 2 3 fill 0
M (1 pick) (2 pick) = (7 pick)
M 1 2`, 'selection-write');
        expect(result.result).toBe('7');
        expect(result.output).toEqual(['1', '2', '7']);
    });
    it('unpacks an effectful coordinate selector once', () => {
        const result = compare(`use io
fun N coordinates
 N print
 return array 1 2
end
M = array shape 2 3 fill 0
M unpack (7 coordinates) = 9
M 1 2`, 'selection-write');
        expect(result.result).toBe('9');
        expect(result.output).toEqual(['7']);
    });
    it('passes a strided view through a helper without mutating its source', () => {
        const result = compare(matrix + `fun Cells changed
 Cells # 0 = 99
 return Cells
end
Saved = M # 1 #
Changed = Saved changed
tuple Saved Changed (M 0 1 0)`, 'framed-function');
        expect(result.error).toBeUndefined();
    });
    it('preserves descending range and signed selector semantics', () => {
        expect(compare('M = array shape 2 5 fill 0\nM # (4 to 0 by -2) = 7\nM', 'selection-write').error).toBeUndefined();
        expect(compare('M = array shape 2 5 fill 0\nI = 1\nM # -I = 7').error).toMatch(/nonnegative/);
    });
    it('runs partial-axis control in a compiled body and isolates cells', () => {
        const result = compare(matrix + `Total = 0
for Cell I in M axis 1
 if I equal 1
  continue
 end
 Total += Cell 1 2
 Cell 0 0 = 99
end
tuple Total (M 0 0 0)`, 'value-block');
        expect(result.result).toBe('36 0');
    });
    it('does not force later lazy cells after break', () => {
        const result = compare(`use io
use sequences
M = (1 to 6) reshape 2 3
fun X observed
 X print
 return X
end
Lazy' = M observed rank 0
for Col in Lazy axis 1
 break
end`, 'value-block');
        expect(result.output).toEqual(['1', '4']);
    });
    it.each(['0 3', '2 0'])('keeps empty cells and empty frames distinct for shape %s', shape => {
        const result = compare(`use io
M = array shape ${shape} fill 1
for Cell I in M axis 0
 (Cell len) print
end`);
        expect(result.output).toEqual(shape === '0 3' ? [] : ['0', '0']);
    });
    it('preserves selection behavior when dynamic code is unavailable', () => {
        const blocked = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try {
            const result = compare(matrix + 'M # 1 # = 5\nM # 1 #');
            expect(result.error).toBeUndefined();
            expect(result.diagnostics.compilerObservations.some(entry =>
                entry.reasons.includes('selection-write:dynamic-code-unavailable'))).toBe(true);
        } finally { blocked.mockRestore(); }
    });
    it('reports the operand budget and retains valid high-rank addressing', () => {
        const shape = Array(65).fill('1').join(' '), indices = Array(65).fill('0').join(' ');
        const result = compare(`M = array shape ${shape} fill 7\nM ${indices}`);
        expect(result.result).toBe('7');
        expect(result.diagnostics.compilerObservations.some(entry =>
            entry.reasons.includes('selection-expression:selector-budget'))).toBe(true);
    });
    it('disables generated selector paths with compilation off', () => {
        const result = execute(matrix + 'M # 1 # = 5\nM # 1 #', false);
        expect(result.diagnostics.compilerObservations.some(entry => entry.backend.startsWith('selection-'))).toBe(false);
    });
});
