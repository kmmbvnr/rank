import type { SessionSnapshot } from '@arrrank/common/repl-session';
import type { PauseSnapshot } from '@arrrank/interpreter';

export interface BrowserFile { readonly name: string; readonly data: ArrayBuffer }
export type SessionMethod = 'execute' | 'preview' | 'prepareFunctions' | 'rewind' | 'resetExecution' | 'debugExecute' | 'setDebugBreakpoints';
export interface WorkerRequest { id: number; method: SessionMethod; args: unknown[] }
export interface WorkerInit { signal?: SharedArrayBuffer; signalUrl?: string }
export interface WorkerResponse {
    id: number;
    result?: unknown;
    error?: string;
    snapshot: SessionSnapshot;
    pause?: PauseSnapshot;
}
