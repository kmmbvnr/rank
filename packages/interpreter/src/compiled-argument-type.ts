import { compiledScalarTypes, type CompiledArrayType, type CompiledFunctionType } from '@arrrank/language';
import { arrayRevision, denseScalarItems, typedElementKind } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { semanticArrayType } from './semantic-array-type.js';
import type { RankArray, RankValue } from './value.js';

interface Entry {
    readonly revision: number;
    readonly rank: number;
    readonly element: string;
    readonly type?: CompiledArrayType;
}
const arrays = new WeakMap<RankArray, Entry>();

/** Select a semantic domain only after proving that array reads cannot run code.
 * Never inspect lazy caches or host cells. Reuse cell checks at the same revision. */
export function compiledArgumentType(value: RankValue): CompiledFunctionType | undefined {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'text';
    if (typeof value !== 'object' || value === null) return undefined;
    const array = value as RankArray;
    const cells = denseScalarItems(array);
    if (!cells) return undefined;
    const revision = arrayRevision(array);
    if (revision === undefined) return undefined;
    const element = semanticArrayType(array).scalar;
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
