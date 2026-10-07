import { inferSignatureResultTypes } from '../signature-matching.js';
import type { SignatureAtom } from '../type-signature.js';
import { joinTypes } from './value-domain.js';
import { flattenApplication } from '../expressions.js';
import { applicationForm } from '../application-forms.js';
/**
 * Type facts over the runtime's own type names.
 *
 * Rank has no type annotations, so a static pass often has nothing to say. That
 * is the design: `unknown` is a first-class answer, spelled as an empty list,
 * and every rule here is conservative. The analyzer may be silent, but it must
 * never contradict the runtime — `types.test.ts` in the interpreter runs the
 * demos and checks every inferred type against the value the run produced.
 */

import {
    isTupleExpression, isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral,
    isBoundClauseExpression, isCountClauseExpression, isFirstIndexWhereExpression, isFirstWhereExpression,
    isKeyedJoinExpression, isKeyedReachExpression, isKeyedSortExpression, isKeyedMergeExpression, isLabelLiteral, isMaterializeExpression,
    isNameExpression, isNewStructureExpression, isNumberLiteral, isParenthesizedExpression,
    isRecordExpression, isRecordUpdateExpression, isStdinExpression, isStringLiteral, isTextBlockExpression, isUnaryExpression,
    isTableFilterExpression, isTableSelectExpression, isTableWriteExpression, isTableWritePreviewExpression,
    type ApplicationExpression, type Expression,
} from '../generated/ast.js';
import { findOperation, operationArities, type Operation, type ResultKind } from '../operations.js';

/**
 * The runtime types a value may have. Empty is `unknown`, and a list of more
 * than one means the value settles on one of them but the pass cannot say which.
 */
export type Types = readonly string[];

export const UNKNOWN: Types = [];

/** How a type fact reads in a report. */
export function describeTypes(types: Types): string {
    return types.length === 0 ? 'unknown' : [...types].sort().join(' or ');
}

export function unionTypes(left: Types, right: Types): Types {
    return joinTypes([left, right]);
}

/** Types that a comparison reduces to a single boolean rather than a mask. */
const SCALARS = new Set(['integer', 'real', 'boolean', 'text', 'date', 'datetime', 'duration', 'symbol']);

const NUMBERS = new Set(['integer', 'real']);

// The grammar joins the two-word comparisons, so `at least` reaches here as
// `atleast`.
const COMPARISONS = new Set([
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'in', 'notin', 'is',
]);

const BOOLEANS = new Set(['and', 'or', 'xor']);

const ARITHMETIC = new Set(['+', '-', '*', '/', '//', 'mod', '**']);
/** Scalar-cell operations whose successful array/sequence result keeps the input kind. */
export function mapsScalarCells(operation: Operation): boolean {
    return operation.monadicRank === 0 || operation.mapsScalarCells === true;
}

/** `new <structure>` and the runtime type it produces. */
const STRUCTURES: Record<string, string> = {
    queue: 'queue', stack: 'stack', deque: 'deque', heap: 'heap',
    set: 'set', counter: 'counter', multiset: 'multiset', orderedset: 'multiset',
    index: 'index', graph: 'graph', dsu: 'dsu',
};

/**
 * A catalogue result kind as runtime types. The kinds that describe a role
 * rather than a representation — an element of a collection, the receiver
 * itself, whatever was passed in — stay unknown on purpose.
 */
const RESULTS: Partial<Record<ResultKind, Types>> = {
    integer: ['integer'],
    real: ['real'],
    number: ['integer', 'real'],
    boolean: ['boolean'],
    text: ['text'],
    bytes: ['bytes'],
    array: ['array'],
    table: ['array'],
    sequence: ['sequence'],
    functional: ['functional'],
    segment: ['segment'],
    fenwick: ['fenwick'],
    record: ['record'],
    date: ['date'],
    datetime: ['datetime'],
    duration: ['duration'],
    file: ['file'],
};

/**
 * The runtime type of a declared input. `option`, `argument` and `flag` are the
 * one place Rank states a type, and `many` collects the values into an array.
 */
export function declaredType(valueType: string, many: boolean): Types {
    if (many) return ['array'];
    if (valueType === 'path') return ['text'];
    return INPUT_TYPES.includes(valueType) ? [valueType] : UNKNOWN;
}

