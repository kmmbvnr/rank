import { INPUT_TYPES } from '@arrrank/language';
import { readArrayItem, storedScalarKinds, typedElementKind } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { demandValue } from './plan.js';
import { isRankArray, typeName, type RankValue } from './value.js';

/** Rank's element type name for a declared input type. */
const elementType = (valueType: string): string => valueType === 'path' ? 'text' : valueType;

function matchesScalar(valueType: string, value: RankValue): boolean {
    if (valueType === 'integer') return typeof value === 'bigint';
    if (valueType === 'real') return typeof value === 'number';
    if (valueType === 'text' || valueType === 'path') return typeof value === 'string';
    if (valueType === 'boolean') return typeof value === 'boolean';
    return false;
}

export function validateInputValue(name: string, valueType: string, value: RankValue): void {
    if (matchesScalar(valueType, value)) return;
    if (!INPUT_TYPES.includes(valueType)) {
        throw new RankError(`unknown input type: ${valueType}`);
    }
    throw new RankError(`${name} expects ${valueType}, got ${typeName(value)}`);
}

/**
 * The contract an `arg` line states for a value: its element type, whether it
 * is an array, and optionally its exact dimensions. A shape contract checks
 * dimensions; it never reshapes.
 */
export interface InputContract {
    readonly name: string;
    readonly valueType: string;
    readonly array: boolean;
    readonly shape?: readonly number[];
}

const describe = (contract: InputContract): string => contract.shape
    ? `${contract.valueType} array shape ${contract.shape.join(' ')}`
    : contract.array ? `${contract.valueType} array` : contract.valueType;

/** Check one argument against its contract before the function body runs. */
export function checkInputContract(contract: InputContract, argument: RankValue): void {
    const value = demandValue(argument);
    if (!contract.array && !contract.shape) { validateInputValue(contract.name, contract.valueType, value); return; }
    const mismatch = (): never => {
        const found = isRankArray(value) ? `array shape ${value.shape.join(' ')}` : typeName(value);
        throw new RankError(`${contract.name} expects ${describe(contract)}, got ${found}`);
    };
    if (!isRankArray(value)) return mismatch();
    const { shape } = contract;
    if (shape && (value.shape.length !== shape.length || value.shape.some((size, axis) => size !== shape[axis]))) {
        return mismatch();
    }
    if (!INPUT_TYPES.includes(contract.valueType)) throw new RankError(`unknown input type: ${contract.valueType}`);
    const wanted = elementType(contract.valueType);
    // Typed or stored storage already knows its element kinds without a scan.
    const known = typedElementKind(value);
    const kinds = known ? [known] : storedScalarKinds(value);
    if (kinds) { if (!kinds.every(kind => kind === wanted)) mismatch(); return; }
    const size = value.shape.reduce((count, extent) => count * extent, 1);
    for (let index = 0; index < size; index++) {
        if ((index & 4095) === 0) checkpoint('checking argument contract', Math.min(4096, size - index));
        if (!matchesScalar(contract.valueType, readArrayItem(value, index))) mismatch();
    }
}
