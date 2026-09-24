import type { PauseSnapshot } from '@arrrank/interpreter';
import { Worker } from 'node:worker_threads';
import { sessionEditor, type SessionSnapshot, type ProgramFile, type Execution } from './repl-session.js';

/** The terminal only exchanges text and binding names; live values stay in the worker. */
export async function createWorkerSession() {
    const signal = new Int32Array(new SharedArrayBuffer(12));
    const worker = new Worker(new URL('./repl-worker.js', import.meta.url), { workerData: { signal: signal.buffer } });
    let serial = 0;
    let active = false;
    let debugNext = false;
    let stepToMain = false;
    let stepNextCell = false;
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
            if (active && Atomics.load(signal, 1) === 1) {
                pauseState = message.pause;
                stepToMain = false;
                stepNextCell = false;
            }
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
    const resume = (command = 0) => {
        Atomics.store(signal, 2, command);
        pauseState = undefined;
        Atomics.store(signal, 1, 0);
        Atomics.notify(signal, 1);
    };
    const interrupt = () => { stepToMain = false; stepNextCell = false; if (active) { Atomics.store(signal, 0, 1); resume(); } };
    return {
        get pauseState() { return pauseState; },
        get pauseRequested() { return active && Atomics.load(signal, 1) === 1; },
        pause(): void { if (active) Atomics.store(signal, 1, 1); },
        resume: () => { stepNextCell = false; resume(); },
        step(iteration = false): void { if (pauseState) { stepNextCell = true; resume(iteration ? 3 : 2); } },
        stepToMain(): void { if (pauseState) { stepToMain = true; resume(4); } },
        endDebugRun(): void { stepToMain = false; stepNextCell = false; },
        debugNext(): void { debugNext = true; },
        setDebugBreakpoints(points: { source: string; line: number }[]): void {
            void call<void>('setDebugBreakpoints', points).catch(fail);
        },
        get savedFile() { return snapshot.savedFile; },
        get names() { return snapshot.names; },
        get diagnosticFacts() { return snapshot.diagnosticFacts ?? []; },
        get testExamples() { return snapshot.testExamples; },
        format(line: string) { return editor.format(line); },
        isCommand(source: string) { return editor.isCommand(source); },
        complete(line: string) { return editor.complete(line); },
        rewind(id: number): void { void call<void>('rewind', id).catch(fail); },
        async resetExecution(): Promise<void> {
            debugNext = false;
            stepToMain = false;
            stepNextCell = false;
            resume();
            Atomics.store(signal, 0, 0);
            await call<void>('resetExecution');
        },
        prepareFunctions(cells: { id: number; source: string }[]) {
            return call<{ id: number; output: Execution['output']; errorOffset?: number }[]>('prepareFunctions', cells);
        },
        replaceFile(file: ProgramFile): void {
            const source = file.source.replace(/\r\n?/g, '\n');
            snapshot = { ...initial, savedFile: { path: file.path, source: source && !source.endsWith('\n') ? source + '\n' : source } };
            editor = sessionEditor(snapshot);
            void call<void>('replaceFile', file).catch(fail);
        },
        saveFile(lines: string[], target: string) { return call<{ ok: boolean; output: Execution['output'] }>('saveFile', lines, target); },
        async preview(text: string, columns?: number, summaryOnly?: boolean): Promise<Execution> {
            Atomics.store(signal, 0, 0);
            active = true;
            try {
                return await call<Execution>('preview', text, columns, summaryOnly);
            } finally {
                active = false;
            }
        },
        async execute(...args: [string, number, string[], number?, boolean?, boolean?]): Promise<Execution> {
            resume();
            Atomics.store(signal, 0, 0);
            active = true;
            execution = call<Execution>(debugNext || stepToMain || stepNextCell ? 'debugExecute' : 'execute', ...args);
            debugNext = false;
            try {
                const result = await execution;
                if (!result.ok) { stepToMain = false; stepNextCell = false; }
                return result;
            }
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
