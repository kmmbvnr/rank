import { describe, expect, it } from 'vitest';
import { compiledOperators } from '@arrrank/language';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(expression: string, left: string, right: string, boolean: boolean, tensorFusion: boolean) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, {
        tensorFusion, onTensorKernelExecuted: () => kernels++,
    });
    try {
        const value = runtime.execute(`use sequences
fun A B probe
  Mapped' = ${expression}
  return Mapped ${boolean ? 'count' : 'sum'}
end
A = ${left}
B = ${right}
A B probe`);
        return { value: formatValue(value!), kernels };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), kernels };
    } finally { runtime.dispose(); }
}

const samples = { integer: 'array 2 3', real: 'array 2.0 3.0', boolean: 'array true false' };
const spelling: Record<string, string> = { atmost: 'at most', atleast: 'at least', notequal: 'not equal' };

describe('tensor catalogue overloads', () => {
    for (const operation of compiledOperators) {
        for (const signature of operation.tensor ?? []) {
            const name = spelling[operation.name] ?? operation.name;
            const expression = signature.inputs.length === 1 ? `${name} A` : `A ${name} B`;
            it(`executes ${operation.name}(${signature.inputs.join(', ')}) with the reference result`, () => {
                const left = samples[signature.inputs[0]], right = samples[signature.inputs[1] ?? signature.inputs[0]];
                const reference = run(expression, left, right, signature.result === 'boolean', false);
                const compiled = run(expression, left, right, signature.result === 'boolean', true);
                expect(reference).not.toHaveProperty('error');
                expect({ ...compiled, kernels: 0 }).toEqual(reference);
                expect(compiled.kernels).toBe(1);
            });
        }
    }

    it.each(['//', 'mod'])('preserves signed integer %s and zero-divisor errors', operator => {
        for (const [a, b] of [['-13', '5'], ['13', '-5'], ['-13', '-5'], ['13', '5'],
            ['-10', '5'], ['9007199254740993', '-7'], ['1', '0']]) {
            const left = `array (${a}) (${a})`, right = `array (${b}) (${b})`;
            const reference = run(`A ${operator} B`, left, right, false, false);
            const compiled = run(`A ${operator} B`, left, right, false, true);
            expect({ ...compiled, kernels: 0 }).toEqual(reference);
            if (b !== '0') expect(compiled.kernels).toBe(1);
            else expect(compiled.error).toContain('division by zero');
        }
    });

    it.each([
        ['A equal B', samples.boolean, samples.boolean, true],
        ['A less B', samples.integer, samples.real, true],
        ['A // B', samples.real, samples.real, false],
        ['A mod B', samples.real, samples.real, false],
        ['A ** B', samples.integer, 'array -1 -2', false],
    ] as const)('preserves fallback for %s on %s and %s', (expression, left, right, boolean) => {
        const reference = run(expression, left, right, boolean, false);
        const compiled = run(expression, left, right, boolean, true);
        expect(compiled).toEqual(reference);
        expect(compiled.kernels).toBe(0);
    });
});
