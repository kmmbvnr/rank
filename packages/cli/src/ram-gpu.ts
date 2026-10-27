import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { RamGpu } from '@arrrank/interpreter';

export interface RamGpuRequest { model: string; input: readonly number[] }
export interface RamGpuResult {
    output: number[]; backend: string; fullyAccelerated: boolean;
    cached: boolean; prepareMs: number; executeMs: number;
}
let worker: Worker | undefined;
let state: Int32Array | undefined;
/** Explicit cleanup for tests/hosts; process exit also disposes the helper. */
export function closeRamGpu(): void {
    const pid = state && Atomics.load(state, 2);
    if (pid) { try { process.kill(pid); } catch { /* Already exited. */ } }
    void worker?.terminate(); worker = undefined; state = undefined;
}
process.once('exit', closeRamGpu);

export function runRamGpu(request: RamGpuRequest): RamGpuResult {
    if (!worker) {
        worker = new Worker(new URL('../out/ram-gpu-worker.js', import.meta.url), { workerData: {
            python: process.env.RANK_ML_PYTHON ?? fileURLToPath(new URL('../../../node_modules/.cache/mlrank/bin/python', import.meta.url)),
            runner: process.env.RANK_ML_RUNNER ?? fileURLToPath(new URL('../bin/ram-runtime.py', import.meta.url)),
        } });
        worker.unref();
        // A worker startup error cannot wake the blocked caller; the bounded wait below does.
        worker.on('error', () => {});
    }
    const shared = new SharedArrayBuffer(12 + Math.min(32 * 1024 * 1024, 65536 + request.input.length * 32));
    state = new Int32Array(shared, 0, 3);
    worker.postMessage({ payload: JSON.stringify(request), shared });
    if (Atomics.wait(state, 0, 0, 60_000) === 'timed-out') {
        closeRamGpu(); throw new Error('RAM GPU execution timed out');
    }
    const bytes = new Uint8Array(shared, 12, Atomics.load(state, 1));
    const result = JSON.parse(new TextDecoder().decode(bytes)) as RamGpuResult & { error?: string };
    if (result.error) throw new Error(result.error);
    return result;
}
export const nodeRamGpu: RamGpu = (graph, input) => {
    const result = runRamGpu({ model: Buffer.from(graph.model).toString('base64'), input });
    if (!result.fullyAccelerated) throw new Error('RAM graph did not execute entirely on GPU');
    return result.output;
};
