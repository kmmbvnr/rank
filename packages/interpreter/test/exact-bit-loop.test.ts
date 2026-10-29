import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';

function observe(source: string, compilation: boolean) {
    const diagnostics = new RuntimeDiagnostics();
    const generated: string[] = [];
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation: false,
        scalarEntryCompilation: false, onIntegerLoopCompiled: code => generated.push(code) });
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, generated, state: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = observe(source, true);
    expect(result.state).toEqual(observe(source, false).state);
    expect(result.diagnostics.compiledLoops).toBeGreaterThan(0);
    return result;
}

describe('exact BigInt bit operators inside compiled loops', () => {
    it.each(['band', 'bor', 'bxor'])('lowers signed wide %s directly', operation => {
        const { state, generated } = compare(`use bits
N = 1361129467683753853853498429727072845825
A = array 0 0 0 0
for I in 0 to 3
 A I = (N - I) ${operation} (-N + I)
end`);
        expect(state.error).toBeUndefined();
        const token = { band: '&', bor: '|', bxor: '^' }[operation];
        expect(generated.join('\n')).toContain(` ${token} `);
    });

    it('preserves complement, arithmetic right shift and wide bit tests', () => {
        const { state, generated } = compare(`use bits
N = 1361129467683753853853498429727072845825
A = array 0 0 0 0
for I in 0 to 3
 A I = ((N shl I) bnot) shr (I + 1)
 Flag = N bit (I * 130)
end`);
        expect(state.error).toBeUndefined();
        expect(generated.join('\n')).toContain(' << ');
        expect(generated.join('\n')).toContain(' >> ');
        expect(generated.join('\n')).toContain('(~');
    });

    it.each(['1 shl (1 - I)', '1 shr (1 - I)', '1 bit (1 - I)', '(1 - I) bit 0'])(
        'retains errors and completed stores for %s', expression => {
            const { state } = compare(`use bits
A = array 0
for I in 0 to 3
 A 0 += 1
 R = ${expression}
end`);
            expect(state.error).toBeDefined();
            expect(state.variables).toContainEqual(['A', '3']);
        });

    it('keeps invalid operations on unused branches lazy', () => {
        const { state } = compare(`use bits
A = array 0
for I in 0 to 2
 A 0 += 1
 if false
  R = -1 bit -1
  S = 1 shl -1
 end
end`);
        expect(state.error).toBeUndefined();
    });

    it.each(['band', 'bor', 'bxor', 'bnot', 'shl', 'shr', 'bit'])(
        'rechecks a replaced %s binding on a retained helper', operation => {
            for (const compilation of [false, true]) {
                const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation: false });
                let calls = 0;
                try {
                    runtime.execute(`use bits
fun N helper
 R = ${operation === 'bit' ? 'false' : 'N'}
 for I in 0 to 2
  R = ${operation === 'bnot' ? 'N bnot' : `N ${operation} 1`}
 end
 return R
end
7 helper`);
                    runtime.variables.set(operation, native('replacement', operation === 'bnot' ? 1 : 2, () => {
                        calls++;
                        return operation === 'bit' ? false : 42n;
                    }));
                    expect(runtime.execute('7 helper')).toBe(operation === 'bit' ? false : 42n);
                    expect(calls).toBe(3);
                } finally { runtime.dispose(); }
            }
        });
});
