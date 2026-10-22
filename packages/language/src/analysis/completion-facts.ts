import type { ArrayElementContract } from './array-binding-contract.js';
import type { Types } from './types.js';
import type { ValueFacts } from './value-domain.js';

/** Ordinary bindings retain completed values, independently of expression kinds. */
export function completedTypes(types: Types): Types {
    return types.includes('sequence') ? [...new Set(types.map(type => type === 'sequence' ? 'array' : type))] : types;
}

/** Transfer known metadata; unknown sequence cells may add tensor axes. */
export function completedValueFacts(value: ValueFacts): ValueFacts {
    if (value.completion === 'ready') return value;
    const sequence = value.types.includes('sequence');
    const stacked = sequence && (!value.elements?.length
        || value.elements.some(type => ['array', 'bytes', 'sequence'].includes(type)));
    const { unbounded, openRange, ...facts } = value;
    return { ...(sequence ? facts : value), types: completedTypes(value.types), completion: 'ready',
        ...(value.acceptedTypes ? { acceptedTypes: completedTypes(value.acceptedTypes) } : {}),
        ...(value.elements ? { elements: completedTypes(value.elements) } : {}),
        ...(value.positions ? { positions: value.positions.map(completedTypes) } : {}),
        ...(value.positionFacts ? { positionFacts: value.positionFacts.map(completedValueFacts) } : {}),
        ...(value.tupleItems ? { tupleItems: value.tupleItems.map(completedValueFacts) } : {}),
        ...(value.fields ? { fields: Object.fromEntries(Object.entries(value.fields)
            .map(([name, field]) => [name, completedValueFacts(field)])) } : {}),
        ...(value.elementRecord ? { elementRecord: completedValueFacts(value.elementRecord) } : {}),
        ...(value.acceptedRecordContract ? { acceptedRecordContract: completedValueFacts(value.acceptedRecordContract) } : {}),
        ...(value.declaredArrayContract ? { declaredArrayContract: completedContract(value.declaredArrayContract) } : {}),
        ...(value.acceptedArrayContract ? { acceptedArrayContract: completedContract(value.acceptedArrayContract) } : {}),
        ...(value.elements?.length && value.elements.every(type =>
            ['integer', 'real', 'boolean', 'text', 'symbol', 'date', 'datetime', 'duration', 'missing', 'numeric-limit'].includes(type))
            && value.types.every(type => ['array', 'bytes', 'sequence'].includes(type))
            ? { eagerScalarCells: true as const } : {}),
        ...(stacked ? { rank: undefined, shape: undefined, dims: undefined, elements: undefined,
            positions: undefined, positionFacts: undefined, eagerScalarCells: undefined,
            callbackFreeScalarCells: undefined } : {}),
    };
}

/** Completing an opaque reader can re-enter Rank and change captured state. */
export function completionMayCall(value: ValueFacts): boolean {
    if (value.completion === 'ready' || value.completion === 'pure' || value.bottom) return false;
    if (value.completion === 'may-call' || !value.types.length) return true;
    return value.types.some(type => {
        if (type === 'array' || type === 'sequence') return !(value.eagerScalarCells || value.callbackFreeScalarCells);
        if (type === 'tuple') return !value.tupleItems || value.tupleItems.some(completionMayCall);
        if (type === 'record') return !value.closedRecord || !value.fields
            || Object.values(value.fields).some(completionMayCall);
        if (['queue', 'stack', 'deque', 'index', 'set', 'counter', 'heap'].includes(type)) {
            return !value.elements || value.elements.some(type =>
                !['integer', 'real', 'boolean', 'text', 'symbol', 'date', 'datetime', 'duration', 'missing'].includes(type));
        }
        return false;
    });
}

function completedContract(value: ArrayElementContract): ArrayElementContract {
    return { ...value, type: value.type === 'sequence' ? 'array' : value.type,
        ...(value.positions ? { positions: value.positions.map(choices => choices.map(completedContract)) } : {}),
        ...(value.elements ? { elements: value.elements.map(completedContract) } : {}),
        ...(value.fields ? { fields: Object.fromEntries(Object.entries(value.fields)
            .map(([name, choices]) => [name, choices.map(completedContract)])) } : {}),
    };
}
