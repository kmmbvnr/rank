import type { RamGpu } from '@arrrank/interpreter';

/** The interpreter already runs in a worker; the native bridge stays synchronous. */
export const browserRamGpu: RamGpu = (graph, input) => {
    let binary = '';
    for (const byte of graph.model) binary += String.fromCharCode(byte);
    const request = new XMLHttpRequest();
    request.open('GET', '/__rank_ml?request=' + encodeURIComponent(JSON.stringify({ model: btoa(binary), input })), false);
    request.send();
    if (request.status !== 200) throw new Error('RAM GPU runtime is unavailable on this host');
    const result = JSON.parse(request.responseText) as { error?: string; fullyAccelerated?: boolean; gpuOnlyRequested?: boolean; output: number[] };
    if (result.error) throw new Error(result.error);
    if (!result.fullyAccelerated && !result.gpuOnlyRequested) throw new Error('RAM GPU execution was not requested');
    return result.output;
};
