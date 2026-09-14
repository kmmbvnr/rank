import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checkInterrupt } from '@arrrank/interpreter';

const require = createRequire(import.meta.url);
const extension = fileURLToPath(new URL('../native/build/Release/rank_sqlite_interrupt.node', import.meta.url));
let signal: Int32Array | undefined;
interface Bridge { configure(buffer: Buffer): void; synchronized(operation: () => void): void }
let bridge: Bridge | undefined;
// Keep registered connections alive until their explicit, synchronized close.
const connections = new Set<object>();

/** Called only by the interactive interpreter worker, never file or pipe execution. */
export function enableSqliteInterrupt(value: Int32Array): void { signal = value; }

export function attachSqliteInterrupt(database: { loadExtension(path: string, entry: string): unknown }): void {
    if (!signal) return;
    if (!bridge) {
        const loaded = require(extension) as Bridge;
        loaded.configure(Buffer.from(signal.buffer, signal.byteOffset, Int32Array.BYTES_PER_ELEMENT));
        bridge = loaded;
    }
    database.loadExtension(extension, 'sqlite3_rankinterrupt_init');
    connections.add(database);
}

export function closeSqlite(database: { close(): void }): void {
    if (!bridge) { database.close(); return; }
    bridge.synchronized(() => database.close());
    connections.delete(database);
}

/** better-sqlite3 resets the statement before throwing, so the connection is reusable. */
export function sqliteOperation<T>(operation: () => T): T {
    if (!signal) return operation();
    checkSqliteInterrupt();
    try {
        const result = operation();
        checkSqliteInterrupt();
        return result;
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_INTERRUPT') {
            checkSqliteInterrupt();
        }
        throw error;
    }
}

function checkSqliteInterrupt(): void {
    const check = () => checkInterrupt('executing SQLite query');
    // Clear the flag under the monitor lock so a delayed interrupt cannot
    // escape acknowledgement and cancel the next statement.
    if (bridge) bridge.synchronized(check);
    else check();
}
