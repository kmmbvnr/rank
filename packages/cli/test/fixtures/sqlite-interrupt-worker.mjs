import { parentPort, workerData } from 'node:worker_threads';
import { InterruptedError, withInterrupt } from '@arrrank/interpreter';
import { nodeIo } from '../../out/node-io.js';
import { enableSqliteInterrupt } from '../../out/sqlite-interrupt.js';

const signal = new Int32Array(workerData.signal);
enableSqliteInterrupt(signal);
const connection = nodeIo.openSqliteWrite(workerData.path);
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ id, sql }) => {
    if (sql === undefined) { connection.close(); parentPort.close(); return; }
    try {
        const result = withInterrupt(signal, () => {
            const statement = connection.prepare(sql);
            return statement.reader ? statement.all([]) : statement.run([]);
        });
        parentPort.postMessage({ id, result });
    } catch (error) {
        parentPort.postMessage({ id, error: String(error), interrupted: error instanceof InterruptedError });
    }
});
