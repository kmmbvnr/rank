import type { RamStateDescriptor } from './ram-state.js';
import type { FileTensorInput } from './file-tensor.js';
export interface RamModelFile { path: string; size: number; sha256: string }
/** Bounded client handles for the native LRU. Retry stale handles once after
 * eviction/restart; ordinary execution errors are never retried. */
export interface RamRequest {
    inputDtypes?: readonly ('f32'|'i32')[];
    action: 'load' | 'invoke' | 'release' | 'readState' | 'releaseState';
    stateId?: string; inputStates?: readonly (string | null)[]; retainOutput?: boolean; inputNames?: readonly string[]; outputName?: string; profile?: boolean; reservationBytes?: number; model?: string; modelId?: string;
    inputFiles?: readonly (FileTensorInput | null)[]; modelFile?: RamModelFile; inputSizes?: readonly number[]; input?: readonly number[]; outputSize?: number;
}
export interface RamReply {
    state?: RamStateDescriptor; residentStates?: number; stateBytes?: number; stateInputsReused?: number; outputBytesRead?: number;
    residentBytes?: number; residentModels?: number; memoryBudgetBytes?: number; cacheEvictions?: number;
    error?: string; code?: string; modelId?: string; output?: number[];
    fullyAccelerated?: boolean; gpuOnlyRequested?: boolean;
    fileBytesRead?: number; fileInputsReused?: number; pssBytes?: number;
    inputMs?: number; dispatchMs?: number; readbackMs?: number; outputMs?: number; peakRssBytes?: number;
    cached?: boolean; prepareMs?: number; executeMs?: number; backend?: string;
}
export function createRamClient(send: (request: RamRequest) => RamReply) {
    const handles = new Map<object | string, string>();
    const check = (reply: RamReply): RamReply => {
        if (reply.error) throw new Error(reply.error);
        if (!reply.fullyAccelerated && !reply.gpuOnlyRequested) throw new Error('RAM GPU execution was not requested');
        return reply;
    };
    return {
        stateControl(request: {action:'readState'|'releaseState';stateId:string;outputSize?:number}) {
            const reply = send(request);
            if (reply.error) throw new Error(reply.error);
            return reply;
        },
        release() {
            for (const [key, modelId] of handles) {
                const reply = send({ action: 'release', modelId });
                if (reply.error) throw new Error(reply.error);
                handles.delete(key);
            }
        },
        invoke(key: object | string, encode: () => string | RamModelFile, input: readonly number[], outputSize: number, inputSizes?: readonly number[], inputFiles?: readonly (FileTensorInput | null)[], reservationBytes?: number, inputDtypes?: readonly ('f32'|'i32')[], options?: Pick<RamRequest, 'inputStates'|'retainOutput'|'inputNames'|'outputName'>): RamReply {
            let prepareMs = 0, loaded = false;
            let modelId = handles.get(key);
            for (let attempt = 0; attempt < 2; attempt++) {
                if (!modelId) {
                    const source = encode();
                    const reply = check(send({ action: 'load', ...(options?.inputNames ? {inputNames:options.inputNames,outputName:options.outputName} : {}), ...(typeof source === 'string' ? { model: source } : { modelFile: source }), ...(inputSizes ? {inputSizes} : {}), ...(inputDtypes ? {inputDtypes} : {}), ...(reservationBytes !== undefined ? {reservationBytes} : {}) }));
                    if (!reply.modelId) throw new Error('RAM runtime returned no model identifier');
                    modelId = reply.modelId; loaded = true;
                    handles.set(key, modelId);
                    if (handles.size > 4) {
                        const oldest = handles.keys().next().value!;
                        const released = send({action:'release', modelId:handles.get(oldest)});
                        if (released.error) throw new Error(released.error);
                        handles.delete(oldest);
                    }
                    prepareMs += reply.prepareMs ?? 0;
                }
                const reply = send({ action: 'invoke', modelId, input, outputSize, ...(options?.inputStates ? {inputStates:options.inputStates} : {}), ...(options?.retainOutput ? {retainOutput:true} : {}), ...(inputFiles ? {inputFiles} : {}) });
                if (reply.code === 'STALE_MODEL') { handles.delete(key); modelId = undefined; continue; }
                check(reply);
                handles.delete(key); handles.set(key, modelId);
                return { ...reply, cached: !loaded, prepareMs: prepareMs + (reply.prepareMs ?? 0) };
            }
            throw new Error('RAM model expired again after reload');
        },
    };
}
