import type { RamGpu } from '@arrrank/interpreter';

let native = false;
export function configureRamGpu(android: boolean): void { native = android; }

/** The interpreter already runs in a worker; the native bridge stays synchronous. */
export const browserRamGpu: RamGpu = (graph, input) => {
    let binary = '';
    for (const byte of graph.model) binary += String.fromCharCode(byte);
    const request = new XMLHttpRequest();
    const payload = JSON.stringify({ model: btoa(binary), input, outputSize: graph.outputShape.reduce((a, b) => a * b, 1) });
    if (native) {
        const id = crypto.randomUUID();
        self.postMessage({ ram: { id, payload } });
        request.open('GET', '/__rank_ml_result?id=' + id, false);
        request.send();
    } else {
        request.open('POST', '/__rank_ml', false);
        request.setRequestHeader('Content-Type', 'application/json');
        request.send(payload);
    }
    if (request.status !== 200) throw new Error('RAM GPU runtime is unavailable on this host');
    const result = JSON.parse(request.responseText) as { error?: string; fullyAccelerated?: boolean; gpuOnlyRequested?: boolean; output: number[] };
    if (result.error) throw new Error(result.error);
    if (!result.fullyAccelerated && !result.gpuOnlyRequested) throw new Error('RAM GPU execution was not requested');
    return result.output;
};
