/// <reference lib="webworker" />

import { BrowserIo, configureNativeFiles } from './browser-io.js';
import { createReplSession } from '@arrrank/common/repl-session';
import { withInterrupt, inputValues, DebugSession, type PauseSnapshot, type InterruptSignal } from '@arrrank/interpreter';
import { nativeDebugSignal } from './debug-signal.js';
import type { BrowserFile, ProgramInputValue, WorkerInit, WorkerRequest, WorkerResponse } from './protocol.js';

let debuggerSession = new DebugSession();
let session: ReturnType<typeof createReplSession>;
let signal: Int32Array | InterruptSignal | undefined;
let signalUrl: string | undefined;
let breakpoints: { source: string; line: number }[] = [];
const onPause = (pause: PauseSnapshot) => self.postMessage({ id: 0, pause, snapshot: session.snapshot() } satisfies WorkerResponse);
let queue = Promise.resolve();
let io = new BrowserIo([]);
const setInputs = (inputs: ProgramInputValue[]) => session.setInputs(new Map(inputs.map(input =>
    [input.name, inputValues(input.values, input.valueType, input.many)])));
const createSession = () => createReplSession({ options: { sourceId: 'main.ra', io } });
self.addEventListener('message', (event: MessageEvent<WorkerRequest | WorkerInit>) => {
    if (!('method' in event.data)) {
        configureNativeFiles(event.data.nativeFiles ?? false);
        io = new BrowserIo(event.data.files ?? []);
        signalUrl = event.data.signalUrl;
        signal = event.data.signal ? new Int32Array(event.data.signal)
            : event.data.signalUrl ? nativeDebugSignal(event.data.signalUrl) : undefined;
        debuggerSession = new DebugSession();
        session = signal ? withInterrupt(signal, createSession, onPause, debuggerSession) : createSession();
        setInputs(event.data.inputs ?? []);
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
                if (method === 'setInputs') { io.setFiles(args[1] as BrowserFile[]); setInputs(args[0] as ProgramInputValue[]); return; }
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