/**
 * The types `option` and `argument` accept, in the order a reader wants them
 * offered. `path` is text the host may resolve against the program location.
 */
export const INPUT_TYPES: readonly string[] = [
    'integer', 'real', 'text', 'path', 'boolean',
];

/**
 * What a name currently holds, or undefined when no binding in scope has that
 * spelling. The difference matters: a bound name is data, a free one may be
 * catalogue vocabulary.
 */
export type TypeLookup = (name: string) => Types | undefined;

export function typeOf(expression: Expression | undefined, lookup: TypeLookup): Types {
    if (expression === undefined) return UNKNOWN;
    if (isNumberLiteral(expression)) {
        return typeof expression.value === 'bigint' ? ['integer'] : ['real'];
    }
    if (isStringLiteral(expression) || isTextBlockExpression(expression)) return ['text'];
    if (isBooleanLiteral(expression)) return ['boolean'];
    if (isLabelLiteral(expression)) return [expression.name === 'NA' ? 'missing' : 'symbol'];
    if (isTupleExpression(expression)) return ['tuple'];
    if (isArrayExpression(expression) || isMaterializeExpression(expression)) return ['array'];
    if (isRecordExpression(expression) || isRecordUpdateExpression(expression)) return ['record'];
    if (isTableFilterExpression(expression) || isTableSelectExpression(expression)) {
        return expression.sourceFields.length === 0 ? typeOf(expression.source, lookup) : UNKNOWN;
    }
    if (isTableWriteExpression(expression)) {
        return ['integer'];
    }
    if (isTableWritePreviewExpression(expression)) {
        return expression.mode === 'sql' ? ['record'] : ['array'];
    }
    if (isKeyedMergeExpression(expression)
        || isKeyedSortExpression(expression) && expression.operator.startsWith('merge')) return ['sequence'];
    if (isKeyedSortExpression(expression) || isKeyedJoinExpression(expression)
        || isKeyedReachExpression(expression)) return ['array'];
    if (isNewStructureExpression(expression)) {
        const type = STRUCTURES[expression.structure];
        return type === undefined ? UNKNOWN : [type];
    }
    if (isStdinExpression(expression)) {
        if (expression.count !== undefined) return ['sequence'];
        if (expression.mode.name === 'integer') return ['integer'];
        return expression.mode.name === 'word' ? ['text'] : UNKNOWN;
    }
    if (isParenthesizedExpression(expression)) return typeOf(expression.value, lookup);
    if (isNameExpression(expression)) {
        const known = lookup(expression.name);
        if (known) return known;
        const builtin = findOperation(expression.name);
        return builtin?.arities.length === 0 ? resultTypes(builtin)
            : (operationArities(expression.name)?.length ?? 0) > 0 ? ['function'] : UNKNOWN;
    }
    if (isUnaryExpression(expression)) {
        const operand = typeOf(expression.operand, lookup);
        if (expression.operator === 'not') {
            return same(operand, 'boolean') ? ['boolean'] : UNKNOWN;
        }
        if (same(operand, 'array') || same(operand, 'sequence')) return operand;
        return within(operand, NUMBERS) ? operand : UNKNOWN;
    }
    if (isFirstIndexWhereExpression(expression)) return ['integer'];
    if (isFirstWhereExpression(expression)) return same(typeOf(expression.source, lookup), 'text') ? ['text'] : UNKNOWN;
    if (isBoundClauseExpression(expression) || isCountClauseExpression(expression)) {
        const source = typeOf(expression.source, lookup);
        return same(source, 'text') || same(source, 'sequence') || same(source, 'array') ? source
            : same(source, 'queue') ? ['array'] : UNKNOWN;
    }
    if (isBinaryExpression(expression)) {
        if (['+', '*', 'and', 'or', 'xor'].includes(expression.operator)
            && isNameExpression(expression.right) && expression.right.name === 'segment'
            && lookup('segment') === undefined) return ['segment'];
        return binaryType(expression.operator,
            typeOf(expression.left, lookup), typeOf(expression.right, lookup));
    }
    if (isApplicationExpression(expression)) return applicationType(expression, lookup);
    return UNKNOWN;
}

/**
 * `A += B` and its family: the same rules as the operator they carry, read
 * against what `A` already holds.
 */
export function compoundType(operator: string, left: Types, right: Types): Types {
    return binaryType(operator.slice(0, -1), left, right);
}

