import { sessionEditor, type Execution, type SessionSnapshot } from '@arrrank/common/repl-session';
import type { ReplSession } from '@arrrank/common/repl-types';
import type { PauseSnapshot } from '@arrrank/interpreter';
import type { SessionMethod, WorkerRequest, WorkerResponse } from './protocol.js';

/** Browser transport; evaluation and notebook behavior are shared with the CLI. */
export function browserSession(onFailure: (message: string) => void, onChange: () => void): ReplSession {
    let snapshot: SessionSnapshot = { names: [], modules: [], aliases: true };
    let id = 0;
    const pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
    let signal: Int32Array | undefined;
    let signalUrl: string | undefined;
    let controls = Promise.resolve();
    let ready = Promise.resolve();
    let active = false;
    let requested = false;
    let pauseState: PauseSnapshot | undefined;
    let debugNext = false;
    let stepToMain = false;
    let worker = createWorker();
    function control(command: string): Promise<void> {
        const url = signalUrl;
        controls = controls.then(async () => {
            if (!url) return;
            const result = await fetch(url + '&control=' + command, { cache: 'no-store' });
            if (!result.ok) throw new Error('Debugger connection closed');
        });
        return controls;
    }
    function resume(command = 0): void {
        requested = false;
        pauseState = undefined;
        if (signal) {
            Atomics.store(signal, 2, command);
            Atomics.store(signal, 1, 0);
            Atomics.notify(signal, 1);
        } else void control('resume' + command).catch(error => onFailure(String(error)));
        onChange();
    }
    function createWorker(): Worker {
        const next = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        signal = typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(12)) : undefined;
        const capacitor = (globalThis as typeof globalThis & { Capacitor?: { getPlatform(): string } }).Capacitor;
        signalUrl = !signal && capacitor?.getPlatform() === 'android'
            ? new URL('/__rank_debug?token=' + crypto.randomUUID(), location.href).href : undefined;
        controls = Promise.resolve();
        ready = signalUrl ? control('reset') : Promise.resolve();
        void ready.then(() => next.postMessage({ signal: signal?.buffer, signalUrl }))
            .catch(error => onFailure(String(error)));
        next.onmessage = (event: MessageEvent<WorkerResponse>) => {
            snapshot = event.data.snapshot;
            if (event.data.pause) {
                if (active) { pauseState = event.data.pause; requested = true; stepToMain = false; onChange(); }
                return;
            }
            const request = pending.get(event.data.id);
            pending.delete(event.data.id);
            if (event.data.error) request?.reject(new Error(event.data.error));
            else request?.resolve(event.data.result);
        };
        next.onerror = event => {
            for (const request of pending.values()) request.reject(new Error(event.message));
            pending.clear();
            onFailure(event.message);
        };
        return next;
    }
    function call<T>(method: SessionMethod, ...args: unknown[]): Promise<T> {
        return new Promise((resolve, reject) => {
            const requestId = ++id;
            pending.set(requestId, { resolve: value => resolve(value as T), reject });
            void ready.then(() => controls).then(() => {
                worker.postMessage({ id: requestId, method, args } satisfies WorkerRequest);
            }).catch(reject);
        });
    }
    return {
        get names() { return snapshot.names; },
        get savedFile() { return undefined; },
        format: line => sessionEditor(snapshot).format(line),
        complete: line => sessionEditor(snapshot).complete(line),
        isCommand: source => sessionEditor(snapshot).isCommand(source),
        get pauseState() { return pauseState; },
        get pauseRequested() { return requested; },
        pause: () => {
            if (!active) return;
            requested = true;
            if (signal) Atomics.store(signal, 1, 1);
            else void control('pause').catch(error => onFailure(String(error)));
            onChange();
        },
        resume: () => resume(),
        step: (iteration = false) => { if (pauseState) resume(iteration ? 3 : 2); },
        stepToMain: () => { if (pauseState) { stepToMain = true; resume(4); } },
        endDebugRun: () => { stepToMain = false; },
        debugNext: () => { debugNext = true; },
        setDebugBreakpoints: points => { void call('setDebugBreakpoints', points).catch(error => onFailure(String(error))); },
        execute: async (...args) => {
            if (signal) { Atomics.store(signal, 0, 0); Atomics.store(signal, 1, 0); }
            else await control('reset');
            active = true;
            try { return await call<Execution>(debugNext || stepToMain ? 'debugExecute' : 'execute', ...args); }
            finally { active = false; debugNext = false; requested = false; pauseState = undefined; onChange(); }
        },
        preview: (...args) => call<Execution>('preview', ...args),
        prepareFunctions: (...args) => call('prepareFunctions', ...args),
        rewind: id => { void call('rewind', id).catch(error => onFailure(String(error))); },
        resetExecution: async () => {
            debugNext = false; stepToMain = false; requested = false; pauseState = undefined;
            if (signal) signal.fill(0);
            else await control('reset');
            await call<void>('resetExecution');
        },
        replaceFile: () => { throw new Error('File loading is unavailable'); },
        saveFile: async () => ({ ok: false, output: [{ text: 'File saving is unavailable', error: true }] }),
        dispose: () => { worker.terminate(); },
        interrupt: () => {
            if (active && (signal || signalUrl)) {
                if (signal) { Atomics.store(signal, 0, 1); resume(); }
                else { requested = false; pauseState = undefined; void control('stop').catch(error => onFailure(String(error))); }
                return;
            }
            worker.terminate();
            for (const request of pending.values()) request.reject(new Error('Stopped'));
            pending.clear();
            snapshot = { names: [], modules: [], aliases: true };
            worker = createWorker();
            onFailure('Stopped');
        },
    };
}
