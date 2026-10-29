import { RankError } from './errors.js';
import { isRankFile, type RankFile, type RankValue } from './value.js';
const verified = new WeakMap<RankFile, { size: number; revision: string }>();
function openFile(value: RankValue): RankFile {
    if (!isRankFile(value)) throw new RankError('Expected an open file', 'IO');
    if (value.closed) throw new RankError('File is closed', 'IO');
    return value;
}
/** A fresh observation shared by integrity and format checks at one access boundary. */
export function checkedFileStatus(value: RankValue): { file: RankFile; size: number; revision?: string } {
    const file = openFile(value);
    const status = file.handle.stat?.() ?? { size: file.handle.size(), revision: file.handle.revision?.() };
    const prior = verified.get(file);
    if (prior && (status.size !== prior.size || status.revision !== prior.revision))
        throw new RankError('Verified file changed; reopen the checkpoint', 'IO');
    return { file, ...status };
}
export function checkedFile(value: RankValue): RankFile {
    const file = openFile(value);
    if (verified.has(file)) checkedFileStatus(file);
    return file;
}
export function verifyFile(value: RankValue, expected: RankValue): RankFile {
    const { file, size, revision } = checkedFileStatus(value);
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
        throw new RankError('verify requires a lowercase SHA-256 hex digest', 'IO');
    if (!file.handle.sha256 || revision === undefined)
        throw new RankError('Streaming checksum verification is unavailable on this host', 'IO');
    if (file.handle.sha256() !== expected) throw new RankError('File checksum mismatch: ' + file.handle.name, 'IO');
    const after = checkedFileStatus(file);
    if (size !== after.size || revision !== after.revision)
        throw new RankError('File changed during checksum verification', 'IO');
    verified.set(file, {size, revision});
    return file;
}
