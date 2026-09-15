/// <reference lib="webworker" />

import { runProgram } from '@arrrank/common';
import { formatValue, RankError } from '@arrrank/interpreter';
import { BrowserIo, BufferedInput } from './browser-io.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    if (request.type !== 'run') return;

    const startedAt = performance.now();
    const output: string[] = [];
    const input = new BufferedInput();
    input.set(request.input);
    let ok = true;
    try {
        const result = runProgram(request.source, text => output.push(text), {
            input,
            io: new BrowserIo(request.files),
            sourceId: '<web>',
        });
        if (result !== undefined) output.push(formatValue(result));
    } catch (error) {
        ok = false;
        output.push(error instanceof RankError ? error.format() : String(error));
    }

    const response: WorkerResponse = {
        type: 'result',
        id: request.id,
        ok,
        output,
        durationMs: performance.now() - startedAt,
    };
    self.postMessage(response);
});
