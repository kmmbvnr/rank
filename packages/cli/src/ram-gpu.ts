import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RamGpu } from '@arrrank/interpreter';

export interface RamGpuRequest { model: string; input: readonly number[] }
export function runRamGpu(request: RamGpuRequest): { output: number[]; backend: string; fullyAccelerated: boolean } {
    const python = process.env.RANK_ML_PYTHON
        ?? fileURLToPath(new URL('../../../node_modules/.cache/mlrank/bin/python', import.meta.url));
    try {
        return JSON.parse(execFileSync(python, [process.env.RANK_ML_RUNNER ?? fileURLToPath(new URL('../bin/ram-runtime.py', import.meta.url))], {
            input: JSON.stringify(request), encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
        }));
    } catch (error) {
        const result = error as { stdout?: string; message?: string };
        let detail = '';
        try { detail = JSON.parse(result.stdout ?? '{}').error ?? ''; } catch { /* Native process failure. */ }
        throw new Error(detail || `RAM GPU unavailable; run npm run mlrank:setup (${result.message})`);
    }
}
export const nodeRamGpu: RamGpu = (graph, input) => {
    const result = runRamGpu({ model: Buffer.from(graph.model).toString('base64'), input });
    if (!result.fullyAccelerated) throw new Error('RAM graph did not execute entirely on GPU');
    return result.output;
};
