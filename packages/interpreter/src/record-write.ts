import { checkValueMutable } from './value-protection.js';
import { bindingTypeMessage } from '@arrrank/language';
import { noteArrayBinding } from './array-storage.js';
import { RankError } from './errors.js';
import { materializeValue } from './materialize.js';
import type { Operators } from './operators.js';
import { demandValue } from './plan.js';
import { checkRecordField } from './record-contract.js';
import { typeName, type RankRecord, type RankValue } from './value.js';

/** `Record .field = Value` or `op=`: the field keeps its type and contract. */
export function assignRecordField(
    record: RankRecord,
    field: string,
    operator: string,
    value: RankValue,
    operators: Operators,
): RankValue {
    checkValueMutable(record);
    const previous = record.entries.get(field);
    if (previous === undefined) {
        throw new RankError(`unknown record field: .${field}`);
    }
    const result = materializeValue(operator === '='
        ? value
        : operators.evaluateBinary(operator.slice(0, -1), demandValue(previous), demandValue(value)));
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
