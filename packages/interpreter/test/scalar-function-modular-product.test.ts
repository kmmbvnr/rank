import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';

const definition = `fun A B M residue
  return A * B mod M
end\n`;
const literal = (n: bigint) => n < 0n ? `(${n})` : String(n);
const mod = (n: bigint, m: bigint) => (n % m + m) % m;

function run(source: string, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, options), diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { value: value === undefined ? undefined : formatValue(value), diagnostics };
    } finally { runtime.dispose(); }
}

function compare(source: string) {
    const result = run(source);
    expect(result.value).toBe(run(source, { compilation: false }).value);
    expect(result.value).toBe(run(source, { numberLoopCompilation: false }).value);
    return result;
}

describe('exact modular products in scalar Number functions', () => {
    it('keeps wide products of safe signed integers in Number mode', () => {
        const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
        runtime.execute(definition);
        const edge = [0n, 1n, -1n, 100000006n, -100000006n, 9007199254740991n, -9007199254740991n];
        let checks = 0;
        try {
            diagnostics.run(() => {
                for (const a of edge) for (const b of edge) for (const m of [1n, 100000007n, 1073741824n]) {
                    expect(runtime.execute(`${literal(a)} ${literal(b)} ${m} residue`)).toBe(mod(a * b, m));
                    checks++;
                }
                let state = 123456789n;
                for (let i = 0; i < 200; i++) {
                    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
                    const a = state % 9007199254740991n;
                    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
                    const b = -(state % 9007199254740991n);
                    expect(runtime.execute(`${a} ${literal(b)} 100000007 residue`)).toBe(mod(a * b, 100000007n));
                    checks++;
                }
            });
            expect(diagnostics.numberFunctions).toBe(checks);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each(['1073741825', '-100000007'])('replays unsupported modulus %s exactly', modulus => {
        const result = compare(definition + `100000006 100000006 ${modulus.startsWith('-') ? `(${modulus})` : modulus} residue`);
        expect(result.value).toBe(String(mod(100000006n ** 2n, BigInt(modulus))));
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it('retains arbitrary precision arguments', () => {
        const result = compare(definition + '9007199254740993 9007199254740995 100000007 residue');
        expect(result.value).toBe(String(mod(9007199254740993n * 9007199254740995n, 100000007n)));
    });

    it('does not fuse across an ordinary stored product', () => {
        const result = compare(`fun A B M residue
  Product = A * B
  return Product mod M
end
100000006 100000006 100000007 residue`);
        expect(result.value).toBe('1');
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it('keeps array-reading helpers linked to their enclosing Number loop', () => {
        const result = compare(`fun F Inv A B M bin
  R = F A * Inv B mod M
  return R * Inv (A - B) mod M
end
F = array shape 16 fill 100000006
Inv = array shape 16 fill 100000006
Answer = 0
for J in 0 till F len
  F J = F J * F J mod 100000007
  Answer += F Inv J J 100000007 bin
end
Answer`);
        expect(result.value).toBe('16');
        expect(result.diagnostics.numberFunctions).toBe(16);
        expect(result.diagnostics.numberFunctionFallbacks).toBe(0);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('rolls back private caller writes before unsupported-modulus replay', () => {
        const result = compare(definition + `A = array shape 1 fill 0
Alias = A
Total = 0
for I in 1 to 3
  A 0 += I
  Total += 100000006 100000006 1073741825 residue
end
Total + A 0 + Alias 0`);
        expect(result.value).toBe(String(3n * mod(100000006n ** 2n, 1073741825n) + 6n));
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('replays division by zero and retains preceding caller stores once', () => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(definition + 'A = array shape 1 fill 0');
                expect(() => runtime.execute(`for I in 1 to 3
  A 0 += I
  R = 100000006 100000006 0 residue
end`)).toThrow('division by zero');
                expect(runtime.execute('A 0')).toBe(1n);
            } finally { runtime.dispose(); }
        }
    });

    it('retains operand error order', () => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                expect(() => runtime.execute(`fun A M residue
  return A 2 * (1 // 0) mod M
end
A = array 3
A residue 0`)).toThrow('array index out of bounds');
            } finally { runtime.dispose(); }
        }
    });
});
