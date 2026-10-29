import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { ownedStorage } from '../src/array-storage-state.js';
import { withInterrupt } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';

describe('tensor in-place destination buffer reuse', () => {
    it.each(['+=', '-=', '*='])('reuses Float64Array backing buffer in-place for %s compound updates', op => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'RawA = 1 to 5000 array',
                'RawB = 1 to 5000 array',
                'RealA = (RawA real rank 0) copy',
                'RealB = (RawB real rank 0) copy',
                'A = (RealA * 1.0) copy',
                'B = (RealB * 1.0) copy',
            ].join('\n'));

            const initialArray = runtime.variables.get('A') as RankArray;
            const initialState = ownedStorage.get(initialArray)!;
            const initialBuffer = initialState.typed as Float64Array;
            expect(initialBuffer).toBeInstanceOf(Float64Array);

            diagnostics.run(() => {
                for (let i = 1; i <= 5; i++) {
                    runtime.execute(`A ${op} (B * 2.0 + 1.0)`);
                }
            });

            const finalArray = runtime.variables.get('A') as RankArray;
            const finalState = ownedStorage.get(finalArray)!;
            const finalBuffer = finalState.typed as Float64Array;

            // Backing typed array identity must be preserved across updates
            expect(finalBuffer).toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(5);
            expect(diagnostics.reusedTensorBufferCells).toBe(5 * 5000);
        } finally {
            runtime.dispose();
        }
    });

    it('reuses Int32Array or BigInt64Array backing buffer in-place for packed integer updates', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'A = ((1 to 5000 array) copy)',
                'B = ((2 to 5001 array) copy)',
            ].join('\n'));

            const initialArray = runtime.variables.get('A') as RankArray;
            const initialState = ownedStorage.get(initialArray)!;
            const initialBuffer = initialState.typed;
            expect(initialBuffer).toBeInstanceOf(Int32Array);

            diagnostics.run(() => {
                for (let i = 1; i <= 3; i++) {
                    runtime.execute('A += B * 2 + 1');
                }
            });

            const finalArray = runtime.variables.get('A') as RankArray;
            const finalState = ownedStorage.get(finalArray)!;
            const finalBuffer = finalState.typed;

            expect(finalBuffer).toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(3);
            expect(diagnostics.reusedTensorBufferCells).toBe(3 * 5000);
        } finally {
            runtime.dispose();
        }
    });

    it('reuses BigInt64Array backing buffer in-place for large integer updates', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'A = ((10000000000 to 10000005000 array) copy)',
                'B = ((2 to 5002 array) copy)',
            ].join('\n'));

            const initialArray = runtime.variables.get('A') as RankArray;
            const initialState = ownedStorage.get(initialArray)!;
            const initialBuffer = initialState.typed;
            expect(initialBuffer).toBeInstanceOf(BigInt64Array);

            diagnostics.run(() => {
                for (let i = 1; i <= 3; i++) {
                    runtime.execute('A += B * 2 + 1');
                }
            });

            const finalArray = runtime.variables.get('A') as RankArray;
            const finalState = ownedStorage.get(finalArray)!;
            const finalBuffer = finalState.typed;

            expect(finalBuffer).toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(3);
            expect(diagnostics.reusedTensorBufferCells).toBe(3 * 5001);
        } finally {
            runtime.dispose();
        }
    });

    it('reuses destination buffer for explicit copy self-updates A = (A + ...) copy', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'RawA = 1 to 5000 array',
                'RawB = 1 to 5000 array',
                'RealA = (RawA real rank 0) copy',
                'RealB = (RawB real rank 0) copy',
                'A = (RealA * 1.0) copy',
                'B = (RealB * 1.0) copy',
            ].join('\n'));

            const initialArray = runtime.variables.get('A') as RankArray;
            const initialBuffer = ownedStorage.get(initialArray)!.typed;
            expect(initialBuffer).toBeInstanceOf(Float64Array);

            diagnostics.run(() => {
                runtime.execute('A = (A + B * 2.0) copy');
            });

            const finalArray = runtime.variables.get('A') as RankArray;
            const finalBuffer = ownedStorage.get(finalArray)!.typed;

            expect(finalBuffer).toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(1);
            expect(diagnostics.reusedTensorBufferCells).toBe(5000);
        } finally {
            runtime.dispose();
        }
    });

    it('reuses destination buffer for implicit multi-operation self-updates A = A + B + C', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'Raw = 1 to 5000 array',
                'Real = (Raw real rank 0) copy',
                'A = (Real * 1.0) copy',
                'B = (Real * 1.0) copy',
                'C = (Real * 1.0) copy',
            ].join('\n'));

            const initialArray = runtime.variables.get('A') as RankArray;
            const initialBuffer = ownedStorage.get(initialArray)!.typed;
            expect(initialBuffer).toBeInstanceOf(Float64Array);

            diagnostics.run(() => {
                runtime.execute('A = A + B + C');
            });

            const finalArray = runtime.variables.get('A') as RankArray;
            const finalBuffer = ownedStorage.get(finalArray)!.typed;

            expect(finalBuffer).toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(1);
            expect(diagnostics.reusedTensorBufferCells).toBe(5000);
        } finally {
            runtime.dispose();
        }
    });

    it('preserves copy-on-write (COW) and does not mutate shared arrays (owners > 1)', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'Raw = 1 to 1000 array',
                'Real = (Raw real rank 0) copy',
                'A = (Real * 1.0) copy',
                'Saved = A',
                'B = (Real * 1.0) copy',
            ].join('\n'));

            const savedArray = runtime.variables.get('Saved') as RankArray;
            const savedBuffer = ownedStorage.get(savedArray)!.typed;

            diagnostics.run(() => {
                runtime.execute('A += B + 1.0');
            });

            const finalA = runtime.variables.get('A') as RankArray;
            const bufferA = ownedStorage.get(finalA)!.typed;

            // Buffer must NOT be reused because A was shared with Saved
            expect(bufferA).not.toBe(savedBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(0);

            // Saved must remain untouched
            expect(runtime.execute('Saved 0')).toBe(1.0);
            expect(runtime.execute('A 0')).toBe(3.0);
        } finally {
            runtime.dispose();
        }
    });

    it('does not reuse buffer when destination has pending selections', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'Raw = 1 to 1000 array',
                'Real = (Raw real rank 0) copy',
                'A = (Real * 1.0) copy',
                'B = (Real * 1.0) copy',
                'View = A (0 till 10)',
            ].join('\n'));

            const destArray = runtime.variables.get('A') as RankArray;
            const initialBuffer = ownedStorage.get(destArray)!.typed;

            diagnostics.run(() => {
                runtime.execute('A += B + 1.0');
            });

            const finalA = runtime.variables.get('A') as RankArray;
            const bufferA = ownedStorage.get(finalA)!.typed;

            expect(bufferA).not.toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(0);
        } finally {
            runtime.dispose();
        }
    });

    it('does not reuse buffer when destination is shifted (non-pointwise dependency)', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'Raw = 1 to 1000 array',
                'Real = (Raw real rank 0) copy',
                'A = (Real * 1.0) copy',
            ].join('\n'));

            const initialBuffer = ownedStorage.get(runtime.variables.get('A') as RankArray)!.typed;

            diagnostics.run(() => {
                runtime.execute('A = ((A shift 1) + A) copy');
            });

            const finalBuffer = ownedStorage.get(runtime.variables.get('A') as RankArray)!.typed;
            // Shifted access reads overlapping cells, in-place reuse must decline
            expect(finalBuffer).not.toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(0);
        } finally {
            runtime.dispose();
        }
    });

    it('does not reuse buffer when destination appears under broadcast or slice', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'RawA = 1 to 5 array',
                'RawB = 1 to 25 array',
                'RealA = (RawA real rank 0) copy',
                'RealB = (RawB real rank 0) copy',
                'A = (((RealA reshape 1 5) * 1.0) copy)',
                'B = (((RealB reshape 5 5) * 1.0) copy)',
            ].join('\n'));

            const initialBuffer = ownedStorage.get(runtime.variables.get('A') as RankArray)!.typed;

            diagnostics.run(() => {
                // A has shape [1, 5], output has shape [5, 5] -> cannot reuse A's buffer
                runtime.execute('A = (A + B) copy');
            });

            const finalBuffer = ownedStorage.get(runtime.variables.get('A') as RankArray)!.typed;
            expect(finalBuffer).not.toBe(initialBuffer);
            expect(diagnostics.reusedTensorBuffers).toBe(0);
        } finally {
            runtime.dispose();
        }
    });

    it('does not mutate original buffer when cancelled under interrupt', () => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorFusion: true });
        try {
            runtime.execute([
                'use sequences',
                'Raw = 1 to 5000 array',
                'Real = (Raw real rank 0) copy',
                'A = (Real * 1.0) copy',
                'B = (Real * 1.0) copy',
            ].join('\n'));

            const initialArray = runtime.variables.get('A') as RankArray;
            const initialBuffer = ownedStorage.get(initialArray)!.typed as Float64Array;
            const firstCellBefore = initialBuffer[0];

            const signal = new Int32Array(new SharedArrayBuffer(4));
            signal[0] = 1;

            expect(() => {
                withInterrupt(signal, () => {
                    diagnostics.run(() => {
                        runtime.execute('A += B + 1.0');
                    });
                });
            }).toThrow('Interrupted');

            // Original buffer untouched
            expect(initialBuffer[0]).toBe(firstCellBefore);
            expect(diagnostics.reusedTensorBuffers).toBe(0);
        } finally {
            runtime.dispose();
        }
    });
});
