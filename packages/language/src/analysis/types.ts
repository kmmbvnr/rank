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
    isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral,
    isKeyedJoinExpression, isKeyedSortExpression, isLabelLiteral, isMaterializeExpression,
    isNameExpression, isNewStructureExpression, isNumberLiteral, isParenthesizedExpression,
    isRecordExpression, isStdinExpression, isStringLiteral, isUnaryExpression,
    isTableFilterExpression, isTableSelectExpression, isTableWriteExpression, isTableWritePreviewExpression,
    type Expression,
} from '../generated/ast.js';
import { findOperation, type Operation, type ResultKind } from '../operations.js';

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
    if (left.length === 0 || right.length === 0) return UNKNOWN;
    return [...new Set([...left, ...right])];
}

/** Types that a comparison reduces to a single boolean rather than a mask. */
const SCALARS = new Set(['integer', 'real', 'boolean', 'text', 'date', 'datetime', 'duration', 'symbol']);

const NUMBERS = new Set(['integer', 'real']);

// The grammar joins the two-word comparisons, so `at least` reaches here as
// `atleast` and `multiple by` as `multipleby`.
const COMPARISONS = new Set([
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'multipleby', 'in', 'notin', 'is',
]);

const BOOLEANS = new Set(['and', 'or', 'xor']);

const ARITHMETIC = new Set(['+', '-', '*', '/', '//', '%', '**']);

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
    if (isStringLiteral(expression)) return ['text'];
    if (isBooleanLiteral(expression)) return ['boolean'];
    if (isLabelLiteral(expression)) return ['symbol'];
    if (isArrayExpression(expression) || isMaterializeExpression(expression)) return ['array'];
    if (isRecordExpression(expression)) return ['record'];
    if (isTableFilterExpression(expression) || isTableSelectExpression(expression)) {
        return expression.sourceFields.length === 0 ? typeOf(expression.source, lookup) : UNKNOWN;
    }
    if (isTableWriteExpression(expression)) {
        return ['integer'];
    }
    if (isTableWritePreviewExpression(expression)) {
        return expression.mode === 'sql' ? ['record'] : ['array'];
    }
    if (isKeyedSortExpression(expression) || isKeyedJoinExpression(expression)) return ['array'];
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
    if (isNameExpression(expression)) return lookup(expression.name) ?? UNKNOWN;
    if (isUnaryExpression(expression)) {
        const operand = typeOf(expression.operand, lookup);
        if (expression.operator === 'not') {
            return same(operand, 'boolean') ? ['boolean'] : UNKNOWN;
        }
        return within(operand, NUMBERS) ? operand : UNKNOWN;
    }
    if (isBinaryExpression(expression)) {
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

function binaryType(operator: string, left: Types, right: Types): Types {
    if (operator === 'to' || operator === 'until') return ['sequence'];
    if (COMPARISONS.has(operator)) {
        if (within(left, SCALARS) && within(right, SCALARS)) return ['boolean'];
        // Over a collection a comparison is a mask with the same shape.
        return operator === 'in' || operator === 'is'
            ? UNKNOWN : elementwise(left, right) ?? UNKNOWN;
    }
    if (BOOLEANS.has(operator)) {
        if (same(left, 'boolean') && same(right, 'boolean')) return ['boolean'];
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
    // Division always produces a real, even when it divides exactly.
    if (operator === '/') return ['real'];
    if (operator === '//' || operator === '%') {
        return same(left, 'integer') && same(right, 'integer') ? ['integer'] : UNKNOWN;
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
function applicationType(expression: Expression, lookup: TypeLookup): Types {
    const parts: Expression[] = [];
    let current: Expression | undefined = expression;
    while (current !== undefined && isApplicationExpression(current)) {
        parts.unshift(...current.arguments);
        current = current.head;
    }
    if (current !== undefined) parts.unshift(current);
    const last = parts.at(-1);
    // `new graph Nodes .undirected` is a constructor call, not an application
    // of its last operand.
    const head = parts[0];
    if (head !== undefined && isNewStructureExpression(head)) {
        const type = STRUCTURES[head.structure];
        return type === undefined ? UNKNOWN : [type];
    }
    if (last === undefined || !isNameExpression(last)) return UNKNOWN;
    // A bound name in the last position is data being addressed, or a local
    // that hides the catalogue word, so the catalogue does not apply.
    if (lookup(last.name) !== undefined) return UNKNOWN;
    const operation = findOperation(last.name);
    if (operation === undefined) return UNKNOWN;
    // Leading operands beyond the arity are addressing that the runtime folds
    // into one value first, so the operation still decides the result.
    if (parts.length - 1 < Math.min(...operation.arities)) return UNKNOWN;
    return resultTypes(operation);
}

export function resultTypes(operation: Operation): Types {
    return RESULTS[operation.result] ?? UNKNOWN;
}

/** Every possible type of the value is in the set, and at least one is known. */
function within(types: Types, allowed: ReadonlySet<string>): boolean {
    return types.length > 0 && types.every(type => allowed.has(type));
}

function same(types: Types, type: string): boolean {
    return types.length === 1 && types[0] === type;
}
