import { createRamClient, type RamRequest, type RamGpu } from '@arrrank/interpreter';

let native = false;
export function configureRamGpu(android: boolean): void { native = android; }

const client = createRamClient((message: RamRequest) => {
    const request = new XMLHttpRequest();
    const payload = JSON.stringify(message);
    if (new TextEncoder().encode(payload).length > 32 * 1024 * 1024) throw new Error('RAM request exceeds 32 MiB');
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
    return JSON.parse(request.responseText);
});
export const browserRamGpu: RamGpu = (graph, input, inputFiles) => client.invoke(graph, () => {
    let binary = '';
    for (const byte of graph.model) binary += String.fromCharCode(byte);
    return btoa(binary);
}, input, graph.outputShape.reduce((a, b) => a * b, 1), graph.inputs.map(input => input.shape.reduce((a,b)=>a*b,1)), inputFiles, graph.reservationBytes).output!;
