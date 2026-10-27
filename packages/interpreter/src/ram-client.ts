/** One resident native model. A stale handle is retried once after a runtime restart
 * or another client loading a model. Execution failures are never retried. */
export interface RamRequest {
    action: 'load' | 'invoke' | 'release'; profile?: boolean; model?: string; modelId?: string;
    inputSizes?: readonly number[]; input?: readonly number[]; outputSize?: number;
}
export interface RamReply {
    error?: string; code?: string; modelId?: string; output?: number[];
    fullyAccelerated?: boolean; gpuOnlyRequested?: boolean;
    inputMs?: number; dispatchMs?: number; readbackMs?: number; outputMs?: number; peakRssBytes?: number;
    cached?: boolean; prepareMs?: number; executeMs?: number; backend?: string;
}
export function createRamClient(send: (request: RamRequest) => RamReply) {
    let current: object | string | undefined, modelId: string | undefined;
    const check = (reply: RamReply): RamReply => {
        if (reply.error) throw new Error(reply.error);
        if (!reply.fullyAccelerated && !reply.gpuOnlyRequested) throw new Error('RAM GPU execution was not requested');
        return reply;
    };
    return {
        release() {
            if (modelId) {
                const reply = send({ action: 'release', modelId });
                if (reply.error) throw new Error(reply.error);
            }
            current = modelId = undefined;
        },
        invoke(key: object | string, encode: () => string, input: readonly number[], outputSize: number, inputSizes?: readonly number[]): RamReply {
            let prepareMs = 0, loaded = false;
            for (let attempt = 0; attempt < 2; attempt++) {
                if (current !== key || !modelId) {
                    // Loading atomically replaces the runtime's single resident model.
                    current = modelId = undefined;
                    const reply = check(send({ action: 'load', model: encode(), ...(inputSizes ? {inputSizes} : {}) }));
                    if (!reply.modelId) throw new Error('RAM runtime returned no model identifier');
                    modelId = reply.modelId; current = key; loaded = true;
                    prepareMs += reply.prepareMs ?? 0;
                }
                const reply = send({ action: 'invoke', modelId, input, outputSize });
                if (reply.code === 'STALE_MODEL') { current = modelId = undefined; continue; }
                check(reply);
                return { ...reply, cached: !loaded, prepareMs: prepareMs + (reply.prepareMs ?? 0) };
            }
            throw new Error('RAM model expired again after reload');
        },
    };
}
