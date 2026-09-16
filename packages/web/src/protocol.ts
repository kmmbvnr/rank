import type { SessionSnapshot } from '@arrrank/common/repl-session';

export interface BrowserFile { readonly name: string; readonly data: ArrayBuffer }
export type SessionMethod = 'execute' | 'preview' | 'prepareFunctions' | 'rewind' | 'resetExecution';
export interface WorkerRequest { id: number; method: SessionMethod; args: unknown[] }
export interface WorkerResponse {
    id: number;
    result?: unknown;
    error?: string;
    snapshot: SessionSnapshot;
}
