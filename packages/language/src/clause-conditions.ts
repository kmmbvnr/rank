import { isAstNode, type AstNode } from 'langium';
import {
    isApplicationExpression, isBinaryExpression, isBoundClauseExpression, isCountClauseExpression,
    isFirstIndexWhereExpression, isFirstWhereExpression, isMaterializeExpression, isNameExpression, isNumberLiteral,
    isSubjectComparisonExpression, isTableFilterExpression, isTakeWhileExpression, isUnaryExpression,
    type Expression, type Program,
} from './generated/ast.js';
import { flattenApplication } from './expressions.js';

/**
 * A pipeline step with its own condition or operand: `filter`, `from`, `after`,
 * `take`, `drop`, `first where`, postfix `array`, and a `to` or `till` bound.
 * A bound is a binary range node, whose left side is its source.
 */
type Clause = Expression & ({ source: Expression } | { left: Expression; right: Expression });

/** What followed a condition on its line: a call argument or a later clause. */
type Step = { kind: 'argument'; value: Expression } | { kind: 'clause'; node: Clause };

interface Peeled {
    readonly extent: Expression;
    readonly steps: readonly Step[];
}

export interface ClauseNames {
    /** Whether this name part calls a function rather than naming data. */
    callable(part: Expression): boolean;
    /** The arities a called name accepts. */
    arities(part: Expression): readonly number[];
}

const LOGICAL = new Set(['and', 'or', 'xor']);
const MODIFIERS = new Set(['rank', 'axis']);

/** `Values till 10` and `1 to 10`: a range operator without a step. */
function isBound(expression: Expression): boolean {
    return isBinaryExpression(expression) && ['to', 'till', 'until'].includes(expression.operator) && !expression.step;
}

function sourceOf(clause: Clause): Expression {
    return 'source' in clause ? clause.source : clause.left;
}

function setSource(clause: Clause, source: Expression): void {
    if ('source' in clause) clause.source = source;
    else clause.left = source;
}

function isClause(expression: Expression): expression is Clause {
    return isBound(expression) || isMaterializeExpression(expression) || isTableFilterExpression(expression) || isBoundClauseExpression(expression)
        || isCountClauseExpression(expression) || isTakeWhileExpression(expression)
        || isFirstWhereExpression(expression) || isFirstIndexWhereExpression(expression);
}

/** The property holding a clause's one-line condition, if it has one. */
function conditionKey(clause: Clause): 'condition' | 'mask' | 'right' | undefined {
    if (isBound(clause)) return 'right';
    if (isTableFilterExpression(clause)) return clause.condition ? 'condition' : undefined;
    if (isBoundClauseExpression(clause)) return 'condition';
    if (isTakeWhileExpression(clause) || isFirstWhereExpression(clause)
        || isFirstIndexWhereExpression(clause)) return 'mask';
    return undefined;
}

/**
 * A condition is one predicate, so the pipeline goes on after it:
 * `N filter even till 1000 sum` filters, bounds, then sums. The grammar lets a
 * condition run to the end of the line; this pass keeps only the predicate and
 * moves the calls and clauses that follow it back into the pipeline.
 */
export function splitClauseConditions(program: Program, names: ClauseNames): void {
    const record = program as unknown as Record<string, unknown>;
    for (const [property, value] of Object.entries(program)) {
        if (property.startsWith('$')) continue;
        if (isAstNode(value)) record[property] = transform(value, names);
        else if (Array.isArray(value)) record[property] = value.map(item => isAstNode(item) ? transform(item, names) : item);
    }
}

function transform(node: AstNode, names: ClauseNames): AstNode {
    const record = node as unknown as Record<string, unknown>;
    for (const [property, value] of Object.entries(node)) {
        if (property.startsWith('$')) continue;
        if (isAstNode(value)) record[property] = transform(value, names);
        else if (Array.isArray(value)) record[property] = value.map(item => isAstNode(item) ? transform(item, names) : item);
    }
    if (!isClause(node as Expression)) return node;
    const clause = node as Clause;
    const key = conditionKey(clause);
    if (!key) return clause;
    const condition = record[key] as Expression;
    // A bound's right side is a value unless it is written as a condition.
    const { extent, steps } = key === 'right' && !isCondition(condition)
        ? peelOperand(condition) : peelTerm(condition, names);
    record[key] = extent;
    return rebuild(clause, steps);
}

