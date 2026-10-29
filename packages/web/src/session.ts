import { registerPlugin } from '@capacitor/core';
const ramNative = registerPlugin<{
    openSession(): Promise<{ sessionId: string }>;
    closeSession(owner: { sessionId: string }): Promise<unknown>;
    submit(request: { id: string; payload: string }): Promise<void>;
}>('RamGpu');
import { sessionEditor, type Execution, type SessionSnapshot } from '@arrrank/common/repl-session';
import type { ReplSession } from '@arrrank/common/repl-types';
import type { Inspection } from '@arrrank/common/value-inspection';
import type { Extension } from '@arrrank/common/repl-session';
import type { PauseSnapshot } from '@arrrank/interpreter';
import type { BrowserFile, ProgramInputValue, SessionMethod, WorkerRequest, WorkerResponse } from './protocol.js';

/** Browser transport; evaluation and notebook behavior are shared with the CLI. */
export function browserSession(onFailure: (message: string) => void, onChange: () => void): ReplSession & {
    configureInputs(inputs: ProgramInputValue[], files: BrowserFile[]): Promise<void>;
    setModules(modules: Record<string, string>, attachments?: Record<string, string>): Promise<void>;
} {
    let snapshot: SessionSnapshot = { names: [], modules: [], aliases: true };
    let id = 0;
    const pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
    let signal: Int32Array | undefined;
    let signalUrl: string | undefined;
    let controls = Promise.resolve();
    let ready = Promise.resolve();
    let active = false;
    let requested = false;
    let turboRequested = false;
    let turboActive = false;
    let pauseState: PauseSnapshot | undefined;
    let debugNext = false;
    let stepToMain = false;
    let modules: Record<string, string> = {};
    let attachments: Record<string, string> = {};
    let inputs: ProgramInputValue[] = [];
    let files: BrowserFile[] = [];
    const retirements = new WeakMap<Worker, () => void>();
    const retired = new WeakSet<Worker>();
    const retire = (target: Worker) => {
        if (retired.has(target)) return;
        retired.add(target);
        target.terminate();
        retirements.get(target)?.();
    };
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
        if (command === 5) turboActive = true;
        if (signal) {
            Atomics.store(signal, 2, command);
            Atomics.store(signal, 1, 0);
            Atomics.notify(signal, 1);
        } else void control(command === 5 ? 'turbo' : 'resume' + command).catch(error => onFailure(String(error)));
        onChange();
    }
    function createWorker(): Worker {
        const next = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        signal = typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(12)) : undefined;
        const capacitor = (globalThis as typeof globalThis & { Capacitor?: { getPlatform(): string } }).Capacitor;
        signalUrl = !signal && capacitor?.getPlatform() === 'android'
            ? new URL('/__rank_debug?token=' + crypto.randomUUID(), location.href).href : undefined;
        const android = capacitor?.getPlatform() === 'android';
        let owner: { sessionId: string } | undefined;
        const opened = android ? ramNative.openSession().then(value => { owner = value; return value; }) : Promise.resolve(undefined);
        retirements.set(next, () => {
            void opened.then(value => value && ramNative.closeSession(value), () => undefined).catch(error => onFailure(String(error)));
        });
        controls = Promise.resolve();
        ready = Promise.all([signalUrl ? control('reset') : Promise.resolve(), opened]).then(() => {});
        void ready.then(() => { if (!retired.has(next)) next.postMessage({ ramSessionId: owner?.sessionId, signal: signal?.buffer, signalUrl, modules, attachments, inputs, files, nativeRam: capacitor?.getPlatform() === 'android', nativeFiles: capacitor?.getPlatform() === 'android' }); })
            .catch(error => { if (!retired.has(next)) fail(String(error)); });
        const fail = (message: string) => {
            if (retired.has(next)) return;
            retire(next);
            for (const request of pending.values()) request.reject(new Error(message));
            pending.clear();
            snapshot = { names: [], modules: [], aliases: true };
            if (worker === next) worker = createWorker();
            onFailure(message);
        };
        next.onmessage = (event: MessageEvent<WorkerResponse | { ram: { id: string; payload: string } } | { ramFailure: string }>) => {
            if (retired.has(next)) return;
            if ('ramFailure' in event.data) { fail(event.data.ramFailure); return; }
            if ('ram' in event.data) {
                const request = event.data.ram;
                const payload = JSON.stringify({ ...JSON.parse(request.payload), ...owner });
                void ramNative.submit({ id: request.id, payload }).catch(error => fail(String(error)));
                return;
            }
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
        next.onerror = event => fail(event.message);
        next.onmessageerror = () => fail('Worker message could not be decoded');
        return next;
    }
    function call<T>(method: SessionMethod, ...args: unknown[]): Promise<T> {
        return new Promise((resolve, reject) => {
            const target = worker;
            const requestId = ++id;
            pending.set(requestId, { resolve: value => resolve(value as T), reject });
            void ready.then(() => controls).then(() => {
                if (target !== worker || retired.has(target)) throw new Error('Stopped');
                target.postMessage({ id: requestId, method, args } satisfies WorkerRequest);
            }).catch(error => { pending.delete(requestId); reject(error); });
        });
    }
    return {
        configureInputs: (next, nextFiles) => { inputs = next; files = nextFiles; return call<void>('setInputs', inputs, files); },
        setModules: (next, weights = {}) => { modules = next; attachments = weights; return call<void>('setModules', modules, attachments); },
        get names() { return snapshot.names; },
        get modules() { return snapshot.modules; },
        get diagnosticFacts() { return snapshot.diagnosticFacts ?? []; },
        get testExamples() { return snapshot.testExamples; },
        get savedFile() { return undefined; },
        format: line => sessionEditor(snapshot).format(line),
        complete: line => sessionEditor(snapshot).complete(line),
        isCommand: source => sessionEditor(snapshot).isCommand(source),
        variableSpelling: source => sessionEditor(snapshot).variableSpelling(source),
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
        endDebugRun: () => { stepToMain = false; turboRequested = false; turboActive = false; onChange(); },
        debugNext: () => { debugNext = true; },
        setDebugBreakpoints: points => { void call('setDebugBreakpoints', points).catch(error => onFailure(String(error))); },
        turbo: () => { if (active) { turboRequested = true; turboActive = true; resume(5); } },
        requestTurbo: () => { turboRequested = true; turboActive = true; },
        get turboActive() { return turboActive; },
        execute: async (...args) => {
            if (signal) { Atomics.store(signal, 0, 0); Atomics.store(signal, 1, 0); }
            else await control('reset');
            active = true;
            if (turboRequested) turboActive = true;
            const method = turboRequested || turboActive ? 'turboExecute' : debugNext || stepToMain ? 'debugExecute' : 'execute';
            try { return await call<Execution>(method, ...args); }
            finally {
                active = false;
                debugNext = false;
                if (!turboRequested) turboActive = false;
                requested = false;
                pauseState = undefined;
                onChange();
            }
        },
        preview: (...args) => call<Execution>('preview', ...args),
        inspect: (...args) => call<Inspection>('inspect', ...args),
        extend: (...args) => call<Extension>('extend', ...args),
        prepareFunctions: (...args) => call('prepareFunctions', ...args),
        rewind: id => { void call('rewind', id).catch(error => onFailure(String(error))); },
        resetExecution: async (resetEnvironment = false) => {
            debugNext = false; stepToMain = false;
            if (!turboRequested) turboActive = false;
            requested = false; pauseState = undefined;
            if (signal) signal.fill(0);
            else await control('reset');
            await call<void>('resetExecution', resetEnvironment);
        },
        replaceFile: () => { throw new Error('File loading is unavailable'); },
        saveFile: async () => ({ ok: false, output: [{ text: 'File saving is unavailable', error: true }] }),
        dispose: () => {
            retire(worker);
            for (const request of pending.values()) request.reject(new Error('Session disposed'));
            pending.clear();
        },
        interrupt: () => {
            turboRequested = false;
            turboActive = false;
            if (active && (signal || signalUrl)) {
                if (signal) { Atomics.store(signal, 0, 1); resume(); }
                else { requested = false; pauseState = undefined; void control('stop').catch(error => onFailure(String(error))); }
                return;
            }
            retire(worker);
            for (const request of pending.values()) request.reject(new Error('Stopped'));
            pending.clear();
            snapshot = { names: [], modules: [], aliases: true };
            worker = createWorker();
            onFailure('Stopped');
        },
    };
}
