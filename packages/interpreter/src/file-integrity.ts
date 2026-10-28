import { RankError } from './errors.js';
import { isRankFile, type RankFile, type RankValue } from './value.js';
const verified = new WeakMap<RankFile, { size: number; revision: string }>();
export function checkedFile(value: RankValue): RankFile {
    if (!isRankFile(value)) throw new RankError('Expected an open file', 'IO');
    if (value.closed) throw new RankError('File is closed', 'IO');
    const prior = verified.get(value);
    if (prior && (value.handle.size() !== prior.size || value.handle.revision?.() !== prior.revision))
        throw new RankError('Verified file changed; reopen the checkpoint', 'IO');
    return value;
}
export function verifyFile(value: RankValue, expected: RankValue): RankFile {
    const file = checkedFile(value);
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
        throw new RankError('verify requires a lowercase SHA-256 hex digest', 'IO');
    const size = file.handle.size(), revision = file.handle.revision?.();
    if (!file.handle.sha256 || revision === undefined)
        throw new RankError('Streaming checksum verification is unavailable on this host', 'IO');
    if (file.handle.sha256() !== expected) throw new RankError('File checksum mismatch: ' + file.handle.name, 'IO');
    if (size !== file.handle.size() || revision !== file.handle.revision?.())
        throw new RankError('File changed during checksum verification', 'IO');
    verified.set(file, {size, revision});
    return file;
}
