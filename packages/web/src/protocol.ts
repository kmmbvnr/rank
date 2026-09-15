export interface BrowserFile {
    readonly name: string;
    readonly data: ArrayBuffer;
}

export type WorkerRequest = {
    readonly type: 'run';
    readonly id: number;
    readonly source: string;
    readonly input: string;
    readonly files: readonly BrowserFile[];
};

export type WorkerResponse = {
    readonly type: 'result';
    readonly id: number;
    readonly ok: boolean;
    readonly output: readonly string[];
    readonly durationMs: number;
};
