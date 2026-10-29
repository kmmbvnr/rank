import { createRamClient, type RamRequest, type RamGpu } from '@arrrank/interpreter';

let native = false;
let sessionId: string | undefined;
export function configureRamGpu(android: boolean, owner?: string): void { native = android; sessionId = owner; }

const client = createRamClient((message: RamRequest) => {
    const request = new XMLHttpRequest();
    const payload = JSON.stringify(message);
    if (new TextEncoder().encode(payload).length > 32 * 1024 * 1024) throw new Error('RAM request exceeds 32 MiB');
    if (native) {
        const id = crypto.randomUUID();
        self.postMessage({ ram: { id, payload } });
        request.open('GET', '/__rank_ml_result?id=' + id + (sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : ''), false);
        request.send();
    } else {
        request.open('POST', '/__rank_ml', false);
        request.setRequestHeader('Content-Type', 'application/json');
        request.send(payload);
    }
    if (request.status !== 200) throw new Error('RAM GPU runtime is unavailable on this host');
    const reply = JSON.parse(request.responseText);
    if (native && reply.code === 'STALE_SESSION') self.postMessage({ ramFailure: reply.error });
    return reply;
});
export const browserRamGpu: RamGpu = (graph, input, inputFiles, options) => { const result = client.invoke(graph, () => {
    let binary = '';
    for (const byte of graph.model) binary += String.fromCharCode(byte);
    return btoa(binary);
}, input, graph.outputShape.reduce((a, b) => a * b, 1), graph.inputs.map(input => input.shape.reduce((a,b)=>a*b,1)), inputFiles, graph.reservationBytes, graph.inputs.map(input => input.dtype ?? 'f32'), { ...options, inputNames: graph.nodes.flatMap((node, i) => node.kind === 'input' ? ['t' + i] : []), outputName: 't' + graph.output });
    return result.state ?? result.output!;
};
browserRamGpu.control = request => client.stateControl(request);

browserRamGpu.memory = () => client.memory();
