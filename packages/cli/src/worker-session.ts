import type { PauseSnapshot } from '@rank/interpreter';
import { Worker } from 'node:worker_threads';
import { sessionEditor, type SessionSnapshot, type ProgramFile, type Execution } from './repl-session.js';

/** The terminal only exchanges text and binding names; live values stay in the worker. */
export async function createWorkerSession() {
    const signal = new Int32Array(new SharedArrayBuffer(8));
    const worker = new Worker(new URL('./repl-worker.js', import.meta.url), { workerData: { signal: signal.buffer } });
    let serial = 0;
    let active = false;
    let pauseState: PauseSnapshot | undefined;
    let execution: Promise<Execution> | undefined;
    let disposed = false;
    let failure: Error | undefined;
    let snapshot: SessionSnapshot;
    let editor: ReturnType<typeof sessionEditor>;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let ready!: () => void;
    let rejectReady!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    const fail = (error: Error) => {
        failure = error;
        rejectReady(error);
        for (const request of pending.values()) request.reject(error);
        pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', code => { if (!disposed) fail(new Error(`Execution worker exited (${code})`)); });
    worker.on('message', message => {
        if (message.pause) {
            if (active && Atomics.load(signal, 1) === 1) pauseState = message.pause;
            return;
        }
        snapshot = message.snapshot;
        editor = sessionEditor(snapshot);
        if (message.id === undefined) { ready(); return; }
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error));
        else request?.resolve(message.value);
    });
    const call = <T>(method: string, ...args: unknown[]): Promise<T> => {
        if (failure) return Promise.reject(failure);
        const id = serial++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve: value => resolve(value as T), reject });
            worker.postMessage({ id, method, args });
        });
    };
    await started;
    const initial = snapshot!;
    const resume = () => {
        pauseState = undefined;
        Atomics.store(signal, 1, 0);
        Atomics.notify(signal, 1);
    };
    const interrupt = () => { if (active) { Atomics.store(signal, 0, 1); resume(); } };
    return {
        get pauseState() { return pauseState; },
        get pauseRequested() { return active && Atomics.load(signal, 1) === 1; },
        pause(): void { if (active) Atomics.store(signal, 1, 1); },
        resume,
        get savedFile() { return snapshot.savedFile; },
        format(line: string) { return editor.format(line); },
        isCommand(source: string) { return editor.isCommand(source); },
        complete(line: string) { return editor.complete(line); },
        rewind(id: number): void { void call<void>('rewind', id).catch(fail); },
        replaceFile(file: ProgramFile): void {
            const source = file.source.replace(/\r\n?/g, '\n');
            snapshot = { ...initial, savedFile: { path: file.path, source: source && !source.endsWith('\n') ? source + '\n' : source } };
            editor = sessionEditor(snapshot);
            void call<void>('replaceFile', file).catch(fail);
        },
        saveFile(lines: string[], target: string) { return call<{ ok: boolean; output: Execution['output'] }>('saveFile', lines, target); },
        async execute(...args: [string, number, string[], number?, boolean?]): Promise<Execution> {
            resume();
            Atomics.store(signal, 0, 0);
            active = true;
            execution = call<Execution>('execute', ...args);
            try { return await execution; }
            finally { active = false; execution = undefined; resume(); }
        },
        interrupt,
        async dispose(): Promise<void> {
            if (disposed) return;
            interrupt();
            try {
                // Let the native driver return before V8 termination: better-sqlite3
                // cannot construct its interrupt error in a terminating isolate.
                await execution?.catch(() => undefined);
                if (!failure) await call<void>('dispose');
            } finally {
                disposed = true;
                fail(new Error('Session closed'));
                await worker.terminate();
            }
        },
    };
}
