/// <reference lib="webworker" />

import { createReplSession } from '@arrrank/common/repl-session';
import { withInterrupt, DebugSession, type PauseSnapshot, type InterruptSignal } from '@arrrank/interpreter';
import { nativeDebugSignal } from './debug-signal.js';
import { browserRamGpu, configureRamGpu } from './ram-gpu.js';
import type { WorkerInit, WorkerRequest, WorkerResponse } from './protocol.js';

let debuggerSession = new DebugSession();
let session: ReturnType<typeof createReplSession>;
let signal: Int32Array | InterruptSignal | undefined;
let signalUrl: string | undefined;
let breakpoints: { source: string; line: number }[] = [];
const onPause = (pause: PauseSnapshot) => self.postMessage({ id: 0, pause, snapshot: session.snapshot() } satisfies WorkerResponse);
let queue = Promise.resolve();
let modules: Record<string, string> = {};
const createSession = () => createReplSession({ options: {
    sourceId: 'main.ra', ramGpu: browserRamGpu,
    loadModule: name => {
        if (!Object.hasOwn(modules, name)) throw new Error('Module is not attached to this program: ' + name);
        return { id: name, source: modules[name] };
    },
} });
self.addEventListener('message', (event: MessageEvent<WorkerRequest | WorkerInit>) => {
    if (!('method' in event.data)) {
        configureRamGpu(event.data.nativeRam ?? false);
        signalUrl = event.data.signalUrl;
        signal = event.data.signal ? new Int32Array(event.data.signal)
            : event.data.signalUrl ? nativeDebugSignal(event.data.signalUrl) : undefined;
        debuggerSession = new DebugSession();
        modules = event.data.modules ?? {};
        session = signal ? withInterrupt(signal, createSession, onPause, debuggerSession) : createSession();
        self.postMessage({ id: 0, snapshot: session.snapshot() } satisfies WorkerResponse);
        return;
    }
    const { id, method, args } = event.data;
    queue = queue.then(async () => {
        try {
            // One ordered mailbox preserves rewind → prepare → execute semantics.
            if (signalUrl) signal = nativeDebugSignal(signalUrl);
            debuggerSession.setBreakpoints(method === 'execute' || method === 'debugExecute' ? breakpoints : []);
            const run = () => {
                if (method === 'setModules') { modules = args[0] as Record<string, string>; return; }
                if (method === 'setDebugBreakpoints') { breakpoints = args[0] as typeof breakpoints; return; }
                if (method === 'debugExecute' && signal) {
                    if (signal instanceof Int32Array) Atomics.store(signal, 2, 2);
                    else signal.store(2, 2);
                }
                const call = session[method === 'debugExecute' || method === 'turboExecute' ? 'execute' : method] as (...args: unknown[]) => unknown;
                return call(...args);
            };
            const result = await (signal ? withInterrupt(signal, run, method === 'turboExecute' ? undefined : onPause, debuggerSession) : run());
            self.postMessage({ id, result, snapshot: session.snapshot() } satisfies WorkerResponse);
        } catch (error) {
            self.postMessage({ id, error: String(error), snapshot: session.snapshot() } satisfies WorkerResponse);
        }
    });
});
