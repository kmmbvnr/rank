import { inheritSemanticArrayType } from './semantic-array-type.js';
import { ownedArray, readArrayItem } from './array-storage.js';
import { ByteArray } from './bytes.js';
import { recordContract, retainRecordContract } from './record-contract.js';
import {
    tuple, isRankTuple, isRankArray, isRankBytes, isRankCounter, isRankIndex, isRankObject, isRankQueue, isRankRecord, isRankSet,
    type RankRecord, type RankValue,
} from './value.js';

/** Detach the ordinary mutable values a preview function can reach. */
export function clonePreviewValue(value: RankValue): RankValue {
    if (typeof value !== 'object') return value;
    if (isRankTuple(value)) return tuple(value.items.map(clonePreviewValue));
    if (isRankBytes(value)) return new ByteArray(value.data.slice());
    if (isRankArray(value)) {
        const size = value.shape.reduce((product, dimension) => product * dimension, 1);
        return inheritSemanticArrayType(value, ownedArray(Array.from({ length: size }, (_, index) =>
            clonePreviewValue(readArrayItem(value, index))), value.shape, false, value.columnNames));
    }
    if (isRankIndex(value)) return { kind: 'index', entries: new Map([...value.entries]
        .map(([key, item]) => [key, clonePreviewValue(item)])) };
    if (isRankQueue(value)) return { kind: 'queue', items: value.items.map(clonePreviewValue) };
    if (isRankSet(value)) return { kind: 'set', entries: new Map([...value.entries]
        .map(([key, item]) => [key, clonePreviewValue(item)])) };
    if (isRankCounter(value)) return { kind: 'counter', entries: new Map([...value.entries]
        .map(([key, item]) => [key, { value: clonePreviewValue(item.value), count: item.count }])) };
    if (isRankObject(value)) return { kind: 'object', entries: new Map([...value.entries]
        .map(([key, item]) => [key, clonePreviewValue(item)])) };
    if (isRankRecord(value)) {
        const copy: RankRecord = { kind: 'record', entries: new Map([...value.entries]
            .map(([key, item]) => [key, clonePreviewValue(item)])), types: new Map(value.types) };
        retainRecordContract(copy, recordContract(value));
        return copy;
    }
    return value;
}
