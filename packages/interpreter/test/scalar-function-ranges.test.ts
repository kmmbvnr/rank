import { describe, expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';

const limit = BigInt(Number.MAX_SAFE_INTEGER);
const cases = [
    [0n, 3n, 1n], [3n, 0n, -1n], [1n, 1n, 1n], [3n, 0n, 1n],
    [-5n, 5n, 3n], [5n, -5n, -3n],
    [limit - 2n, limit, 1n], [-limit, -limit + 2n, 1n],
    [limit + 1n, limit + 3n, 1n], [-limit - 3n, -limit - 1n, 1n],
    [-limit, limit, limit], [0n, limit * 3n, limit + 1n],
] as const;

for (const indexed of [false, true]) describe(`scalar range induction (ordinal ${indexed})`, () => {
    for (const terminal of ['to', 'till']) it.each(cases)(
        `matches reference ${terminal} from %s to %s step %s`, (start, end, step) => {
            const source = `fun Start End Step helper
I = -999
Ord = -999
Count = 0
Sum = 0
for I ${indexed ? 'Ord ' : ''}in Start ${terminal} End by Step
 Count += 1
 if Count equal 2
  continue
 end
 Sum += I
 if Count equal 4
  break
 end
end
return array Sum I Ord Count
end`;
            const statement = parse(source).statements[0];
            if (!isFunctionStatement(statement)) throw new Error('expected function');
            const kernel = compileScalarFunction(statement, undefined, true);
            expect(kernel).toBeDefined();
            const reference = new Interpreter(undefined, { scalarCompilation: false, scalarEntryCompilation: false,
                scalarFunctionCompilation: false, integerLoopCompilation: false, blockCompilation: false });
            try {
                const expected = reference.execute(`${source}\n${start} ${end} ${step} helper`)!;
                const actual = kernel!.run([start, end, step], error => error);
                expect(formatValue(actual)).toBe(formatValue(expected));
            } finally { reference.dispose(); }
        });

    it('rejects a zero step without entering the body', () => {
        const statement = parse(`fun Step helper\nfor I ${indexed ? 'Ord ' : ''}in 0 to 3 by Step\n return I\nend\nreturn -1\nend`).statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const kernel = compileScalarFunction(statement, undefined, true)!;
        expect(() => kernel.run([0n], error => error)).toThrow('range step must be a nonzero integer');
    });
});

it('keeps nested loop assignments and integer arithmetic exact', () => {
    const source = `fun Start helper
Sum = 0
for I in Start till Start + 3
 for J in 0 till 2
  I += 1
  Sum += I * 9007199254740993 + J
 end
end
return Sum
end`;
    const statement = parse(source).statements[0];
    if (!isFunctionStatement(statement)) throw new Error('expected function');
    const kernel = compileScalarFunction(statement, undefined, true)!;
    const reference = new Interpreter(undefined, { scalarCompilation: false, scalarEntryCompilation: false,
        scalarFunctionCompilation: false, integerLoopCompilation: false, blockCompilation: false });
    try {
        reference.execute(source);
        // Reuse one generated function across both induction representations.
        for (const start of [1n, limit + 1n, -2n]) {
            expect(kernel.run([start], error => error)).toBe(reference.execute(`${start} helper`));
        }
    } finally { reference.dispose(); }
});