export function binaryType(operator: string, left: Types, right: Types): Types {
    if (operator === 'default') return unionTypes(left, right);
    if (operator === 'to' || operator === 'till') {
        // After values the words bound them and keep their kind; after a number they build a range.
        if (same(left, 'text') || same(left, 'array') || same(left, 'sequence')) return left;
        return same(left, 'queue') ? ['array'] : ['sequence'];
    }
    if (COMPARISONS.has(operator)) {
        if (['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost'].includes(operator)
            && within(left, NUMBERS) && within(right, NUMBERS)
            && !left.some(type => right.includes(type))) return UNKNOWN;
        if (within(left, SCALARS) && within(right, SCALARS)) return ['boolean'];
        // Over a collection a comparison is a mask with the same shape.
        return operator === 'in' || operator === 'is'
            ? UNKNOWN : elementwise(left, right) ?? UNKNOWN;
    }
    if (BOOLEANS.has(operator)) {
        if (same(left, 'boolean') && same(right, 'boolean')) return ['boolean'];
        // After a single boolean, `and` and `or` are guards that accept only a single boolean.
        if (same(left, 'boolean') && operator !== 'xor') return ['boolean'];
        return elementwise(left, right) ?? UNKNOWN;
    }
    if (operator === '+' && same(left, 'text') && same(right, 'text')) return ['text'];
    if (operator === '+' && ((same(left, 'datetime') && same(right, 'duration'))
        || (same(left, 'duration') && same(right, 'datetime')))) return ['datetime'];
    if (operator === '-' && same(left, 'datetime') && same(right, 'datetime')) return ['duration'];
    if (operator === '*' && ((same(left, 'duration') && within(right, NUMBERS))
        || (same(right, 'duration') && within(left, NUMBERS)))) return ['duration'];
    if (!within(left, NUMBERS) || !within(right, NUMBERS)) {
        return ARITHMETIC.has(operator) ? elementwise(left, right) ?? UNKNOWN : UNKNOWN;
    }
    // Successful arithmetic selects one concrete numeric type shared by both operands.
    const shared = left.filter(type => right.includes(type));
    if (!shared.length) return UNKNOWN;
    left = shared;
    right = shared;
    // Division always produces a real, even when it divides exactly.
    if (operator === '/') return ['real'];
    if (operator === '//' || operator === 'mod') {
        if (same(left, 'integer') && same(right, 'integer')) return ['integer'];
        return same(left, 'real') || same(right, 'real') ? ['real'] : ['integer', 'real'];
    }
    if (operator === '**') {
        // A negative exponent turns an integer power real, and the exponent is
        // a value rather than a type, so two integers settle on neither alone.
        return same(left, 'real') || same(right, 'real') ? ['real'] : ['integer', 'real'];
    }
    if (operator !== '+' && operator !== '-' && operator !== '*') return UNKNOWN;
    if (same(left, 'integer') && same(right, 'integer')) return ['integer'];
    if (same(left, 'real') || same(right, 'real')) return ['real'];
    return ['integer', 'real'];
}

/**
 * An operator over a collection and a scalar keeps the collection's shape, and
 * a sequence stays lazy. Two collections of the same kind agree; an array
 * against a sequence is a rank question this pass does not answer.
 */
function elementwise(left: Types, right: Types): Types | undefined {
    if (same(left, 'array') && same(right, 'array')) return ['array'];
    if (same(left, 'sequence') && same(right, 'sequence')) return ['sequence'];
    for (const [collection, scalar] of [[left, right], [right, left]] as const) {
        if (!within(scalar, SCALARS)) continue;
        if (same(collection, 'array')) return ['array'];
        if (same(collection, 'sequence')) return ['sequence'];
    }
    return undefined;
}

/**
 * An application settles only when the word after all its operands is
 * catalogue vocabulary that no binding hides. Anything else — addressing, a
 * user function, a receiver method in the middle of the chain — is unknown.
 */
