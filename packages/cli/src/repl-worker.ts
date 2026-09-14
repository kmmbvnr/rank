import { enableSqliteInterrupt } from './sqlite-interrupt.js';
import { parentPort, workerData } from 'node:worker_threads';
import { withInterrupt, setDebugBreakpoints } from '@rank/interpreter';
import { createReplSession } from './repl-session.js';

const port = parentPort!;
const signal = new Int32Array(workerData.signal);
enableSqliteInterrupt(signal);
const onPause = (pause: import('@rank/interpreter').PauseSnapshot) => port.postMessage({ pause });
const session = withInterrupt(signal, () => createReplSession(), onPause);
// Messages are serialized even when a command awaits file I/O.
let queue = Promise.resolve();
let breakpoints: { source: string; line: number }[] = [];
port.postMessage({ snapshot: session.snapshot() });
port.on('message', ({ id, method, args }) => {
    queue = queue.then(async () => {
        try {
            setDebugBreakpoints(method === 'execute' || method === 'debugExecute' ? breakpoints : []);
            // execute() performs language evaluation and preview synchronously
            // before returning its promise; command `full` does the same.
            const value = await withInterrupt(signal, () => {
                switch (method) {
                    case 'debugExecute':
                        Atomics.store(signal, 2, 2);
                        return session.execute(...args as Parameters<typeof session.execute>);
                    case 'execute': return session.execute(...args as Parameters<typeof session.execute>);
                    case 'setDebugBreakpoints': breakpoints = args[0]; return;
                    case 'rewind': return session.rewind(args[0]);
                    case 'prepareFunctions': return session.prepareFunctions(args[0]);
                    case 'replaceFile': return session.replaceFile(args[0]);
                    case 'saveFile': return session.saveFile(args[0], args[1]);
                    case 'dispose': return session.dispose();
                    default: throw new Error(`Unknown session method: ${method}`);
                }
            }, onPause);
            port.postMessage({ id, value, snapshot: session.snapshot() });
        } catch (error) {
            port.postMessage({ id, error: String(error), snapshot: session.snapshot() });
        }
    });
});
