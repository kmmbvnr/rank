import { sessionEditor, type Execution, type SessionSnapshot } from '@arrrank/common/repl-session';
import type { ReplSession } from '@arrrank/common/repl-types';
import type { SessionMethod, WorkerRequest, WorkerResponse } from './protocol.js';

/** Browser transport; evaluation and notebook behavior are shared with the CLI. */
export function browserSession(onFailure: (message: string) => void): ReplSession {
    let snapshot: SessionSnapshot = { names: [], modules: [], aliases: true };
    let id = 0;
    const pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
    let worker = createWorker();
    function createWorker(): Worker {
        const next = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        next.onmessage = (event: MessageEvent<WorkerResponse>) => {
            snapshot = event.data.snapshot;
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
            worker.postMessage({ id: requestId, method, args } satisfies WorkerRequest);
        });
    }
    return {
        get names() { return snapshot.names; },
        get savedFile() { return undefined; },
        format: line => sessionEditor(snapshot).format(line),
        complete: line => sessionEditor(snapshot).complete(line),
        isCommand: source => sessionEditor(snapshot).isCommand(source),
        execute: (...args) => call<Execution>('execute', ...args),
        preview: (...args) => call<Execution>('preview', ...args),
        prepareFunctions: (...args) => call('prepareFunctions', ...args),
        rewind: id => { void call('rewind', id).catch(error => onFailure(String(error))); },
        resetExecution: () => call<void>('resetExecution'),
        replaceFile: () => { throw new Error('File loading is unavailable'); },
        saveFile: async () => ({ ok: false, output: [{ text: 'File saving is unavailable', error: true }] }),
        dispose: () => { worker.terminate(); },
        interrupt: () => {
            worker.terminate();
            for (const request of pending.values()) request.reject(new Error('Stopped'));
            pending.clear();
            snapshot = { names: [], modules: [], aliases: true };
            worker = createWorker();
            onFailure('Stopped');
        },
    };
}
