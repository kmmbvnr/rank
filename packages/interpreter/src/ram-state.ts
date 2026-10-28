import { ownedArray, ownedObject } from './array-storage.js';
import { RankError } from './errors.js';
import { isRankObject, type NativeFunction, type RankValue } from './value.js';
import type { RamGpu } from './mlrank.js';
export interface RamStateDescriptor { readonly id: string; readonly shape: readonly number[]; readonly dtype: 'f32' }
export type OwnRamState = (dispose: () => void) => () => void;
interface State { descriptor: RamStateDescriptor; gpu: RamGpu; free: () => void }
const states = new Map<string, State>();
const functions = new WeakMap<object, () => NativeFunction>();
export function registerRetainFunction(fn: NativeFunction, retain: () => NativeFunction): NativeFunction { functions.set(fn, retain); return fn; }
export function keepRamFunction(value: RankValue): NativeFunction {
    const retain = typeof value === 'object' && value !== null ? functions.get(value) : undefined;
    if (!retain) throw new RankError('gpukeep expects a RAM function', 'TypeError');
    return retain();
}
export function ramState(value: RankValue): State | undefined {
    if (!isRankObject(value) || value.entries.get('kind') !== 'GPU tensor') return;
    const id = value.entries.get('id');
    const state = typeof id === 'string' ? states.get(id) : undefined;
    if (!state) throw new RankError('GPU state has been released or belongs to an expired session', 'GpuState');
    return state;
}
export function retainRamState(descriptor: RamStateDescriptor, gpu: RamGpu, own?: OwnRamState): RankValue {
    if (!gpu.control) throw new RankError('GPU state control is unavailable', 'GpuUnavailable');
    let remove = () => {};
    const state: State = { descriptor, gpu, free() {
        if (!states.has(descriptor.id)) return;
        gpu.control!({action:'releaseState', stateId:descriptor.id});
        states.delete(descriptor.id); remove();
    } };
    states.set(descriptor.id, state);
    remove = own?.(state.free) ?? remove;
    return ownedObject(new Map<string, RankValue>([
        ['kind','GPU tensor'], ['id',descriptor.id], ['dtype','f32'],
        ['shape',ownedArray(descriptor.shape.map(BigInt),[descriptor.shape.length])],
    ]));
}
export function readRamState(value: RankValue): RankValue {
    const state = ramState(value);
    if (!state) throw new RankError('gpuread expects a retained GPU tensor', 'TypeError');
    const size = state.descriptor.shape.reduce((a,b)=>a*b,1);
    const reply = state.gpu.control!({action:'readState',stateId:state.descriptor.id,outputSize:size});
    if (!reply.output || reply.output.length !== size || reply.output.some(v=>!Number.isFinite(v)))
        throw new RankError('Invalid GPU state output', 'GpuExecution');
    return ownedArray([...reply.output], state.descriptor.shape);
}
export function freeRamState(value: RankValue): boolean {
    const state = ramState(value);
    if (!state) throw new RankError('gpufree expects a retained GPU tensor', 'TypeError');
    state.free(); return true;
}
