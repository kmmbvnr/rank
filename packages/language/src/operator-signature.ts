import type { ValueFacts } from './analysis/value-domain.js';
import { formatTypeSignature, matchingSignatures, type SignatureType, type TypeSignature } from './type-signature.js';

const nullableBoolean: SignatureType = { union: ['boolean', 'missing'] };
const binary = (left: SignatureType, right: SignatureType, result: SignatureType): TypeSignature =>
    ({ inputs: [left, right], result, ranks: [0, 0] });
const missing = [binary('missing', 'unknown', 'missing'), binary('unknown', 'missing', 'missing')];
const ordered = (['number', 'text', 'boolean', 'symbol', 'date', 'datetime', 'record'] as const)
    .map(type => binary(type, type, 'boolean'));
const numeric = [binary('integer', 'integer', 'integer'), binary('integer', 'real', 'real'),
    binary('real', 'integer', 'real'), binary('real', 'real', 'real')];
const signs: readonly TypeSignature[] = [
    { inputs: ['integer'], result: 'integer', ranks: [0] },
    { inputs: ['real'], result: 'real', ranks: [0] },
    { inputs: ['missing'], result: 'missing', ranks: [0] },
];

const item: SignatureType = { variable: 0 };
const bound: SignatureType = { union: ['number', 'text', 'boolean', 'symbol', 'date', 'datetime', 'record', 'missing'] };
function rangeSignatures(conditional: boolean): readonly TypeSignature[] {
    const limit: SignatureType = conditional ? { union: [bound,
        { collection: 'array', element: 'boolean' }, { collection: 'sequence', element: 'boolean' },
        { callback: { inputs: [item], result: 'unknown' } }] } : bound;
    return [{ inputs: ['integer', 'integer'], result: { collection: 'sequence', element: 'integer' } },
        ...(['array', 'sequence', 'queue', 'stack', 'deque'] as const).map(collection => ({
            inputs: [{ collection, element: item }, limit],
            result: { collection: collection === 'array' || collection === 'sequence' ? collection : 'array' as const, element: item },
        })), { inputs: ['text', limit], result: 'text' }];
}

/** Language-level cell contracts, not the compiler's supported subset.
 * Rank annotations describe cells. Broadcasting, sequence bounds and guard
 * evaluation still follow each operator's rules; types do not promise every
 * shape combination or prove value-dependent preconditions.
 */
export const operatorSignatures: Readonly<Record<string, readonly TypeSignature[]>> = {
    '+': [...signs, ...numeric, ...missing, { inputs: ['text', 'text'], result: 'text' },
        binary('datetime', 'duration', 'datetime'), binary('duration', 'datetime', 'datetime')],
    '-': [...signs, ...numeric, ...missing, binary('datetime', 'datetime', 'duration')],
    '*': [...numeric, ...missing, binary('duration', 'number', 'duration'), binary('number', 'duration', 'duration')],
    '/': [binary('number', 'number', 'real'), ...missing],
    '//': [...numeric, ...missing],
    'mod': [...numeric, ...missing],
    // Integer exponents can be negative, so integer inputs alone do not prove an integer result.
    '**': [binary('number', 'number', 'number'), ...missing],
    equal: [binary('unknown', 'unknown', nullableBoolean)],
    notequal: [binary('unknown', 'unknown', nullableBoolean)],
    less: [...ordered, ...missing],
    greater: [...ordered, ...missing],
    atleast: [...ordered, ...missing],
    atmost: [...ordered, ...missing],
    and: [binary('boolean', 'boolean', 'boolean'), binary('boolean', 'missing', nullableBoolean),
        binary('missing', 'boolean', nullableBoolean), binary('missing', 'missing', 'missing')],
    or: [binary('boolean', 'boolean', 'boolean'), binary('boolean', 'missing', nullableBoolean),
        binary('missing', 'boolean', nullableBoolean), binary('missing', 'missing', 'missing')],
    xor: [binary('boolean', 'boolean', 'boolean'), ...missing],
    not: [{ inputs: ['boolean'], result: 'boolean', ranks: [0] },
        { inputs: ['missing'], result: 'missing', ranks: [0] }],
    is: [{ inputs: ['unknown', 'symbol'], result: 'boolean' }],
    to: rangeSignatures(false),
    till: rangeSignatures(true),
};

// SQL dispatch precedes scalar/cell dispatch. Column calendar/boolean refinements
// and same-table ownership are checked by the runtime, not this nominal display.
const columnOperators = new Set(['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost',
    'and', 'or', '+', '-', '*', '/', '//']);
const columnSignatures: readonly TypeSignature[] = [
    { inputs: ['column', 'unknown'], result: 'column' },
    { inputs: ['unknown', 'column'], result: 'column' },
];

export function operatorSignature(name: string, inputs?: readonly ValueFacts[]): string | undefined {
    name = name.replace(/\s+/g, '');
    const declared = operatorSignatures[name];
    if (!declared) return undefined;
    const columns = columnOperators.has(name) ? columnSignatures : [];
    const knownColumn = inputs?.some(input => input.types.length === 1 && input.types[0] === 'sqlite-expression');
    const signatures = knownColumn && columns.length ? columns : [...declared, ...columns];
    const selected = inputs ? matchingSignatures(signatures, inputs) : signatures;
    return selected.length ? [...new Set(selected.map(formatTypeSignature))].join(' ; ') : undefined;
}
