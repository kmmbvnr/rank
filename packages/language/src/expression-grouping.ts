import { functionDeclarationErrors } from './function-declaration.js';
import { groupDeclaredCalls } from './declared-calls.js';
import type { FunctionCallSignature } from './function-call-signature.js';
import { prepareFunctionBindings, functionBindingPlan } from './function-binding.js';
import { groupModifiers } from './modifier-grouping.js';
import { AstUtils, GrammarUtils, isAstNode, type AstNode, type CstNode } from 'langium';
import {
    isFunctionStatement, isApplicationExpression, isArrayExpression, isBinaryExpression, isExpression, isFunctionBindingStatement, isHigherOrderOperator, isMaterializeExpression,
    isLabelLiteral, isNameExpression, type HigherOrderOperator,
    type BinaryExpression, type Expression, type FunctionStatement, type NameExpression, type Program,
} from './generated/ast.js';
import { analyzeBindings } from './analysis/bindings.js';
import { flattenApplication as flatten, applicationExpression as application, groupedExpression as grouped } from './expressions.js';
import { findOperation, operationArities } from './operations.js';
import { splitClauseConditions } from './clause-conditions.js';

// A comparison takes one operand on each side and binds below arithmetic, so
// calls after it apply to its result, as on a calculator: `A greater 2 sum`.
// Logical operators still separate independent clauses.
const precedence: Readonly<Record<string, number>> = {
    equal: 0.5, notequal: 0.5, less: 0.5, greater: 0.5, atleast: 0.5, atmost: 0.5,
    to: 1, till: 1, by: 1, '+': 2, '-': 2, '*': 3, '/': 3, '//': 3, mod: 3, '**': 4,
};
const isRangeOperator = (operator: string): boolean => operator === 'to' || operator === 'till' || operator === 'until';
const comparisons = new Set(['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'in', 'notin', 'is']);
const symbolic = new Set(['reduce', 'scan', 'outer', 'segment', 'rank', 'axis']);
const modifiers = new Set(['repeat', 'axis', 'rank', 'outer', 'segment', 'scan', 'reduce']);
/** Operations that take their combining function as the word after them. */
const higherOrder = new Set(['scan', 'reduce', 'segment', 'outer']);
/** Words after a higher-order operation that are its own parameters, not the function. */
const higherOrderParameters = new Set(['with', 'axis', 'rank']);
const wordOperators: Readonly<Record<string, string>> = {
    'not equal': 'notequal', 'at least': 'atleast', 'at most': 'atmost',
};

/** Split the joined `scan +` token into the operation name and its combining operator. */
function higherOrderParts(part: HigherOrderOperator): { name: string; operator: string } {
    const [name, ...rest] = part.text.split(/[\t ]+/);
    const operator = rest.join(' ');
    return { name, operator: wordOperators[operator] ?? operator };
}

export interface GroupingDiagnostic {
    readonly message: string;
    readonly node: AstNode;
    readonly cst?: CstNode;
}
/** Node-owned annotations survive expression spreads and stay out of JSON/CST traversal. */
const annotations = Symbol('grouping annotations');
const grouping = Symbol('grouped program');
interface ExpressionAnnotations {
    readonly bound?: boolean;
    readonly callable?: boolean;
    readonly arities?: readonly number[];
    readonly callSignature?: FunctionCallSignature;
    readonly directName?: boolean;
    readonly dataOperand?: boolean;
}
type AnnotatedExpression = Expression & { [annotations]?: ExpressionAnnotations };
export interface GroupedProgram {
    readonly program: Program;
    readonly diagnostics: readonly GroupingDiagnostic[];
}
type AnnotatedProgram = Program & { [grouping]?: GroupedProgram };
const metadata = (node: Expression): ExpressionAnnotations => (node as AnnotatedExpression)[annotations] ?? {};
function annotate(node: Expression, facts: ExpressionAnnotations): void {
    (node as AnnotatedExpression)[annotations] = { ...metadata(node), ...facts };
}
/** Known nullary calls and unresolved module words need the execution stack. */
export function nameNeedsExecution(expression: Expression): boolean {
    return !metadata(expression).directName;
}
/** An unresolved operand cannot become an implicit call inside arithmetic. */
export function requiresDataOperand(expression: Expression): boolean {
    return metadata(expression).dataOperand === true;
}
export function expressionDiagnostics(program: Program): readonly GroupingDiagnostic[] {
    return (program as AnnotatedProgram)[grouping]?.diagnostics ?? [];
}

/** A `-` after whitespace and before its operand, as in `A -1`, is a sign; `A - 1` and `A-1` subtract. */
function attachedSign(expression: BinaryExpression): boolean {
    if (expression.operator !== '-') return false;
    const operator = GrammarUtils.findNodeForProperty(expression.$cstNode, 'operator');
    if (!operator) return false;
    const text = operator.root.fullText;
    return /\s/.test(text[operator.offset - 1] ?? '') && !/\s/.test(text[operator.end] ?? ' ');
}

export interface GroupingOptions {
    readonly loadModule?: (path: string) => Program | undefined;
    readonly declarations?: ReadonlyMap<string, FunctionStatement>;
    readonly signatures?: ReadonlyMap<string, FunctionCallSignature>;
    /** Signatures from earlier REPL inputs; false marks a data binding. */
    readonly bindings?: ReadonlyMap<string, readonly number[] | false>;
    readonly modules?: ReadonlySet<string>;
    readonly writableOperations?: ReadonlyMap<string, string>;
}

const externalDeclarations = new WeakMap<Program, ReadonlyMap<string, FunctionStatement>>();
const externalBindings = new WeakMap<Program, ReadonlySet<string>>();
/** Names already present when this source was grouped, including notebook data. */
export function programExternalBindings(program: Program): ReadonlySet<string> {
    return externalBindings.get(program) ?? new Set();
}
export function programFunctionDeclarations(program: Program): ReadonlyMap<string, FunctionStatement> {
    return externalDeclarations.get(program) ?? new Map();
}

/**
 * Whitespace can mean addressing or application. Resolve that distinction once,
 * before analysis and execution consume the tree. Parentheses bound independent
 * formulas; arithmetic keeps its mathematical precedence, and comparisons bind
 * below it, so a call after a comparison applies to the comparison's result.
 */
export function groupExpressions(program: Program, options: GroupingOptions = {}): GroupedProgram {
    if (options.declarations) externalDeclarations.set(program, options.declarations);
    if (options.bindings) externalBindings.set(program, new Set(options.bindings.keys()));
    // Regrouping (for example after resolving a function binding) recomputes semantic facts.
    for (const node of AstUtils.streamAllContents(program)) {
        if (isExpression(node)) delete (node as AnnotatedExpression)[annotations];
    }
    prepareFunctionBindings(program, options.bindings, options.signatures);
    const errors: GroupingDiagnostic[] = [];
    const result: GroupedProgram = { program, diagnostics: errors };
    (program as AnnotatedProgram)[grouping] = result;
    const externalFunctions = new Map<string, readonly number[]>();
    for (const [name, signature] of options.bindings ?? []) {
        if (signature !== false) externalFunctions.set(name, signature);
    }
    const unresolved: NameExpression[] = [];
    const facts = analyzeBindings(program, [], externalFunctions, (node, binding) => {
        if (!isNameExpression(node)) return;
        if (!binding || binding.kind === 'module') { unresolved.push(node); return; }
        annotate(node, {
            bound: true,
            callable: (binding.kind === 'function' || binding.types.includes('function')) && !binding.arities?.includes(0),
            arities: binding.arities,
            callSignature: binding.callSignature,
            directName: !binding.arities?.includes(0),
        });
    }, options.signatures);
    // Source-module functions need not be loaded to group their calls.
    const words = new Set(facts.words.map(word => word.name));
    for (const node of unresolved) {
        if (!options.bindings?.has(node.name) && words.has(node.name) && /^[a-z]/.test(node.name.split('.').at(-1)!)) annotate(node, { callable: true });
    }
    const declaredSignature = (part: Expression): FunctionCallSignature | undefined =>
        metadata(part).callSignature ?? (isNameExpression(part) && !metadata(part).bound ? options.signatures?.get(part.name) : undefined);
    const callable = (part: Expression): boolean => {
        if (!isNameExpression(part)) return false;
        const bound = metadata(part).callable;
        if (bound !== undefined) return bound;
        const supplied = options.bindings?.get(part.name);
        if (supplied !== undefined) return supplied !== false && !supplied.includes(0);
        return (operationArities(part.name)?.length ?? 0) > 0;
    };
    const rebound = new Set<string>();
    for (const scope of facts.scopes) for (const binding of scope.bindings) rebound.add(binding.name);
    const standard = (part: NameExpression | string): boolean => {
        const name = typeof part === 'string' ? part : part.name;
        return (typeof part === 'string' ? !rebound.has(name) : metadata(part).callable === undefined)
            && options.bindings?.get(name) === undefined;
    };
    const standardOperation = (part: NameExpression | string) =>
        standard(part) ? findOperation(typeof part === 'string' ? part : part.name) : undefined;
    const report = (node: AstNode, message: string, property?: string) => {
        errors.push({ node, message, cst: property ? GrammarUtils.findNodeForProperty(node.$cstNode, property) : node.$cstNode });
    };
    function hasCall(expression: Expression): boolean {
        if (isMaterializeExpression(expression)) return true;
        if (isApplicationExpression(expression)) return flatten(expression).slice(1)
            .some(part => callable(part) || isHigherOrderOperator(part)
                || (isNameExpression(part) && symbolic.has(part.name)));
        return isBinaryExpression(expression) && !!precedence[expression.operator]
            && (hasCall(expression.left) || hasCall(expression.right));
    }
    type Token = { kind: 'value'; value: Expression }
        | { kind: 'operator'; value: BinaryExpression }
        | { kind: 'call'; parts: Expression[]; original: Expression }
        | { kind: 'symbolic'; original: BinaryExpression }
        | { kind: 'materialize'; original: Expression };

    function tokens(expression: Expression): Token[] {
        // In a repeat call, till introduces a predicate rather than a range bound.
        if (isBinaryExpression(expression) && expression.operator === 'till') {
            const before = tokens(expression.left);
            const call = before.at(-1);
            const repeat = call?.kind === 'call' && call.parts.some(part =>
                isNameExpression(part) && part.name === 'repeat' && standard(part));
            if (!repeat) return [...before, { kind: 'operator', value: expression }, ...tokens(expression.right),
                ...(expression.step ? [{ kind: 'operator' as const, value: { ...expression, operator: 'by' } },
                    ...tokens(expression.step)] : [])];
            const left = flatten(visit(expression.left) as Expression);
            if (isNameExpression(left[2]) && left[2].name === 'repeat' && standard(left[2])) {
                if (expression.step) report(expression.step, 'repeat till does not accept a range step with by.');
                const till = { $type: 'NameExpression', name: 'till', $cstNode: expression.$cstNode } as Expression;
                return tokens(application([...left, till, ...flatten(expression.right)], expression));
            }
        }
        // A pipeline on the left of a comparison makes it symmetric: each side
        // keeps its own calls (`A len equal B len`). Only a bare left operand
        // lets later calls apply to the comparison's result (`A greater 2 sum`).
        if (isBinaryExpression(expression) && comparisons.has(expression.operator) && hasCall(expression.left)) {
            return [{ kind: 'value', value: visitChildren(expression) as Expression }];
        }
        if (isBinaryExpression(expression) && precedence[expression.operator]) {
            const left = flatten(expression.left);
            const last = left.at(-1);
            if (expression.operator === '-' && isNameExpression(last) && standardOperation(last)?.grouping?.signedOperand) {
                const right = tokens(expression.right);
                const first = right[0];
                if (first.kind === 'value') {
                    const places = { $type: 'UnaryExpression', operator: '-', operand: first.value,
                        $cstNode: first.value.$cstNode } as Expression;
                    return [...tokens(application([...left.slice(0, -1), places, last], expression)), ...right.slice(1)];
                }
            }
            // Symbolic modifiers remain one postfix operation, not an arithmetic RHS.
            const right = flatten(expression.right);
            if (isNameExpression(right[0]) && symbolic.has(right[0].name)) {
                if (higherOrder.has(right[0].name) && standard(right[0].name)) {
                    const name = right[0].name;
                    report(right[0], `\`${name}\` takes its combining operation after it. Write \`A ${name} ${expression.operator}\` instead of \`A ${expression.operator} ${name}\`.`);
                }
                return [...tokens(expression.left), { kind: 'symbolic', original: expression }];
            }
            const signed = attachedSign(expression) ? tokens(expression.right) : undefined;
            if (signed?.[0]?.kind === 'value') {
                // `A -1 shift`: a minus glued to its operand is that operand's sign, so the
                // operand becomes one more argument of the call on the left.
                const parts = flatten(signed[0].value);
                const negated = { $type: 'UnaryExpression', operator: '-', operand: parts[0],
                    $cstNode: parts[0].$cstNode } as Expression;
                if (flatten(expression.left).some(part => declaredSignature(part))) {
                    return [...tokens(application([...flatten(expression.left), negated, ...parts.slice(1)], expression)), ...signed.slice(1)];
                }
                const left = tokens(expression.left);
                const final = left.at(-1);
                if (final?.kind === 'call') {
                    // `A 1 shift with -100`: the sign belongs to the last argument of that call.
                    return [...left.slice(0, -1),
                        { ...final, parts: [...final.parts, negated, ...parts.slice(1)] },
                        ...signed.slice(1)];
                }
                const [head, ...rest] = left;
                if (head && !rest.length && head.kind === 'value') {
                    return [{ kind: 'value', value: application([...flatten(head.value), negated, ...parts.slice(1)], expression) },
                        ...signed.slice(1)];
                }
                if (rest.length && rest.at(-1)!.kind === 'value') {
                    const last = rest.pop() as Token & { kind: 'value' };
                    return [head, ...rest, { kind: 'value', value: application([...flatten(last.value), negated, ...parts.slice(1)], expression) },
                        ...signed.slice(1)];
                }
            }
            return [...tokens(expression.left), { kind: 'operator', value: expression }, ...tokens(expression.right),
                ...(expression.step ? [{ kind: 'operator' as const, value: { ...expression, operator: 'by' } },
                    ...tokens(expression.step)] : [])];
        }
        if (isMaterializeExpression(expression)) {
            return [...tokens(expression.source), { kind: 'materialize', original: expression }];
        }
        if (isApplicationExpression(expression)) {
            const ungrouped = flatten(expression);
            // The parser reads `Values array len` as a call with the literal
            // `array len`. A function after `array` makes it postfix: the source
            // materializes and the call goes on. Data keeps it a selector.
            const tail = ungrouped.at(-1);
            const literal = isArrayExpression(tail) && !tail.range && !tail.dimensions.length && !tail.rows.length
                && !tail.items[0]?.sign ? tail : undefined;
            const word = literal?.items[0]?.value;
            if (literal && word && (callable(word) || isHigherOrderOperator(word)
                || isNameExpression(word) && higherOrder.has(word.name) && standard(word))) {
                const source = { $type: 'MaterializeExpression', $cstNode: expression.$cstNode,
                    source: application(ungrouped.slice(0, -1), expression) } as Expression;
                return tokens(application([source, ...literal.items.map(item => item.value)], expression));
            }
            // repeat receives the function value, including its default words.
            const repeated = new Set(ungrouped.filter((_, index) => {
                const next = ungrouped[index + 1];
                const previous = ungrouped[index - 1];
                return isNameExpression(next) && next.name === 'repeat' && standard('repeat')
                    || isNameExpression(previous) && previous.name === 'till'
                        && isNameExpression(ungrouped[2]) && ungrouped[2].name === 'repeat' && standard(ungrouped[2]);
            }));
            const raw = groupDeclaredCalls(ungrouped,
                part => repeated.has(part) ? undefined : declaredSignature(part),
                callable, (part, message) => report(part, message));
            const joined = raw.findIndex(part => isHigherOrderOperator(part));
            if (joined > 0) {
                // `A scan + with 0` is the call form `A scan + with 0` that grouping and execution share.
                const { name, operator } = higherOrderParts(raw[joined] as HigherOrderOperator);
                if (!standard(name)) {
                    report(raw[joined], `\`${name}\` is rebound in this program, so \`${name} ${operator}\` cannot name the standard operation.`);
                }
                const nameExpression = { $type: 'NameExpression', name, $cstNode: raw[joined].$cstNode } as Expression;
                const call = application([nameExpression, ...raw.slice(joined + 1)], expression);
                const original = { $type: 'BinaryExpression', operator, left: raw[0], right: call,
                    $cstNode: expression.$cstNode } as BinaryExpression;
                return [...tokens(application(raw.slice(0, joined), expression)), { kind: 'symbolic', original }];
            }
            // `Steps scan next with Start` is the call form `Steps next scan with Start`.
            const named = raw.findIndex((part, index) => index > 0 && isNameExpression(part) && higherOrder.has(part.name)
                && standard(part.name));
            if (named > 0) {
                const operation = raw[named] as NameExpression;
                const next = raw[named + 1];
                if (isNameExpression(next) && !higherOrderParameters.has(next.name)) {
                    raw[named] = next;
                    raw[named + 1] = operation;
                } else {
                    report(operation, `${operation.name} needs its combining operation after it, e.g. \`Range ${operation.name} + with 0\` or \`Range ${operation.name} next with Start\`.`);
                }
            }
            const original = raw.map(part => visit(part) as Expression);
            for (let cursor = 1; cursor < original.length; cursor++) {
                const part = original[cursor];
                if (!isNameExpression(part) || standardOperation(part)?.grouping?.trailingOperands !== 'alternatives') continue;
                let previousCall = -1;
                for (let index = cursor - 1; index >= 0; index--) {
                    if (callable(original[index])) { previousCall = index; break; }
                }
                // Three values before choose already form the old postfix call.
                if (cursor - previousCall - 1 >= 3) continue;
                const nextCall = original.findIndex((candidate, index) => index > cursor && callable(candidate));
                const end = nextCall < 0 ? original.length : nextCall;
                const options = original.slice(cursor + 1, end);
                if (options.length !== 1 && options.length !== 2) continue;
                original.splice(cursor, end - cursor, ...options, part);
                cursor = end - 1;
            }
            const parts: Expression[] = [];
            for (let index = 0; index < original.length; index++) {
                const part = original[index];
                const next = original[index + 1];
                if (isNameExpression(part) && standardOperation(part)?.grouping?.trailingOperands === 1 && next && !callable(next)) {
                    parts.push(next, part);
                    index++;
                } else {
                    // `Left max Right` was an infix form; a chain such as `A B max 5 min` continues with a call.
                    if (isNameExpression(part) && standardOperation(part)?.grouping?.rejectInfix
                        && parts.length > 0 && next && index + 2 === original.length && !callable(next)
                        && !(isNameExpression(next) && modifiers.has(next.name))
                        && !(isLabelLiteral(next) && standardOperation(part)?.modifiers?.includes(next.name))) {
                        report(part, `${part.name} is a postfix call. Write \`Left Right ${part.name}\` instead of \`Left ${part.name} Right\`.`);
                    }
                    parts.push(part);
                }
            }
            const first = parts.findIndex((part, index) => index > 0 && callable(part));
            if (first > 0) return [
                { kind: 'value', value: application(parts.slice(0, first), expression) },
                { kind: 'call', parts: parts.slice(first), original: expression },
            ];
            return [{ kind: 'value', value: application(parts, expression) }];
        }
        return [{ kind: 'value', value: visitChildren(expression) as Expression }];
    }

    function formula(expression: Expression): Expression {
        const input = tokens(expression);
        if (input.some(token => token.kind === 'operator')) {
            for (const token of input) if (token.kind === 'value') {
                for (const part of flatten(token.value).slice(1)) {
                    if (!callable(part)) annotate(part, { dataOperand: true });
                }
            }
        }
        const values: Expression[] = [];
        const operators: BinaryExpression[] = [];
        let phase: 'formula' | 'calls' | 'adjustment' = 'formula';
        function reduce(): void {
            const operator = operators.pop()!;
            const right = values.pop()!;
            const left = values.pop()!;
            values.push(operator.operator === 'by'
                ? { ...left, step: right } as Expression
                : { ...operator, left, right, step: undefined } as Expression);
        }
        for (const token of input) {
            if (token.kind === 'value') values.push(token.value);
            else if (token.kind === 'operator') {
                if (phase === 'calls') phase = 'adjustment';
                while (operators.length && (precedence[operators.at(-1)!.operator] > precedence[token.value.operator]
                    || (precedence[operators.at(-1)!.operator] === precedence[token.value.operator] && token.value.operator !== '**'))) reduce();
                operators.push(token.value);
            } else {
                // `A to X len` bounds the range by the length of `X`: a bare name bound
                // takes `len` itself. Literals keep the formula rule, so `1 till 5 len` counts.
                const bound = values.at(-1);
                if (token.kind === 'call' && operators.length && isRangeOperator(operators.at(-1)!.operator)
                    && token.parts.length === 1 && isNameExpression(token.parts[0]) && standardOperation(token.parts[0])?.grouping?.rangeBound && isNameExpression(bound) && !callable(bound)) {
                    values.push(application([values.pop()!, ...token.parts], token.original));
                    continue;
                }
                if (phase === 'adjustment') report(token.kind === 'call' ? token.parts[0] : token.original,
                    'A new function call after arithmetic requires an intermediate variable. Name the result on the left, then apply the function.');
                const extra: Expression[] = [];
                if (token.kind === 'call' && operators.length && isNameExpression(token.parts[0])) {
                    const name = token.parts[0].name;
                    const pending = flatten(values.pop()!);
                    const local = metadata(token.parts[0]).arities;
                    const supplied = options.bindings?.get(name);
                    const accepted = local ?? (supplied || undefined) ?? operationArities(name) ?? [1];
                    const modifier = token.parts[1];
                    const unary = accepted.includes(1) && isNameExpression(modifier)
                        && (modifier.name === 'axis' || modifier.name === 'rank');
                    const count = unary ? 1 : Math.max(1, ...accepted.filter(arity => arity <= pending.length));
                    if (count > 1 && pending.length >= count) extra.push(...pending.splice(1 - count));
                    values.push(application(pending, token.original));
                }
                while (operators.length) reduce();
                const source = values.pop()!;
                if (token.kind === 'materialize') {
                    values.push({ ...token.original, source } as Expression);
                } else if (token.kind === 'symbolic') {
                    values.push({ ...token.original, left: source, right: visit(token.original.right, false) } as Expression);
                } else {
                    const data = isBinaryExpression(source) ? [grouped(source)] : flatten(source);
                    values.push(application([...data, ...extra, ...token.parts], token.original));
                }
                phase = 'calls';
            }
        }
        while (operators.length) reduce();
        return { ...values[0], $cstNode: expression.$cstNode } as Expression;
    }
    function visitChildren(node: AstNode): AstNode {
        if (isFunctionStatement(node)) {
            for (const message of functionDeclarationErrors(node)) report(node, message);
        }
        if (isFunctionBindingStatement(node)) {
            const plan = functionBindingPlan(node);
            if (plan.error) report(node, plan.error);
            if (plan.value) node.value = visit(plan.value) as Expression;
            for (const definition of plan.definitions) {
                const wrapped = { $type: 'Program', statements: [definition] } as Program;
                errors.push(...groupExpressions(wrapped, options).diagnostics);
            }
            return node;
        }
        if (isHigherOrderOperator(node)) {
            report(node, `\`${node.text}\` needs the values it applies to on its left.`);
        }
        if (isNameExpression(node) && !node.name.includes('.')) {
            const binding = metadata(node);
            const supplied = options.bindings?.get(node.name);
            const arities = operationArities(node.name);
            annotate(node, { directName: binding.callable !== undefined ? binding.directName === true
                : supplied !== undefined ? supplied === false || !supplied.includes(0)
                : arities !== undefined && !arities.includes(0) });
        }
        // Newly grouped nodes do not have container links until the final pass.
        const record = node as unknown as Record<string, unknown>;
        const rightHead = isBinaryExpression(node) ? flatten(node.right)[0] : undefined;
        const symbolicRight = isNameExpression(rightHead) && symbolic.has(rightHead.name);
        for (const [property, value] of Object.entries(node)) {
            if (property.startsWith('$')) continue;
            // Symbolic modifiers belong to the binary operation, including its
            // left operand. Do not group their suffix as a standalone call.
            if (isAstNode(value)) record[property] = visit(value, !(symbolicRight && property === 'right'));
            else if (Array.isArray(value)) record[property] = value.map(item => isAstNode(item) ? visit(item) : item);
        }
        return node;
    }
    function visit(node: AstNode, modifiers = true): AstNode {
        if (isBinaryExpression(node) && comparisons.has(node.operator)
            && isBinaryExpression(node.left) && comparisons.has(node.left.operator)) {
            report(node, 'Comparison chains require explicit grouping. Add parentheses or introduce an intermediate variable.', 'operator');
        }
        const result = isExpression(node) && (isApplicationExpression(node) || isMaterializeExpression(node)
            || (isBinaryExpression(node) && precedence[node.operator])) ? formula(node) : visitChildren(node);
        const grouped = modifiers && isExpression(result) ? groupModifiers(result, standard) : result;
        // Editor lookups starting from concrete syntax use the same grouped tree.
        if (grouped.$cstNode) (grouped.$cstNode as { astNode: AstNode }).astNode = grouped;
        return grouped;
    }
    splitClauseConditions(program, {
        callable,
        arities: part => {
            if (!isNameExpression(part)) return [];
            const local = metadata(part).arities;
            const supplied = options.bindings?.get(part.name);
            return local || (supplied || undefined) || operationArities(part.name) || [];
        },
    });
    visitChildren(program);
    AstUtils.linkContentToContainer(program, { deep: true });
    return result;
}
