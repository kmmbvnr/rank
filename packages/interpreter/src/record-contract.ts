import { bindingTypeMessage } from '@arrrank/language';
import { MissingValueError, RankError } from './errors.js';
import type { Operators } from './operators.js';
import { noteArrayBinding, readArrayItem } from './array-storage.js';
import { collectionElementType, isRankTuple, isRankArray, isRankRecord, mergeCollectionElementType, typeName,
    type CollectionElementType, type RankRecord, type RankValue } from './value.js';

/** Native records acquire the same contract before their first mutation or use as a return value. */
export function recordContract(value: RankRecord): CollectionElementType {
    const contract = collectionElementType(value, new Set(), true);
    retainRecordContract(value, contract);
    return contract;
}

/** Install refined empty-array contracts only after every field has passed validation. */
export function retainRecordContract(value: RankValue, contract: CollectionElementType): void {
    if (isRankTuple(value) && contract.positions) {
        value.items.forEach((item, index) => retainRecordContract(item, contract.positions![index]));
        return;
    }
    const containsRecords = (type: CollectionElementType): boolean => !!type.fields || !!type.elements?.some(containsRecords) || !!type.positions?.some(containsRecords);
    if (isRankArray(value) && contract.elements?.some(containsRecords)) {
        const size = value.shape.reduce((a, b) => a * b, 1);
        for (let index = 0; index < size; index++) {
            let cell: RankValue;
            try {
                cell = readArrayItem(value, index);
            } catch (error) {
                if (error instanceof MissingValueError) continue;
                throw error;
            }
            const expected = contract.elements.find(type => type.type === typeName(cell)
                && type.rank === (isRankArray(cell) ? cell.shape.length : undefined));
            if (expected) retainRecordContract(cell, expected);
        }
        return;
    }
    if (!isRankRecord(value) || !contract.fields) return;
    const fields = value.fieldContracts ??= new Map();
    for (const [name, field] of contract.fields) {
        const item = value.entries.get(name)!;
        retainRecordContract(item, field);
        fields.set(name, isRankRecord(item) ? { ...field, fields: item.fieldContracts } : field);
    }
}

export function checkRecordField(record: RankRecord, field: string, value: RankValue): void {
    recordContract(record);
    const received = collectionElementType(value, new Set(), true);
    const expected = record.fieldContracts!.get(field)!;
    let contract: CollectionElementType;
    try {
        contract = mergeCollectionElementType(`record field .${field}`, expected, received);
    } catch (error) {
        if (!(error instanceof RankError)) throw error;
        const kind = expected.type === received.type && expected.rank !== received.rank ? 'DimensionMismatch' : 'TypeError';
        throw new RankError(error.message, kind);
    }
    retainRecordContract(value, contract);
    record.fieldContracts!.set(field, isRankRecord(value) ? { ...contract, fields: value.fieldContracts } : contract);
}

/** `Record .field = Value` or `op=`: the field keeps its type and contract. */
export function assignRecordField(
    record: RankRecord,
    field: string,
    operator: string,
    value: RankValue,
    operators: Operators,
): RankValue {
    const previous = record.entries.get(field);
    if (previous === undefined) {
        throw new RankError(`unknown record field: .${field}`);
    }
    const result = operator === '='
        ? value
        : operators.evaluateBinary(operator.slice(0, -1), previous, value);
    const expected = record.types.get(field)!;
    const received = typeName(result);
    if (expected !== received) {
        throw new RankError(bindingTypeMessage(`record field .${field}`, [expected], [received]));
    }
    checkRecordField(record, field, result);
    noteArrayBinding(result);
    record.entries.set(field, result);
    record.key = undefined;
    return result;
}
