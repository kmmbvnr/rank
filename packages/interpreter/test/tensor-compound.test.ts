import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, RuntimeDiagnostics } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

function run(source: string, tensorFusion: boolean) {
    const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter(() => {}, { tensorFusion });
    try {
        const result = diagnostics.run(() => runtime.execute(source));
        return { value: result === undefined ? undefined : formatValue(result), kernels: diagnostics.compiledTensors };
    } finally { runtime.dispose(); }
}
describe('compound tensor arithmetic', () => {
    it.each(['+=', '-=', '*='])('fuses %s while retaining aliases and refreshing scalar terms', op => {
        const source = `use sequences
A = 1 to 10000 array
Saved = A
B = A + 2
for N in 1 to 3
  A ${op} 4 * (B + 2 * N - 4)
end
tuple (A sum) (Saved sum)`;
        const reference = run(source,false), fused = run(source,true);
        expect(fused.value).toBe(reference.value);
        expect(fused.kernels).toBe(3);
    });

    it('retains BigInt precision and both broadcast layouts', () => {
        const source = `use sequences
A = ((1 to 6 array) reshape 2 3) copy
B = array 1000000000000000000000000000000 2 3
C = ((array 2 3) reshape 2 1) copy
A += B
A *= C
A`;
        expect(run(source,true).value).toBe(run(source,false).value);
        expect(run(source,true).kernels).toBe(2);
    });

    it('handles empty tensors and retains errors in unsupported scalar expressions', () => {
        expect(run('A = array shape 0 fill 0\nA += 2 * (3 - 1)\nA',true).value).toBe('');
        for (const tensorFusion of [false,true]) {
            const runtime = new Interpreter(undefined,{tensorFusion});
            try {
                runtime.execute('A = array shape 0 fill 0');
                expect(() => runtime.execute('A += 1 / 0')).toThrow(/zero/);
            } finally { runtime.dispose(); }
        }
    });

    it('leaves sequence callbacks on the reference path', () => {
        const source = `use sequences
fun X f rank 0
  return X + 1
end
A = 1 to 2000 array
B = (1 to 2000) f rank 0
A += B
A sum`;
        expect(run(source,true).value).toBe(run(source,false).value);
        expect(run(source,true).kernels).toBe(0);
    });

    it('does not publish partially computed output when the fused pass is cancelled', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nA = 1 to 10000 array\nSaved = A\nB = A + 1\nN = 2');
            const signal = new Int32Array(new SharedArrayBuffer(4)); signal[0] = 1;
            expect(() => withInterrupt(signal, () => runtime.execute('A += 4 * (B + 2 * N - 4)')))
                .toThrow('Interrupted while computing tensor');
            expect(runtime.execute('A sum')).toBe(50005000n);
            expect(runtime.execute('Saved sum')).toBe(50005000n);
        } finally { runtime.dispose(); }
    });

    it('does not reuse folded scalar slots between calls or integer/real inputs', () => {
        const source = `use sequences
fun A B N f
  A += 4 * (B + 2 * N - 4)
  return A sum
end
A = 1 to 10000 array
B = A + 1
X = A B 1 f
RealA = (A real rank 0) copy
RealB = (B real rank 0) copy
Y = RealA RealB 2.5 f
tuple X Y`;
        expect(run(source,true).value).toBe(run(source,false).value);
        expect(run(source,true).kernels).toBe(2);
    });
});
