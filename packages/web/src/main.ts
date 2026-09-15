import './styles.css';
import type { BrowserFile, WorkerRequest, WorkerResponse } from './protocol.js';

const source = element<HTMLTextAreaElement>('source');
const stdin = element<HTMLTextAreaElement>('stdin');
const files = element<HTMLInputElement>('files');
const fileSummary = element<HTMLElement>('file-summary');
const output = element<HTMLElement>('output');
const status = element<HTMLElement>('runtime-status');
const runButton = element<HTMLButtonElement>('run');
const stopButton = element<HTMLButtonElement>('stop');
const clearButton = element<HTMLButtonElement>('clear');

let worker = createWorker();
let requestId = 0;
let running = false;

runButton.addEventListener('click', () => void run());
stopButton.addEventListener('click', stop);
clearButton.addEventListener('click', () => { output.textContent = ''; });
files.addEventListener('change', () => {
    const count = files.files?.length ?? 0;
    fileSummary.textContent = count === 0 ? 'No files' : `${count} file${count === 1 ? '' : 's'}`;
});

async function run(): Promise<void> {
    if (running) return;
    setRunning(true);
    output.textContent = '';
    const id = ++requestId;
    const selected = await readFiles(files.files);
    const request: WorkerRequest = {
        type: 'run', id, source: source.value, input: stdin.value, files: selected,
    };
    worker.postMessage(request, selected.map(file => file.data));
}

function stop(): void {
    if (!running) return;
    worker.terminate();
    worker = createWorker();
    setRunning(false);
    status.textContent = 'Stopped';
    output.textContent ||= 'Execution stopped.';
}

function createWorker(): Worker {
    const next = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    next.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.type !== 'result' || response.id !== requestId) return;
        output.textContent = response.output.join('\n') || '(no output)';
        status.textContent = `${response.ok ? 'Finished' : 'Error'} · ${response.durationMs.toFixed(1)} ms`;
        setRunning(false);
    });
    next.addEventListener('error', event => {
        output.textContent = event.message || 'The execution worker failed.';
        status.textContent = 'Worker error';
        setRunning(false);
    });
    return next;
}

function setRunning(value: boolean): void {
    running = value;
    runButton.disabled = value;
    stopButton.disabled = !value;
    if (value) status.textContent = 'Running…';
}

async function readFiles(list: FileList | null): Promise<BrowserFile[]> {
    if (!list) return [];
    return Promise.all([...list].map(async file => ({ name: file.name, data: await file.arrayBuffer() })));
}

function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (!found) throw new Error(`missing #${id}`);
    return found as T;
}
