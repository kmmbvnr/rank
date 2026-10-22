import type { ArrayElementContract } from './array-binding-contract.js';
import type { Types } from './types.js';
import type { ValueFacts } from './value-domain.js';

/** Ordinary bindings retain completed values, independently of expression kinds. */
export function completedTypes(types: Types): Types {
    return types.includes('sequence') ? [...new Set(types.map(type => type === 'sequence' ? 'array' : type))] : types;
}

/** Transfer known metadata; unknown sequence cells may add tensor axes. */
export function completedValueFacts(value: ValueFacts): ValueFacts {
    const sequence = value.types.includes('sequence');
    const stacked = sequence && (!value.elements?.length
        || value.elements.some(type => ['array', 'bytes', 'sequence'].includes(type)));
    const { unbounded, openRange, ...facts } = value;
    return { ...(sequence ? facts : value), types: completedTypes(value.types),
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
        ...(value.callbackFreeScalarCells && value.types.every(type => ['array', 'bytes', 'sequence'].includes(type))
            ? { eagerScalarCells: true as const } : {}),
        ...(stacked ? { rank: undefined, shape: undefined, dims: undefined, elements: undefined,
            positions: undefined, positionFacts: undefined, eagerScalarCells: undefined,
            callbackFreeScalarCells: undefined } : {}),
    };
}

function completedContract(value: ArrayElementContract): ArrayElementContract {
    return { ...value, type: value.type === 'sequence' ? 'array' : value.type,
        ...(value.positions ? { positions: value.positions.map(choices => choices.map(completedContract)) } : {}),
        ...(value.elements ? { elements: value.elements.map(completedContract) } : {}),
        ...(value.fields ? { fields: Object.fromEntries(Object.entries(value.fields)
            .map(([name, choices]) => [name, choices.map(completedContract)])) } : {}),
    };
}
