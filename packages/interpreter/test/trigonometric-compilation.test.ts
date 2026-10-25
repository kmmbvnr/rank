import { describe, expect, it } from 'vitest';
import { materializeValue } from '../src/materialize.js';
import { Interpreter, isNativeFunction, type RankValue } from '../src/index.js';

const names = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'atan2'];
const inputs: (bigint | number)[] = [0n, 1n, -1n, 0, -0, 0.5, -0.5, 1, 2, Infinity, -Infinity, NaN, 10n ** 400n];

describe('compiled trigonometric calls', () => {
    it.each(names)('matches ordinary %s in scalar functions and loops, including domain errors', name => {
        const expression = name === 'atan2' ? 'X atan2 Y' : `X ${name}`;
        for (const loop of [false, true]) {
            const runtimes = [false, true].map(compilation => {
                let entries = 0;
                const runtime = new Interpreter(undefined, { compilation, scalarFunctionCompilation: !loop,
                    onScalarFunctionExecuted: () => { if (!loop) entries++; },
                    onIntegerLoopExecuted: () => { if (loop) entries++; },
                });
                runtime.execute(`use numbers
fun X probe Y
${loop
                    ? ` R = 0.0\n for I in 1 to 2\n  R = ${expression}\n end\n return R`
                    : ` return ${expression}`}
end`);
                const fn = runtime.variables.get('probe')!;
                if (!isNativeFunction(fn)) throw new Error('missing function');
                return { runtime, fn, entries: () => entries };
            });
            const call = (index: number, args: RankValue[]) => {
                try { return { value: materializeValue(runtimes[index].fn.call(args)) }; }
                catch (error) { return { error: (error as Error).message }; }
            };
            try {
                for (const x of inputs) for (const y of name === 'atan2' ? [0n, -0, 0.5, -1n] : [0n]) {
                    const expected = call(0, [x, y]);
                    expect(call(1, [x, y]), `${name}(${x}, ${y}), loop=${loop}`).toEqual(expected);
                }
                expect(runtimes[1].entries()).toBeGreaterThan(0);
                // Numeric eligibility must not admit text or booleans.
                for (const x of ['text', true]) expect(call(1, [x, 0n])).toEqual(call(0, [x, 0n]));
            } finally { for (const { runtime } of runtimes) runtime.dispose(); }
        }
    });

    it.each(names)('compiles a real-valued %s loop directly', name => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation: false,
            onIntegerLoopExecuted: () => loops++ });
        try {
            const operand = name === 'acosh' ? '1.5' : '0.5';
            const expression = name === 'atan2' ? `${operand} atan2 1` : `${operand} ${name}`;
            const expected = runtime.execute(`use numbers\n${expression}`);
            expect(runtime.execute(`R = 0.0\nfor I in 1 to 2\n R = ${expression}\nend\nR`)).toBe(expected);
            expect(loops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('rechecks native bindings after a function and loop have been compiled', () => {
        for (const loop of [false, true]) {
            const runtime = new Interpreter();
            try {
                runtime.execute(`use numbers
fun X probe
${loop
                    ? ' R = 0.0\n for I in 1 to 2\n  R = X sin\n end\n return R'
                    : ' return X sin'}
end
fun X replacement
 return 42.0
end`);
                expect(runtime.execute('0.0 probe')).toBe(0);
                runtime.variables.set('sin', runtime.variables.get('replacement')!);
                expect(runtime.execute('0.0 probe')).toBe(42);
            } finally { runtime.dispose(); }
        }
    });
});
