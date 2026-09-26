import { groupModifiers } from './modifier-grouping.js';
import { AstUtils, GrammarUtils, isAstNode, type AstNode, type CstNode } from 'langium';
import {
    isApplicationExpression, isBinaryExpression, isExpression, isMaterializeExpression,
    isNameExpression,
    type BinaryExpression, type Expression, type Program,
} from './generated/ast.js';
import { analyzeBindings } from './analysis/bindings.js';
import { flattenApplication as flatten, applicationExpression as application, groupedExpression as grouped } from './expressions.js';
import { operationArities } from './operations.js';

// A comparison takes one operand on each side and binds below arithmetic, so
// calls after it apply to its result, as on a calculator: `A greater 2 sum`.
// Logical operators still separate independent clauses.
const precedence: Readonly<Record<string, number>> = {
    equal: 0.5, notequal: 0.5, less: 0.5, greater: 0.5, atleast: 0.5, atmost: 0.5, multipleby: 0.5,
    to: 1, until: 1, by: 1, '+': 2, '-': 2, '*': 3, '/': 3, '//': 3, '%': 3, '**': 4,
};
const comparisons = new Set(['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'multipleby', 'in', 'notin', 'is']);
const symbolic = new Set(['reduce', 'scan', 'outer', 'segment', 'rank', 'axis']);
const modifiers = new Set(['axis', 'rank', 'outer', 'segment', 'scan']);

export interface GroupingDiagnostic {
    readonly message: string;
    readonly node: AstNode;
    readonly cst?: CstNode;
}
const diagnostics = new WeakMap<Program, GroupingDiagnostic[]>();
const dataOperands = new WeakSet<Expression>();
const directNames = new WeakSet<Expression>();
/** Known nullary calls and unresolved module words need the execution stack. */
export function nameNeedsExecution(expression: Expression): boolean {
    return !directNames.has(expression);
}
/** An unresolved operand cannot become an implicit call inside arithmetic. */
export function requiresDataOperand(expression: Expression): boolean {
    return dataOperands.has(expression);
}
export function expressionDiagnostics(program: Program): readonly GroupingDiagnostic[] {
    return diagnostics.get(program) ?? [];
}

export interface GroupingOptions {
    /** Signatures from earlier REPL inputs; false marks a data binding. */
    readonly bindings?: ReadonlyMap<string, readonly number[] | false>;
}

/**
 * Whitespace can mean addressing or application. Resolve that distinction once,
 * before analysis and execution consume the tree. Parentheses bound independent
 * formulas; arithmetic keeps its mathematical precedence, and comparisons bind
 * below it, so a call after a comparison applies to the comparison's result.
 */
export function groupExpressions(program: Program, options: GroupingOptions = {}): void {
    const errors: GroupingDiagnostic[] = [];
    diagnostics.set(program, errors);
    const externalFunctions = new Map<string, readonly number[]>();
    for (const [name, signature] of options.bindings ?? []) {
        if (signature !== false) externalFunctions.set(name, signature);
    }
    const facts = analyzeBindings(program, [], externalFunctions);
    const sites = new Map<string, boolean>();
    const arities = new Map<string, readonly number[]>();
    const directSites = new Set<string>();
    const siteKey = (line: number, column: number) => `${line}:${column}`;
    for (const scope of facts.scopes) for (const binding of scope.bindings) {
        for (const read of binding.reads) {
            const key = siteKey(read.line, read.column);
            sites.set(key, (binding.kind === 'function' || binding.types.includes('function'))
                && !binding.arities?.includes(0));
            if (binding.arities) arities.set(key, binding.arities);
            if (!binding.arities?.includes(0)) directSites.add(key);
        }
    }
    // Source-module functions use the same lower-case spelling as local `fun`
    // declarations; their implementations need not be loaded to group a call.
    for (const word of facts.words) {
        if (/^[a-z]/.test(word.name.split('.').at(-1)!)) {
            for (const read of word.sites) sites.set(siteKey(read.line, read.column), true);
        }
    }
    const callable = (part: Expression): boolean => {
        if (!isNameExpression(part)) return false;
        const start = part.$cstNode?.range.start;
        const bound = start && sites.get(siteKey(start.line + 1, start.character + 1));
        if (bound !== undefined) return bound;
        const supplied = options.bindings?.get(part.name);
        if (supplied !== undefined) return supplied !== false && !supplied.includes(0);
        return (operationArities(part.name)?.length ?? 0) > 0;
    };
    const report = (node: AstNode, message: string, property?: string) => {
        errors.push({ node, message, cst: property ? GrammarUtils.findNodeForProperty(node.$cstNode, property) : node.$cstNode });
    };
    function hasCall(expression: Expression): boolean {
        if (isMaterializeExpression(expression)) return true;
        if (isApplicationExpression(expression)) return flatten(expression).slice(1)
            .some(part => callable(part) || (isNameExpression(part) && symbolic.has(part.name)));
        return isBinaryExpression(expression) && !!precedence[expression.operator]
            && (hasCall(expression.left) || hasCall(expression.right));
    }
    type Token = { kind: 'value'; value: Expression }
        | { kind: 'operator'; value: BinaryExpression }
        | { kind: 'call'; parts: Expression[]; original: Expression }
        | { kind: 'symbolic'; original: BinaryExpression }
        | { kind: 'materialize'; original: Expression };

    function tokens(expression: Expression): Token[] {
        // A pipeline on the left of a comparison makes it symmetric: each side
        // keeps its own calls (`A len equal B len`). Only a bare left operand
        // lets later calls apply to the comparison's result (`A greater 2 sum`).
        if (isBinaryExpression(expression) && comparisons.has(expression.operator) && hasCall(expression.left)) {
            return [{ kind: 'value', value: visitChildren(expression) as Expression }];
        }
        if (isBinaryExpression(expression) && precedence[expression.operator]) {
            const left = flatten(expression.left);
            const last = left.at(-1);
            if (expression.operator === '-' && isNameExpression(last) && last.name === 'round') {
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
                return [...tokens(expression.left), { kind: 'symbolic', original: expression }];
            }
            return [...tokens(expression.left), { kind: 'operator', value: expression }, ...tokens(expression.right),
                ...(expression.step ? [{ kind: 'operator' as const, value: { ...expression, operator: 'by' } },
                    ...tokens(expression.step)] : [])];
        }
        if (isMaterializeExpression(expression)) {
            return [...tokens(expression.source), { kind: 'materialize', original: expression }];
        }
        if (isApplicationExpression(expression)) {
            const original = flatten(expression).map(part => visit(part) as Expression);
            const parts: Expression[] = [];
            for (let index = 0; index < original.length; index++) {
                const part = original[index];
                const next = original[index + 1];
                if (isNameExpression(part) && part.name === 'round' && next && !callable(next)) {
                    parts.push(next, part);
                    index++;
                } else if (isNameExpression(part) && (part.name === 'min' || part.name === 'max')
                    && parts.length > 0 && next && !callable(next)
                    && !(isNameExpression(next) && modifiers.has(next.name))) {
                    const source = grouped(application([...parts], expression));
                    parts.splice(0, parts.length, source, next, part);
                    index++;
                } else parts.push(part);
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
                    if (!callable(part)) dataOperands.add(part);
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
                if (phase === 'adjustment') report(token.kind === 'call' ? token.parts[0] : token.original,
                    'A new function call after arithmetic requires an intermediate variable. Name the result on the left, then apply the function.');
                const extra: Expression[] = [];
                if (token.kind === 'call' && operators.length && isNameExpression(token.parts[0])) {
                    const name = token.parts[0].name;
                    const pending = flatten(values.pop()!);
                    const start = token.parts[0].$cstNode?.range.start;
                    const local = start && arities.get(siteKey(start.line + 1, start.character + 1));
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
        if (isNameExpression(node) && !node.name.includes('.')) {
            const start = node.$cstNode?.range.start;
            const key = start && siteKey(start.line + 1, start.character + 1);
            const supplied = options.bindings?.get(node.name);
            const standard = operationArities(node.name);
            if (key && sites.has(key) ? directSites.has(key)
                : supplied !== undefined ? supplied === false || !supplied.includes(0)
                : standard !== undefined && !standard.includes(0)) directNames.add(node);
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
        const grouped = modifiers && isExpression(result) ? groupModifiers(result) : result;
        // Editor lookups starting from concrete syntax use the same grouped tree.
        if (grouped.$cstNode) (grouped.$cstNode as { astNode: AstNode }).astNode = grouped;
        return grouped;
    }
    visitChildren(program);
    AstUtils.linkContentToContainer(program, { deep: true });
}
