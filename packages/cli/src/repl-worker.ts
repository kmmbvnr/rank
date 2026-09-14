import { enableSqliteInterrupt } from './sqlite-interrupt.js';
import { parentPort, workerData } from 'node:worker_threads';
import { withInterrupt } from '@rank/interpreter';
import { createReplSession } from './repl-session.js';

const port = parentPort!;
const signal = new Int32Array(workerData.signal);
enableSqliteInterrupt(signal);
const session = createReplSession();
// Messages are serialized even when a command awaits file I/O.
let queue = Promise.resolve();
port.postMessage({ snapshot: session.snapshot() });
port.on('message', ({ id, method, args }) => {
    queue = queue.then(async () => {
        try {
            // execute() performs language evaluation and preview synchronously
            // before returning its promise; command `full` does the same.
            const value = await withInterrupt(signal, () => {
                switch (method) {
                    case 'execute': return session.execute(...args as Parameters<typeof session.execute>);
                    case 'rewind': return session.rewind(args[0]);
                    case 'replaceFile': return session.replaceFile(args[0]);
                    case 'saveFile': return session.saveFile(args[0], args[1]);
                    case 'dispose': return session.dispose();
                    default: throw new Error(`Unknown session method: ${method}`);
                }
            });
            port.postMessage({ id, value, snapshot: session.snapshot() });
        } catch (error) {
            port.postMessage({ id, error: String(error), snapshot: session.snapshot() });
        }
    });
});
