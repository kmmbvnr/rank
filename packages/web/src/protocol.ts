import type { SessionSnapshot } from '@arrrank/common/repl-session';
import type { PauseSnapshot } from '@arrrank/interpreter';

export interface BrowserFile { readonly name: string; readonly data: ArrayBuffer }
export interface ProgramInputValue { name: string; valueType: string; many: boolean; values: string[] }
export type SessionMethod = 'setInputs' | 'execute' | 'preview' | 'prepareFunctions' | 'rewind' | 'resetExecution' | 'debugExecute' | 'turboExecute' | 'setDebugBreakpoints' | 'inspect' | 'extend' | 'setModules';
export interface WorkerRequest { id: number; method: SessionMethod; args: unknown[] }
export interface WorkerInit { nativeRam?: boolean; signal?: SharedArrayBuffer; signalUrl?: string; modules?: Record<string, string>; attachments?: Record<string, string>; inputs?: ProgramInputValue[]; files?: BrowserFile[] }
export interface WorkerResponse {
    id: number;
    result?: unknown;
    error?: string;
    snapshot: SessionSnapshot;
    pause?: PauseSnapshot;
}
