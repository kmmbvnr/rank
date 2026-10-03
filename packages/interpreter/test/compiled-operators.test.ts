import { describe, expect, it } from 'vitest';
import { compiledOperators } from '@arrrank/language';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(source: string, enabled: boolean, nativeLoopCompilation = true) {
    const generated: string[] = [];
    let calls = 0;
    const runtime = new Interpreter(undefined, {
        integerLoopCompilation: enabled, nativeLoopCompilation,
        onIntegerLoopCompiled: source => generated.push(source),
        onIntegerLoopExecuted: () => calls++,
    });
    try { return { value: formatValue(runtime.execute(source)!), calls, generated }; }
    catch (error) { return { error: error instanceof RankError ? error.format() : String(error), calls, generated }; }
    finally { runtime.dispose(); }
}

const samples = { integer: '3', boolean: 'true', text: '"λ"', bytes: '"λ" bytes' };
const spelling: Record<string, string> = { atmost: 'at most', atleast: 'at least', notequal: 'not equal' };

describe('catalogue operator lowering', () => {
    for (const operation of compiledOperators) {
        for (const signature of operation.integerLoop) {
            const name = spelling[operation.name] ?? operation.name;
            const inputs = signature.inputs.map(type => samples[type]);
            const expression = inputs.length === 1 ? `${name} ${inputs[0]}` : `${inputs[0]} ${name} ${inputs[1]}`;
            it(`compiles ${expression} and matches reference execution`, () => {
                const source = `Result = ${samples[signature.result]}\nfor I in 1 to 2\nResult = ${expression}\nend\nResult`;
                const prior = run(source, false), compiled = run(source, true);
                expect(prior).not.toHaveProperty('error');
                expect(compiled.value).toEqual(prior.value);
                expect(compiled).not.toHaveProperty('error');
                expect(compiled.calls).toBe(1);
                expect(compiled.generated).toHaveLength(1);
            });

            if (signature.compound) it(`compiles ${signature.result} ${name}= with the same result`, () => {
                const source = `Result = ${samples[signature.result]}\nfor I in 1 to 2\nResult ${name}= ${inputs[1]}\nend\nResult`;
                const prior = run(source, false), compiled = run(source, true);
                expect(prior).not.toHaveProperty('error');
                expect(compiled.value).toEqual(prior.value);
                expect(compiled).not.toHaveProperty('error');
                expect(compiled.calls).toBe(1);
            });
        }
    }

    it.each(['Result = Result + "b"', 'Result += "b"'])('preserves the native-call gate for %s', update => {
        const source = `Result = "a"\nfor I in 1 to 2\n${update}\nend\nResult`;
        const reference = run(source, false), disabled = run(source, true, false), enabled = run(source, true);
        expect(disabled.value).toBe(reference.value);
        expect(enabled.value).toBe(reference.value);
        expect(disabled.calls).toBe(0);
        expect(enabled.calls).toBe(1);
    });

    it.each(['I', '-1'])('retains the literal nonnegative exponent restriction (%s)', exponent => {
        const source = `Result = 0\nfor I in 1 to 2\nResult = 3 ** (${exponent})\nend\nResult`;
        const reference = run(source, false), compiled = run(source, true);
        expect(compiled.value).toEqual(reference.value);
        expect(compiled.error).toEqual(reference.error);
        expect(compiled.calls).toBe(0);
    });
});