function rebuild(start: Expression, steps: readonly Step[]): Expression {
    let current = start;
    for (const step of steps) {
        if (step.kind === 'clause') {
            setSource(step.node, current);
            current = step.node;
        } else {
            current = {
                $type: 'ApplicationExpression', head: current, arguments: [step.value],
                $cstNode: step.value.$cstNode,
            } as Expression;
        }
    }
    return current;
}

/** A clause inside a condition was parsed after the predicate: it follows it. */
function peelClause(clause: Clause, peel: (source: Expression) => Peeled): Peeled {
    const inner = peel(sourceOf(clause));
    return { extent: inner.extent, steps: [...inner.steps, { kind: 'clause', node: clause }] };
}

/** A condition written with a comparison, `not` or a logical word. */
function isCondition(expression: Expression): boolean {
    return isSubjectComparisonExpression(expression)
        || (isUnaryExpression(expression) && expression.operator === 'not')
        || (isBinaryExpression(expression) && LOGICAL.has(expression.operator));
}

/** One predicate term, possibly combined with `and`, `or`, `xor` or `not`. */
function peelTerm(expression: Expression, names: ClauseNames): Peeled {
    if (isClause(expression)) return peelClause(expression, source => peelTerm(source, names));
    if (isBinaryExpression(expression)) {
        const right = LOGICAL.has(expression.operator)
            ? peelTerm(expression.right, names) : peelOperand(expression.right);
        expression.right = right.extent;
        return { extent: expression, steps: right.steps };
    }
    if (isUnaryExpression(expression) && expression.operator === 'not') {
        const operand = peelTerm(expression.operand, names);
        expression.operand = operand.extent;
        return { extent: expression, steps: operand.steps };
    }
    if (isSubjectComparisonExpression(expression)) {
        const right = peelOperand(expression.right);
        expression.right = right.extent;
        return { extent: expression, steps: right.steps };
    }
    if (isApplicationExpression(expression)) {
        const parts = flattenApplication(expression);
        const head = parts[0];
        if (isClause(head)) {
            const inner = peelTerm(head, names);
            return { extent: inner.extent, steps: [...inner.steps, ...arguments_(parts.slice(1))] };
        }
        const length = predicateLength(parts, names);
        return {
            extent: application(parts.slice(0, length), expression),
            steps: arguments_(parts.slice(length)),
        };
    }
    return { extent: expression, steps: [] };
}

/**
 * The operand of a comparison is one value, as it is after a plain left
 * operand elsewhere: `filter greater 5 sum` sums the kept values.
 */
function peelOperand(expression: Expression): Peeled {
    if (isClause(expression)) return peelClause(expression, peelOperand);
    if (isBinaryExpression(expression) && !LOGICAL.has(expression.operator)) {
        const right = peelOperand(expression.right);
        expression.right = right.extent;
        return { extent: expression, steps: right.steps };
    }
    if (isApplicationExpression(expression)) {
        const parts = flattenApplication(expression);
        if (isClause(parts[0])) {
            const inner = peelOperand(parts[0]);
            return { extent: inner.extent, steps: [...inner.steps, ...arguments_(parts.slice(1))] };
        }
        return { extent: parts[0], steps: arguments_(parts.slice(1)) };
    }
    return { extent: expression, steps: [] };
}

/**
 * How many leading parts make the predicate. A function takes its modifiers
 * (`palindrome rank 0`). Data is a mask or bound by itself, unless a function
 * after it takes it with the subject as data-first arguments (`5 near`).
 */
function predicateLength(parts: readonly Expression[], names: ClauseNames): number {
    let length = 1;
    if (!names.callable(parts[0])) {
        const call = parts.findIndex((part, index) => index > 0 && names.callable(part));
        if (call < 0 || !names.arities(parts[call]).includes(call + 1)) return 1;
        length = call + 1;
    }
    while (isModifier(parts[length]) && isNumberLiteral(parts[length + 1])) {
        length += 2;
        while (isNumberLiteral(parts[length])) length++;
    }
    return length;
}

function isModifier(part: Expression | undefined): boolean {
    return isNameExpression(part) && MODIFIERS.has(part.name);
}

function arguments_(parts: readonly Expression[]): Step[] {
    return parts.map(value => ({ kind: 'argument', value }));
}

function application(parts: readonly Expression[], original: Expression): Expression {
    if (parts.length === 1) return parts[0];
    return parts.slice(1).reduce((head, argument) => ({
        $type: 'ApplicationExpression', head, arguments: [argument], $cstNode: original.$cstNode,
    } as Expression), parts[0]);
}
