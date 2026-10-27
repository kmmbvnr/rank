import { parentPort, workerData } from 'node:worker_threads';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const { python, runner } = workerData as { python: string; runner: string };
let child: ChildProcessWithoutNullStreams | undefined;
let pending: { state: Int32Array; bytes: Uint8Array } | undefined;
let output = '';
let diagnostics = '';
function complete(text: string): void {
    if (!pending) return;
    let bytes = new TextEncoder().encode(text);
    if (bytes.length > pending.bytes.length) bytes = new TextEncoder().encode(JSON.stringify({ error: 'RAM response is too large' }));
    pending.bytes.set(bytes);
    Atomics.store(pending.state, 1, bytes.length);
    Atomics.store(pending.state, 0, 1);
    Atomics.notify(pending.state, 0);
    pending = undefined;
}
parentPort!.on('message', ({ payload, shared }: { payload: string; shared: SharedArrayBuffer }) => {
    pending = { state: new Int32Array(shared, 0, 3), bytes: new Uint8Array(shared, 12) };
    if (!child) {
        output = ''; diagnostics = '';
        const process = spawn(python, [runner, '--serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
        child = process;
        process.stdout.setEncoding('utf8');
        process.stderr.setEncoding('utf8');
        process.stderr.on('data', text => { diagnostics = (diagnostics + text).slice(-16384); });
        process.stdout.on('data', text => {
            output += text;
            if (output.length > 32 * 1024 * 1024) {
                complete(JSON.stringify({ error: 'RAM response is too large' })); process.kill(); return;
            }
            const end = output.indexOf('\n');
            if (end >= 0) { complete(output.slice(0, end)); output = output.slice(end + 1); }
        });
        process.on('error', error => { complete(JSON.stringify({ error: error.message })); child = undefined; });
        process.stdin.on('error', error => { complete(JSON.stringify({ error: error.message })); process.kill(); });
        process.on('exit', (code, signal) => {
            complete(JSON.stringify({ error: `RAM runtime exited (${signal ?? code}): ${diagnostics}` }));
            if (child === process) child = undefined;
        });
    }
    Atomics.store(pending.state, 2, child.pid ?? 0);
    child.stdin.write(payload + '\n');
});
