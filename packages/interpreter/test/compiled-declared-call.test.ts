import {describe, expect, it} from 'vitest';
import {Interpreter, RankError, RuntimeDiagnostics, formatValue} from '../src/index.js';

function run(source: string, compilation = true, numberLoopCompilation = true) {
    let entries = 0;
    const runtime = new Interpreter(() => {}, {compilation, numberLoopCompilation,
        onScalarFunctionExecuted: () => entries++});
    const diagnostics = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try {
            const result = diagnostics.run(() => runtime.execute(source));
            if (result !== undefined) value = formatValue(result);
        } catch (cause) {
            if (!(cause instanceof RankError)) throw cause;
            error = cause.format();
        }
        return {entries, diagnostics, state: {value, error, variables: [...runtime.variables]
            .map(([name, value]) => [name, formatValue(value)])}};
    } finally {runtime.dispose();}
}
function compare(source: string) {
    const compiled = run(source);
    expect(compiled.state).toEqual(run(source, false).state);
    expect(compiled.state).toEqual(run(source, true, false).state);
    return compiled;
}
const helper = `fun N combine A B
 return N * 100 + A * 10 + B
end`;

describe('compiled declared data calls', () => {
    it.each([
        ['N combine A B', 'I combine 2 3'],
        ['combine N A B', 'combine I 2 3'],
        ['N A combine B', 'I 2 combine 3'],
    ])('compiles parameter placement %s', (header, call) => {
        const result = compare(`fun ${header}
 return N * 100 + A * 10 + B
end
Result = 0
for I in 1 to 3
 Result += ${call}
end
Result`);
        expect(result.state.value).toBe('669');
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.compilerRejections).toEqual([]);
    });

    it('links a declared call inside another compiled helper', () => {
        const result = compare(`${helper}
fun N caller
 return N combine 2 3
end
Result = 0
for I in 1 to 3
 Result += I caller
end
Result`);
        expect(result.state.value).toBe('669');
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.compilerRejections).toEqual([]);
    });

    it('compiles a direct scalar entry and a declared tail call', () => {
        const result = compare(`${helper}
fun N caller
 return N combine 2 3
end
3 caller`);
        expect(result.state.value).toBe('323');
        expect(result.entries).toBeGreaterThan(0);
    });

    it.each(['9007199254740991', '9007199254740992', '1000000000000000000000000000000'])
    ('keeps exact arithmetic across Number overflow at %s', value => {
        const result = compare(`${helper}
Result = ${value}
for I in 1 to 3
 Result = Result combine 2 3
end
Result`);
        let expected = BigInt(value);
        for (let i = 0; i < 3; i++) expected = expected * 100n + 23n;
        expect(result.state.value).toBe(String(expected));
        expect(result.diagnostics.compiledLoops).toBeGreaterThan(0);
    });

    it('supports real operands through the same proof', () => {
        const result = compare(`${helper}
fun N caller
 return N combine 0.25 0.5
end
1.5 caller`);
        expect(result.state.value).toBe('153');
        expect(result.entries).toBeGreaterThan(0);
    });

    it.each(['(1 // 0) Missing', 'Missing (1 // 0)'])
    ('preserves left-to-right errors for strict unused arguments: %s', arguments_ => {
        const result = compare(`fun N first A B
 return N
end
fun N caller
 return N first ${arguments_}
end
1 caller`);
        expect(result.state.error).toBeDefined();
    });

    it('does not force an unused deferred right argument', () => {
        const result = compare(`fun N first A' B
 return N + B
end
fun N caller
 Bad' = N // 0
 return N first Bad 2
end
Result = 0
for I in 1 to 3
 Result += I caller
end
Result`);
        expect(result.state.value).toBe('12');
    });

    it('keeps a deferred argument lazy at a loop call site', () => {
        const result = compare(`fun N first A' B
 return N + B
end
Bad' = 1 // 0
Result = 0
for I in 1 to 3
 Result += I first Bad 2
end
Result`);
        expect(result.state.value).toBe('12');
    });

    it('links a recursive declared tail call', () => {
        const result = compare(`fun N countdown A B
 if N at most 0
  return A + B
 end
 return (N - 1) countdown (A + 1) B
end
20 countdown 2 3`);
        expect(result.state.value).toBe('25');
        expect(result.entries).toBeGreaterThan(0);
    });

    it.each([
        'fun N adjust A .with B=3 = N + A + B\n1 adjust 2',
        'fun N adjust A .with B=3 = N + A + B\n1 adjust 2 with 4',
        'fun N apply op A = N op A\n1 apply + 2',
        'fun N plus A = N + A\n(array 1 2) plus (array 3 4) rank 0 0',
    ])('retains the evaluator for configured or ranked calls: %s', source => {
        expect(compare(source).state.error).toBeUndefined();
    });

    it('rechecks a helper binding between executions', () => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                runtime.execute(`${helper}\nfun N caller = N combine 2 3`);
                expect(runtime.execute('1 caller')).toBe(123n);
                runtime.execute('fun N replacement A B = N + A + B');
                runtime.variables.set('combine', runtime.variables.get('replacement')!);
                expect(runtime.execute('1 caller')).toBe(6n);
            } finally {runtime.dispose();}
        }
    });
});
