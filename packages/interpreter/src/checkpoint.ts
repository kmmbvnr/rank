import { ownedArray, derivedArray, readArrayItem, ownedObject } from './array-storage.js';
import { checkedFile, verifyFile } from './file-integrity.js';
import { fileTensorInput, registerFileTensor } from './file-tensor.js';
import { RankError } from './errors.js';
import { parseSafetensorsJson, safetensor, safetensorIndex } from './safetensors.js';
import { isRankArray, isRankFile, isRankObject, type RankFile, type RankValue } from './value.js';
import type { RuntimeContext } from './modules/types.js';

export interface CheckpointManifest {
    weight_map: Record<string, string>;
    files?: Record<string, { size: number; sha256: string }>;
}
const invalid = (message: string): never => { throw new RankError('Checkpoint: ' + message, 'IO'); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Hugging Face weight_map plus an optional lock of shard sizes and SHA-256 digests. */
export function parseCheckpointManifest(text: string): CheckpointManifest {
    const value = parseSafetensorsJson(text);
    if (!object(value) || !object(value.weight_map) || !Object.keys(value.weight_map).length)
        return invalid('expected a nonempty weight_map');
    for (const path of Object.values(value.weight_map))
        if (typeof path !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.safetensors$/.test(path) || path.includes('..'))
            return invalid('shards must be sibling .safetensors files');
    const names = new Set(Object.values(value.weight_map));
    if (names.size > 1024) return invalid('at most 1024 shards are supported');
    if (value.files !== undefined) {
        if (!object(value.files) || Object.keys(value.files).length !== names.size) return invalid('incomplete shard integrity map');
        for (const name of names as Set<string>) {
            const entry = value.files[name];
            if (!object(entry) || !Number.isSafeInteger(entry.size) || Number(entry.size) < 8
                || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))
                return invalid('invalid shard integrity: ' + name);
        }
    }
    return value as unknown as CheckpointManifest;
}
interface State { manifest: CheckpointManifest; size: number; revision: string; shards: Map<string, RankFile>; verified: Set<string> }
const states = new WeakMap<RankFile, State>();
export function isCheckpoint(value: RankValue): value is RankFile {
    return isRankFile(value) && value.handle.name.endsWith('.safetensors.index.json');
}
function state(value: RankFile): State {
    checkedFile(value);
    const size = value.handle.size(), revision = value.handle.revision?.(), cached = states.get(value);
    if (revision === undefined) return invalid('file revisions are unavailable on this host');
    if (cached) {
        if (size !== cached.size || revision !== cached.revision) invalid('index changed; reopen the checkpoint');
        return cached;
    }
    if (size > 16 * 1024 * 1024) return invalid('index exceeds 16 MiB');
    const position = value.handle.position(); let text: string;
    try {
        value.handle.seek(0); const data = value.handle.read(size);
        if (data.length !== size) return invalid('truncated index');
        text = new TextDecoder('utf-8', {fatal:true}).decode(data);
    } finally { value.handle.seek(position); }
    if (size !== value.handle.size() || revision !== value.handle.revision?.()) return invalid('index changed while reading');
    const result = {manifest:parseCheckpointManifest(text!),size,revision,shards:new Map<string,RankFile>(),verified:new Set<string>()};
    states.set(value,result); return result;
}
function shard(source: RankFile, name: string, context: RuntimeContext, verify: boolean): RankFile {
    const current = state(source);
    let file = current.shards.get(name);
    if (!file) {
        if (!context.io) return invalid('filesystem access is unavailable');
        const directory = source.handle.name.replace(/[^/\\]*$/, '');
        file = {kind:'file',closed:false,handle:context.io.open(directory + name,'read')};
        context.ownFile(file);
        const revision = file.handle.revision?.bind(file.handle);
        const stat = file.handle.stat?.bind(file.handle);
        // Every tensor cell/descriptor also validates its parent index's lifetime and version.
        if (revision) file.handle.revision = () => { state(source); return revision(); };
        if (stat) file.handle.stat = () => { state(source); return stat(); };
        const entries = safetensorIndex(file);
        if (!isRankArray(entries)) return invalid('invalid shard index');
        const actual = new Set(entries.items.map(row => isRankObject(row) ? row.entries.get('name') : invalid('invalid tensor metadata')));
        const wanted = Object.keys(current.manifest.weight_map).filter(key => current.manifest.weight_map[key] === name);
        if (actual.size !== wanted.length || wanted.some(key => !actual.has(key))) return invalid('shard tensor names do not match weight_map: ' + name);
        current.shards.set(name,file);
    }
    if (verify && !current.verified.has(name)) {
        const integrity = current.manifest.files?.[name];
        if (!integrity) return invalid('tensor access requires locked shard sizes and SHA-256 digests');
        if (file.handle.size() !== integrity.size) return invalid('shard size mismatch: ' + name);
        verifyFile(file,integrity.sha256); current.verified.add(name);
    }
    return checkedFile(file);
}
export function checkpointIndex(source: RankFile, context: RuntimeContext): RankValue {
    const current = state(source), rows: RankValue[] = [];
    for (const name of new Set(Object.values(current.manifest.weight_map))) {
        const values = safetensorIndex(shard(source,name,context,false));
        if (!isRankArray(values)) return invalid('invalid shard index');
        for (const row of values.items) {
            if (!isRankObject(row)) return invalid('invalid tensor metadata');
            const fields = row.entries;
            rows.push(ownedObject([...fields, ['file',name]]));
        }
    }
    return ownedArray(rows);
}
export function checkpointTensor(source: RankFile, name: RankValue, context: RuntimeContext): RankValue {
    if (typeof name !== 'string') return invalid('tensor name must be text');
    const current = state(source);
    if (!Object.prototype.hasOwnProperty.call(current.manifest.weight_map,name)) return invalid('unknown tensor: ' + name);
    const value = safetensor(shard(source,current.manifest.weight_map[name],context,true),name);
    if (!isRankArray(value)) return value;
    const result = derivedArray(value.shape,[source,value],i=>{state(source);return readArrayItem(value,i);});
    registerFileTensor(result,()=>{state(source);return fileTensorInput(value)!;});
    return result;
}
export function closeCheckpoint(source: RankFile): void {
    const current = states.get(source);
    if (!current) return;
    for (const file of current.shards.values()) if (!file.closed) {file.handle.close();file.closed=true;}
}
