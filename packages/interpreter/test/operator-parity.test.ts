import { expect, it } from 'vitest';
import { isReturnStatement, isNameExpression, isFunctionStatement } from '@arrrank/language';
import { Interpreter, RuntimeDiagnostics, formatValue, parse, type RankValue } from '../src/index.js';
import { compileScalarExpression } from '../src/scalar-compiler.js';

const cases: [string, RankValue, RankValue][] = [
    ['+(A + B)', 3n, 0.5], ['+(A * B)', 0.5, 3n],
    ['not (A equal B)', 9007199254740993n, 9007199254740992],
    ['not (A less B)', 1.25, 2n], ['not (A equal B)', true, false],
    ['not (A equal B)', 'α', 'β'], ['not ((A + B) equal A)', 'α', 'β'], ['+(A / B)', 7n, 2n],
    ['+(A ** B)', 2.5, 2n], ['not (A xor B)', true, false],
    ['not (A and B)', true, false], ['not (A or B)', false, true],
];
it.each(cases)('inlines %s for %s and %s without native operator delegation', (expression, a, b) => {
    const fn = parse(`fun A calc B\nreturn ${expression}\nend`).statements[0];
    if (!isFunctionStatement(fn) || !isReturnStatement(fn.statements[0])) throw Error('expected return');
    const runtime = new Interpreter(undefined, { compilation: false });
    try {
        runtime.variables.set('A', a); runtime.variables.set('B', b);
        const expected = runtime.execute(expression);
        const fallback = () => { throw Error('unexpected operator delegation'); };
        const kernel = compileScalarExpression(fn.statements[0].value!, {
            leaf: node => isNameExpression(node) ? () => node.name === 'A' ? a : b : undefined,
            binary: fallback, unary: fallback,
        });
        expect(kernel).toBeDefined();
        expect(kernel!()).toEqual(expected);
    } finally { runtime.dispose(); }
});

it.each(['and', 'or'])('%s skips an effectful right operand only when the boolean decides it', operator => {
    for (const flag of [false, true]) {
        const results = [false, true].map(scalarCompilation => {
            const output: string[] = [];
            let entries = 0;
            const runtime = new Interpreter(text => output.push(text), {
                scalarCompilation, scalarEntryCompilation: false, scalarFunctionCompilation: false,
                integerLoopCompilation: false, tensorFusion: false,
                onScalarExecuted: () => entries++,
            });
            try {
                const value = runtime.execute(`use io\nfun effect\n "called" print\n return true\nend\nFlag = ${flag}\nnot (Flag ${operator} effect)`);
                return { value, output, entries };
            } finally { runtime.dispose(); }
        });
        expect({ ...results[1], entries: 0 }).toEqual(results[0]);
        expect(results[1].entries).toBeGreaterThan(0);
        expect(results[1].output).toHaveLength(flag === (operator === 'or') ? 0 : 1);
    }
});

it.each(['not (true and (array true false))', 'not (false or (array true false))',
    '+(3 / 0)', '+(0 ** -1)', '+((-2.0) ** 0.5)', '+(2 ** -3)',
    '+(2 ** 1025)', 'not (false and Missing)', 'not (true or Missing)'])(
    'preserves values and errors for %s', expression => {
        const run = (compilation: boolean) => {
            const runtime = new Interpreter(undefined, { compilation });
            try { return { value: runtime.execute(expression) }; }
            catch (error) { return { error: String(error) }; }
            finally { runtime.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    });


it.each(['equal', 'not equal', 'less', 'greater', 'at most', 'at least'])(
    'compiles exact mixed-domain tensor comparison %s', operator => {
        const source = `Left = array 9007199254740993 2 3\nRight = array 9007199254740992.0 2.0 4.0\nResult = (Left + 0) ${operator} Right\nResult`;
        const run = (compilation: boolean) => {
            const diagnostics = new RuntimeDiagnostics(Infinity, true);
            const runtime = new Interpreter(undefined, { compilation });
            try { return { result: diagnostics.run(() => formatValue(runtime.execute(source)!)), diagnostics }; }
            finally { runtime.dispose(); }
        };
        const compiled = run(true), reference = run(false);
        expect(compiled.result).toBe(reference.result);
        expect(compiled.diagnostics.compiledTensors).toBeGreaterThan(0);
        expect(compiled.diagnostics.compilerRejections.filter(entry => entry.reason.startsWith('tensor:operator-guard:'))).toEqual([]);
    });

it.each(['abs', 'sqrt', 'sin', 'floor', 'ceil', 'integer'])(
    'keeps compiled arithmetic around the native %s call', builtin => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { scalarEntryCompilation: false,
            scalarFunctionCompilation: false, tensorFusion: false,
            onScalarExecuted: () => entries++ });
        const source = `use numbers\nA = 4\nB = 3\n(A ${builtin}) + B * 2`;
        const reference = new Interpreter(undefined, { compilation: false });
        try {
            expect(runtime.execute(source)).toEqual(reference.execute(source));
            expect(entries).toBeGreaterThan(0);
        } finally { runtime.dispose(); reference.dispose(); }
    });

it.each([[1, Infinity], [NaN, 2], [NaN, 0], [-Infinity, 0.5], [-0, -1], [2n, -3n]])(
    'preserves exceptional power operands %s and %s', (a, b) => {
        const run = (scalarCompilation: boolean) => {
            const runtime = new Interpreter(undefined, { scalarCompilation, scalarEntryCompilation: false });
            runtime.variables.set('A', a); runtime.variables.set('B', b);
            try { return { value: runtime.execute('+(A ** B)') }; }
            catch (error) { return { error: String(error) }; }
            finally { runtime.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    });


it.each(['equal', 'not equal'])('compiles boolean tensor %s', operator => {
    const source = `Left = array true false true\nRight = array false false true\nResult = (not Left) ${operator} Right\nResult`;
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const runtime = new Interpreter(), reference = new Interpreter(undefined, { compilation: false });
    try {
        expect(diagnostics.run(() => formatValue(runtime.execute(source)!))).toBe(formatValue(reference.execute(source)!));
        expect(diagnostics.compiledTensors).toBeGreaterThan(0);
    } finally { runtime.dispose(); reference.dispose(); }
});
