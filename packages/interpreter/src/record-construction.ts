import { RankError } from './errors.js';
import { materializeValue } from './materialize.js';
import { recordContract } from './record-contract.js';
import { ResourceMap } from './resource-summary.js';
import { isRankRecord, typeName, type RankRecord, type RankValue } from './value.js';

/** Shared by prepared and generated constructors; retain resource and field contracts. */
export function createRecord(): RankRecord {
    const entries = new ResourceMap<RankValue>(value => value);
    return entries.resources.track({ kind: 'record', entries, types: new Map() });
}

export function checkNewRecordField(record: RankRecord, name: string): void {
    if (record.entries.has(name)) throw new RankError(`duplicate record field: .${name}`);
}

export function initializeRecordField(record: RankRecord, name: string, value: RankValue): void {
    const stored = materializeValue(value);
    record.entries.set(name, stored);
    record.types.set(name, typeName(stored));
}

export function copyRecordForUpdate(source: RankValue): RankRecord {
    if (!isRankRecord(source)) throw new RankError('with expects a record', 'TypeError');
    const record = createRecord();
    for (const [name, type] of source.types) record.types.set(name, type);
    record.fieldContracts = new Map(recordContract(source).fields);
    for (const [name, value] of source.entries) record.entries.set(name, value);
    return record;
}
