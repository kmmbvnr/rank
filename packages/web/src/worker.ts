/// <reference lib="webworker" />

import { createReplSession } from '@arrrank/common/repl-session';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const session = createReplSession();
let queue = Promise.resolve();
self.postMessage({ id: 0, snapshot: session.snapshot() } satisfies WorkerResponse);
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    queue = queue.then(async () => {
        const { id, method, args } = event.data;
        try {
            // One ordered mailbox preserves rewind → prepare → execute semantics.
            const call = session[method] as (...args: unknown[]) => unknown;
            const result = await call(...args);
            self.postMessage({ id, result, snapshot: session.snapshot() } satisfies WorkerResponse);
        } catch (error) {
            self.postMessage({ id, error: String(error), snapshot: session.snapshot() } satisfies WorkerResponse);
        }
    });
});
