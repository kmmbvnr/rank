import { flatFieldRevision } from '../field-contracts.js';
import { recordContract } from '../record-contract.js';
import { semanticRecordType, semanticValueType } from './semantic-array-type.js';
import { isRankRecord, type CollectionElementType, type RankValue } from './value.js';

type Fields = NonNullable<CollectionElementType['fields']>;
interface Encoding { revision: object; full?: string; ranks?: string }
const encoded = new WeakMap<Fields, Encoding>();

/** Cache only runtime-owned immutable metadata. Live/untracked maps retain the
 * ordinary encoder, including its current Unicode collation/insertion order.
 * No entry retains a record value, array data or a computed plan result. */
export function semanticValueSignature(value: RankValue, elements = true): string {
    if (!isRankRecord(value)) return JSON.stringify(semanticValueType(value, elements));
    const contract = recordContract(value), fields = contract.fields!;
    const revision = flatFieldRevision(fields), mode = elements ? 'full' : 'ranks';
    if (revision === undefined) return JSON.stringify(semanticRecordType(contract, elements));
    let entry = encoded.get(fields);
    if (entry?.revision === revision && entry[mode] !== undefined) return entry[mode]!;
    const key = JSON.stringify(semanticRecordType(contract, elements));
    if (!entry || entry.revision !== revision) encoded.set(fields, entry = { revision });
    entry[mode] = key;
    return key;
}
