/// <reference lib="webworker" />

import { createReplSession } from '@arrrank/common/repl-session';
import { withInterrupt, setDebugBreakpoints, type PauseSnapshot, type InterruptSignal } from '@arrrank/interpreter';
import { nativeDebugSignal } from './debug-signal.js';
import type { WorkerInit, WorkerRequest, WorkerResponse } from './protocol.js';

let session: ReturnType<typeof createReplSession>;
let signal: Int32Array | InterruptSignal | undefined;
let signalUrl: string | undefined;
let breakpoints: { source: string; line: number }[] = [];
const onPause = (pause: PauseSnapshot) => self.postMessage({ id: 0, pause, snapshot: session.snapshot() } satisfies WorkerResponse);
let queue = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<WorkerRequest | WorkerInit>) => {
    if (!('method' in event.data)) {
        signalUrl = event.data.signalUrl;
        signal = event.data.signal ? new Int32Array(event.data.signal)
            : event.data.signalUrl ? nativeDebugSignal(event.data.signalUrl) : undefined;
        session = signal ? withInterrupt(signal, () => createReplSession(), onPause) : createReplSession();
        self.postMessage({ id: 0, snapshot: session.snapshot() } satisfies WorkerResponse);
        return;
    }
    const { id, method, args } = event.data;
    queue = queue.then(async () => {
        try {
            // One ordered mailbox preserves rewind → prepare → execute semantics.
            if (signalUrl) signal = nativeDebugSignal(signalUrl);
            setDebugBreakpoints(method === 'execute' || method === 'debugExecute' ? breakpoints : []);
            const run = () => {
                if (method === 'setDebugBreakpoints') { breakpoints = args[0] as typeof breakpoints; return; }
                if (method === 'debugExecute' && signal) {
                    if (signal instanceof Int32Array) Atomics.store(signal, 2, 2);
                    else signal.store(2, 2);
                }
                const call = session[method === 'debugExecute' ? 'execute' : method] as (...args: unknown[]) => unknown;
                return call(...args);
            };
            const result = await (signal ? withInterrupt(signal, run, onPause) : run());
            self.postMessage({ id, result, snapshot: session.snapshot() } satisfies WorkerResponse);
        } catch (error) {
            self.postMessage({ id, error: String(error), snapshot: session.snapshot() } satisfies WorkerResponse);
        }
    });
});
