import { compiledScalarTypes, type CompiledScalarType, type CompiledArrayType, type CompiledFunctionType } from '@arrrank/language';
import { arrayRevision, denseScalarItems, storedScalarKinds, typedElementKind } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { semanticArrayType } from './semantic-array-type.js';
import { isRankIndex, isRankSet, type RankArray, type RankValue } from './value.js';
import { IntegerEntries } from './integer-entries.js';
import { prepareSetAdd } from './collections.js';
import { IndexEntries } from './index-storage.js';
import { RankDeque } from './containers.js';
import { valueProtection } from './value-protection.js';
import type { CompiledCalleeType } from './compiled-callee-type.js';

const dequeMethods = Object.entries(Object.getOwnPropertyDescriptors(RankDeque.prototype));

export function nativeDequeMethods(): boolean {
    return dequeMethods.every(([name, descriptor]) => {
        const current = Object.getOwnPropertyDescriptor(RankDeque.prototype, name);
        return current?.value === descriptor.value && current?.get === descriptor.get && current?.set === descriptor.set;
    });
}

/** Entry proofs must not admit host overrides that can re-enter the interpreter. */
export function hasIntegerDequeIteration(value: RankValue): value is RankDeque {
    if (typeof value !== 'object' || Object.getPrototypeOf(value) !== RankDeque.prototype) return false;
    for (const [name, descriptor] of dequeMethods) {
        const current = Object.getOwnPropertyDescriptor(RankDeque.prototype, name);
        if (Object.prototype.hasOwnProperty.call(value, name) || current?.value !== descriptor.value
            || current?.get !== descriptor.get || current?.set !== descriptor.set) return false;
    }
    return (value as RankDeque).integers;
}

/** Tracked integer indices retain a constant-time domain proof on mutation. */
export function compiledEntryArgumentType(value: RankValue): CompiledCalleeType | undefined {
    if (isRankIndex(value) && value.entries instanceof IndexEntries && value.entries.integers && !valueProtection(value)) return { kind: 'index' };
    if (isRankSet(value) && prepareSetAdd(value) && value.entries instanceof IntegerEntries && value.entries.integers) return { kind: 'set' };
    if (hasIntegerDequeIteration(value) && !valueProtection(value)) return { kind: 'deque', mode: value.mode };
    return checkedArgumentType(value, true);
}

interface Entry {
    readonly revision: number;
    readonly rank: number;
    readonly element: string;
    readonly type?: CompiledArrayType;
}
const arrays = new WeakMap<RankArray, Entry>();

/** Scalar domains require no storage reads or coercion. */
export function compiledScalarType(value: RankValue | undefined): CompiledScalarType | undefined {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'text';
    return undefined;
}

/** Select a semantic domain only after proving that array reads cannot run code.
 * Never inspect lazy caches or host cells. Reuse cell checks at the same revision. */
export function compiledArgumentType(value: RankValue): CompiledFunctionType | undefined {
    return checkedArgumentType(value, false);
}

function checkedArgumentType(value: RankValue, stored: boolean): CompiledFunctionType | undefined {
    const scalarValue = compiledScalarType(value);
    if (scalarValue) return scalarValue;
    if (typeof value !== 'object' || value === null) return undefined;
    const array = value as RankArray;
    const cells = denseScalarItems(array);
    if (!cells) return undefined;
    const revision = arrayRevision(array);
    if (revision === undefined) return undefined;
    // Entry code may prove a domain from completed trusted storage without
    // changing the array's public semantic type or its return contract key.
    const kinds = stored ? storedScalarKinds(array) : undefined;
    const element = semanticArrayType(array).scalar ?? (kinds?.length === 1 ? kinds[0] : undefined);
    const scalar = compiledScalarTypes.find(type => type === element);
    if (!scalar) return undefined;
    const rank = array.shape.length;
    const previous = arrays.get(array);
    if (previous?.revision === revision && previous.rank === rank && previous.element === scalar) return previous.type;
    const expected = scalar === 'integer' ? 'bigint' : scalar === 'real' ? 'number' : scalar === 'text' ? 'string' : 'boolean';
    let matches = true;
    if (typedElementKind(array) !== scalar) for (let index = 0; index < cells.length; index++) {
        if ((index & 4095) === 0) checkpoint('checking array argument', 4096);
        if (typeof cells[index] !== expected) { matches = false; break; }
    }
    const type = matches ? { kind: 'array' as const, element: scalar, rank } : undefined;
    arrays.set(array, { revision, rank, element: scalar, type });
    return type;
}
