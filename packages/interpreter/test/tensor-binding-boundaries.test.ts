import { describe, expect, it } from 'vitest';
import { Interpreter, parse } from '../src/index.js';
import { ownedArray, writeArrayCell, readArrayItem } from '../src/array-storage.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';

it('does not treat a following reduction as part of an ordinary or deferred assignment', () => {
    for (const marker of ['', "'"]) {
        const program = parse(`Mapped${marker} = Input * 2\nTotal = Mapped sum`);
        expect(compileTensorKernel(program.statements[0], {
            lookup: () => ownedArray([1n, 2n, 3n]), builtin: () => true,
        })).toBeUndefined();
    }
});

it.each(['**=', '/=', '//=', 'mod=', 'and=', 'or=', 'xor='])(
    'does not replace the unsupported compound operation %s with an ordinary reduction binding', operator => {
        const statement = parse(`Total ${operator} (Input * 2) sum`).statements[0];
        expect(compileTensorKernel(statement, {
            lookup: () => ownedArray([1n, 2n, 3n]), builtin: () => true,
        })).toBeUndefined();
    });

describe.each([false, true])('tensor binding boundaries (block compilation=%s)', blockCompilation => {
    it('completes the prior assignment before compiling the next expression', () => {
        const input = ownedArray([1n, 2n, 3n]);
        let compilations = 0, entries = 0;
        const runtime = new Interpreter(undefined, { blockCompilation, scalarFunctionCompilation: false,
            onTensorKernelCompiled() {
                compilations++;
                // Host reentry happens at the next expression, after Doubled
                // has acquired independent completed storage.
                writeArrayCell(input, 0, 99n);
            },
            onTensorKernelExecuted: () => entries++,
        });
        runtime.variables.set('Input', input);
        try {
            expect(runtime.execute(`fun Input calculate
  Doubled = Input * 2
  return (Doubled + 1) sum
end
Input calculate`)).toBe(15n);
            expect(readArrayItem(input, 0)).toBe(99n);
            expect(compilations).toBe(1);
            expect(entries).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('retains each ordinary stage instead of emitting a grouped reduction', () => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { blockCompilation, scalarFunctionCompilation: false,
            onTensorKernelExecuted: () => entries++,
        });
        try {
            expect(runtime.execute(`fun Input calculate
  Doubled = Input * 2
  Shifted = Doubled + 1
  return Shifted sum
end
(array 1 2 3) calculate`)).toBe(15n);
            expect(entries).toBe(0);
        } finally { runtime.dispose(); }
    });
});