function applicationType(expression: ApplicationExpression, lookup: TypeLookup): Types {
    const parts = flattenApplication(expression);
    if (parts.some(part => isNameExpression(part) && part.name === 'window')) {
        const form = applicationForm(parts, name => lookup(name) === undefined ? findOperation(name) : false);
        if (form.kind === 'window') {
            const source = typeOf(form.source, lookup);
            if (same(source, 'text')) return ['sequence'];
            if (same(source, 'sequence')) return ['array', 'sequence'];
            if (same(source, 'array') || same(source, 'queue')) return ['array'];
            return source.length === 0 ? ['array', 'sequence'] : UNKNOWN;
        }
    }
    const last = parts.at(-1);
    if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'from'
        && same(typeOf(parts[0], lookup), 'sequence') && same(typeOf(parts[2], lookup), 'integer')) return ['sequence'];
    // `new graph Nodes .undirected` is a constructor call, not an application
    // of its last operand.
    const head = parts[0];
    if (head !== undefined && isNewStructureExpression(head)) {
        const type = STRUCTURES[head.structure];
        return type === undefined ? UNKNOWN : [type];
    }
    if (parts.length === 2) {
        const source = typeOf(head, lookup);
        const selector = typeOf(parts[1], lookup);
        if (same(source, 'text') && same(selector, 'integer')) return ['text'];
        if (['array', 'queue', 'sequence'].some(type => same(selector, type))) {
            if (same(source, 'text')) return ['text'];
            if (['array', 'queue', 'sequence'].some(type => same(source, type))) return ['array'];
        }
    }
    if (last === undefined || !isNameExpression(last)) return UNKNOWN;
    // A bound name in the last position is data being addressed, or a local
    // that hides the catalogue word, so the catalogue does not apply.
    if (lookup(last.name) !== undefined) return UNKNOWN;
    const operation = findOperation(last.name);
    if (operation === undefined) return UNKNOWN;
    const unaryTail = isApplicationExpression(expression.head) && expression.arguments.length === 1
        && operation.arities.join() === '1';
    const arity = unaryTail ? 1 : parts.length - 1;
    const source = typeOf(unaryTail ? expression.head : head, lookup);
    if (operation.arities.includes(arity)) {
        if (arity === 1 && within(source, NUMBERS)) {
            const result = inferSignatureResultTypes(operation.signatures ?? [],
                [{ union: source as readonly SignatureAtom[] }]);
            if (result) return result;
        }
        if ((arity === 1 && mapsScalarCells(operation) || arity === 2 && operation.preservesCollectionElements)
            && !same(source, 'array') && !same(source, 'sequence') && !within(source, NUMBERS)) return UNKNOWN;
        if (arity === 1 && mapsScalarCells(operation)
            && (same(source, 'array') || same(source, 'sequence'))) return source;
        if (arity === 2 && operation.preservesCollectionElements
            && (same(source, 'array') || same(source, 'sequence'))) return source;
        if (arity === 2) {
            const right = typeOf(parts[1], lookup);
            if (operation.name === 'startswith'
                && (same(source, 'array') || same(right, 'array'))) return ['array'];
            if (operation.dyadicRanks?.[0] === 0 && operation.dyadicRanks[1] === 0
                && (same(source, 'array') || same(right, 'array'))) return ['array'];
            if (operation === findOperation('matmul') && same(source, 'array') && same(right, 'array')) return UNKNOWN;
            if (operation.name === 'missing' && same(right, 'array')) return UNKNOWN;
        }
    }
    // Leading operands beyond the arity are addressing that the runtime folds
    // into one value first, so the operation still decides the result.
    if (arity < Math.min(...operation.arities)) return UNKNOWN;
    if (operation.name === 'even' || operation.name === 'odd' || operation.name === 'isnan' || operation.name === 'present') {
        // These predicates map over collections. Addressing or an unresolved
        // call chain needs runtime information before its shape is known.
        if (parts.length !== 2) return UNKNOWN;
        const operand = typeOf(head, lookup);
        if (same(operand, 'array') || same(operand, 'sequence')) return operand;
        return within(operand, NUMBERS) ? ['boolean'] : UNKNOWN;
    }
    return resultTypes(operation);
}

export function resultTypes(operation: Pick<Operation, 'result'>): Types {
    return RESULTS[operation.result] ?? UNKNOWN;
}

/** Every possible type of the value is in the set, and at least one is known. */
function within(types: Types, allowed: ReadonlySet<string>): boolean {
    return types.length > 0 && types.every(type => allowed.has(type));
}

function same(types: Types, type: string): boolean {
    return types.length === 1 && types[0] === type;
}
