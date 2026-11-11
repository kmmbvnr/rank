import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}, budget?: number) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, blockCompilation: budget === undefined, ...options });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try {
            const work = () => diagnostics.run(() => runtime.execute(source));
            if (budget === undefined) work(); else withDemandBudget(budget, work);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { diagnostics, state: { error, variables: [...runtime.variables].map(([name, value]) => [name,
            isRankArray(value) ? { shape: value.shape, items: [...value.items] } : formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, loops?: number, budget?: number) {
    source = source.replace(/^for /m, 'Order = array 0\nfor ');
    const result = run(source, {}, budget);
    expect(result.state).toEqual(run(source, { compilation: false }, budget).state);
    expect(result.state).toEqual(run(source, { numberLoopCompilation: false }, budget).state);
    if (loops !== undefined) expect(result.diagnostics.numberLoops).toBe(loops);
    return result;
}
it.each(['0', '1 2 -3', '1.5 -0.0 2.5', 'true false true', 'I (I + 2) (-I)'])('compiles scalar array items: %s', items => {
    expect(compare(`A = array ${items.replace(/\bI\b/g, '0')}\nfor I in 1 to 3\n A = array ${items}\n Done = I\nend`, 1).state.error).toBeUndefined();
});
it('keeps ordinary aliases and earlier iteration results alive', () => {
    expect(compare(`Saved = array 0 0
for I in 1 to 3
 A = array I (I + 1)
 if I equal 1
  Saved = A
 end
 A 0 = 99
end`).state.error).toBeUndefined();
});
it('replays wide integer items exactly', () => {
    expect(compare(`A = array 0 0\nfor I in 1 to 3\n A = array I (9007199254740990 + I)\n Done = I\nend`).state.error).toBeUndefined();
});
it('retains scalar item order and partial state on errors', () => {
    expect(compare(`Done = 0\nfor I in 1 to 3\n Done = I\n A = array I (1 // 0) (2 // 0)\nend`).state.error).toContain('division by zero');
});
it.each(['3 1 3 2 1', '2147483648 -2147483649 0 2147483648', '9007199254740991 9007199254740990 1',
    '1.5 -0.0 0.0 1.5', 'true false true false'])('stably orders completed cells: %s', items => {
    const result = compare(`use numbers\nuse sequences\nInput = array ${items}\nfor I in 1 to 3\n Order = Input argsort\nend`, 1);
    expect(result.state.error).toBeUndefined();
});
it('sorts a private arithmetic stage and preserves the source', () => {
    expect(compare(`use sequences\nInput = array 3 2 1 2\nfor I in 1 to 3\n Stage = Input * I\n Order = Stage argsort\n Stage 0 = 99\nend`, 1).state.error).toBeUndefined();
});
it('orders empty completed arrays', () => {
    expect(compare(`use sequences\nInput = array shape 0 fill 0\nfor I in 1 to 3\n Order = Input argsort\nend`, 1).state.error).toBeUndefined();
});
it.each(['inf 0.0 -inf inf', 'nan 0.0 1.0', '9007199254740993 9007199254740992 1'])('retains the native ordering path for %s', items => {
    expect(compare(`use numbers\nuse sequences\nInput = array ${items}\nfor I in 1 to 3\n Order = Input argsort\nend`).state.error).toBeUndefined();
});
it('completes all sort keys before sorting', () => {
    expect(compare(`use sequences\nInput = array 1 0 2\nDone = 0\nfor I in 1 to 3\n Done = I\n Order = (12 // Input) argsort\nend`).state.error).toContain('division by zero');
});
it('retains ranked-result binding errors', () => {
    expect(compare(`use sequences\nInput = array shape 2 2 fill 1\nfor I in 1 to 3\n Done = I\n Order = Input argsort\nend`).state.error).toContain('rank 1 and cannot receive rank 2');
});
it('preserves a replaced argsort binding after warming', () => {
    const values: string[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            runtime.execute('use sequences\nfun Value replacement\n return array 99\nend\nInput = array 3 1 2\nOrder = array 0');
            const loop = 'for I in 1 to 3\n Order = Input argsort\nend';
            runtime.execute(loop);
            runtime.variables.set('argsort', runtime.variables.get('replacement')!);
            runtime.execute(loop);
            values.push(formatValue(runtime.variables.get('Order')!));
        } finally { runtime.dispose(); }
    }
    expect(values).toEqual(['99', '99']);
});
it.each([0, 1, 3, 20, 100])('preserves literal and sort demand charges at budget %s', budget => {
    compare('use sequences\nfor I in 1 to 3\n A = array I (4 - I) I\n Order = A argsort\nend', undefined, budget);
});
it('rechecks polling and budget scopes on a warmed function', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(`use sequences
fun Values order
 Result = Values
 for I in 1 to 3
  Result = Values argsort
 end
 return Result
end
Input = array 3 1 3 2 1`);
        const warm = new RuntimeDiagnostics();
        expect(formatValue(warm.run(() => runtime.execute('Input order'))!)).toBe('1 4 3 0 2');
        expect(warm.numberLoops).toBe(1);
        for (const budget of [true, false]) {
            const diagnostics = new RuntimeDiagnostics();
            const work = () => diagnostics.run(() => runtime.execute('Input order'));
            const value = budget ? withDemandBudget(100000, work) : withInterrupt(new Int32Array(1), work);
            expect(formatValue(value!)).toBe('1 4 3 0 2');
            expect(diagnostics.numberLoops).toBe(0);
        }
    } finally { runtime.dispose(); }
});

it('does not borrow a custom reader installed after warming', () => {
    const states: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            runtime.execute(`use sequences
fun Values ordered
 Result = Values
 for Turn in 1 to 3
  Result = Values argsort
 end
 return Result
end
Input = array 3 1 2`);
            runtime.execute('Input ordered');
            let reads = 0;
            Object.defineProperty(runtime.variables.get('Input'), 'itemAt', {
                configurable: true, value: (index: number) => { reads++; return BigInt(10 - index); },
            });
            states.push({ value: formatValue(runtime.execute('Input ordered')!), reads });
        } finally { runtime.dispose(); }
    }
    expect(states[1]).toEqual(states[0]);
});

it('replays nonfinite keys produced inside a private region', () => {
    expect(compare(`use sequences
Input = array 1.0e308 1.0e308
for I in 1 to 3
 Huge = Input * Input
 Keys = Huge - Huge
 Order = Keys argsort
end`).state.error).toBeUndefined();
});

it('keeps literal, stable order and scalar consumer in one private loop', () => {
    const result = compare(`use sequences
Answer = 0
for Turn in 1 to 21
 Rest = Turn mod 7
 Keys = array Rest (Turn mod 3) (Rest - 1) Rest
 Order = Keys argsort
 Answer += Order 0
end`, 1);
    expect(result.state.error).toBeUndefined();
    expect(result.state.variables).toContainEqual(['Answer', '27']);
});
