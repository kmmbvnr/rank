import { AstUtils, isAstNode, type AstNode } from 'langium';
import {
    applicationExpression, applicationForm, expressionFacts, expressionFreeReads, flattenApplication,
    isApplicationExpression, isBinaryExpression, isBooleanLiteral, isDeclaredCallExpression, isLabelLiteral, isNumberLiteral, isStringLiteral,
    isExpression, isNameExpression, isParenthesizedExpression, isStdinExpression, nameNeedsExecution, UNKNOWN_VALUE,
    type Expression, type NameExpression, type Operation,
} from '@arrrank/language';
import { denseScalarItems } from '../array-storage.js';
import type { BindingEnvironment } from '../binding-environment.js';
import { completed, resume, runExecution, type Evaluation, type Execution } from '../execution.js';
import { LocalFrame } from '../frame.js';
import { BuiltinRegistry } from '../modules/builtins.js';
import { isRankPlan, type RankPlan } from '../plan.js';
import { isNativeFunction, isRankArray, isRankSequence, MISSING, type NativeFunction, type RankValue } from '../value.js';
import { identifySqliteSource } from '../sqlite-source.js';

interface ConstructionContext {
    readonly bindings: BindingEnvironment;
    findVariable(name: string): RankValue | undefined;
    resolve(name: string): RankValue;
    operationOf(name: string): Operation | undefined | false;
    snapshotFunction(fn: NativeFunction, seen: Map<NativeFunction, NativeFunction>): NativeFunction;
    execute(expression: Expression, tail: boolean): Evaluation<RankValue>;
    compileReduction(expression: Expression): (() => RankValue | undefined) | undefined;
}

type ConstructionMode = 'defer' | 'propagate' | 'demand';

/** Stage calls and stream creation, then retain the expression and captured values.
 * A callback in a filter or ranked operation is a reference, not an invocation.
 * The original syntax is never mutated while replacing a staged call's result. */
export class PlanConstruction {
    private nextReference = 0;
    private readonly references = new WeakSet<Expression>();

    constructor(private readonly context: ConstructionContext) {}

    isReference(expression: Expression): boolean { return this.references.has(expression); }

    hasUserFunction(expression: Expression): boolean {
        return expressionFreeReads(expression).some(node => !this.isReference(node) && !!this.userFunction(node));
    }

    hasInput(expression: Expression): boolean {
        return expressionFreeReads(expression).some(node => {
            const value = this.context.findVariable(node.name);
            return value !== undefined && (isRankPlan(value) || isRankSequence(value)
                || isRankArray(value) && denseScalarItems(value) === undefined);
        });
    }

    build(expression: Expression, mode: ConstructionMode, tail = false): Evaluation<RankValue> {
        return this.inScope(expression, mode, tail);
    }

    private *inScope(expression: Expression, mode: ConstructionMode, tail: boolean): Execution<RankValue> {
        const caller = this.context.bindings.current;
        this.context.bindings.current = new LocalFrame(caller, new Map(), new Set());
        try { return yield* resume(this.construct(expression, mode, tail)); }
        finally { this.context.bindings.current = caller; }
    }

    private *construct(expression: Expression, mode: ConstructionMode, tail: boolean): Execution<RankValue> {
        const rewritten = yield* resume(this.rewrite(expression, tail));
        let source = rewritten;
        while (isParenthesizedExpression(source)) source = source.value;
        if (isNameExpression(source)) {
            const value = this.context.findVariable(source.name);
            if (value !== undefined && (!isNativeFunction(value) || this.isReference(source)
                || !value.arities.includes(0))) return value;
        }
        if (mode === 'demand' || mode === 'propagate' && !this.hasInput(rewritten)
            || isBinaryExpression(source) && ['to', 'till'].includes(source.operator)
                && !AstUtils.streamAst(rewritten).some(node => isNameExpression(node)
                    && isRankPlan(this.context.findVariable(node.name) ?? MISSING))) {
            return yield* resume(this.context.execute(rewritten, tail));
        }
        return this.capture(rewritten);
    }

    private userFunction(expression: NameExpression): NativeFunction | undefined {
        const value = this.context.findVariable(expression.name);
        return value && isNativeFunction(value) && !BuiltinRegistry.operationOf(value) ? value : undefined;
    }

    private wholeCall(fn: NativeFunction): boolean {
        return fn.monadicRank === 'all' && !fn.dyadicRanks?.some(rank => rank !== 'all');
    }

    private reference(value: RankValue, original: Expression): NameExpression {
        const name = `$plan${this.nextReference++}`;
        this.context.bindings.scope.set(name, value);
        const reference = { $type: 'NameExpression', name, $cstNode: original.$cstNode } as NameExpression;
        this.references.add(reference);
        return reference;
    }

    private *rewrite(expression: Expression, tail = false, invokeName = true): Execution<Expression> {
        // A counted input is one consumable resource. Keep that instance in the
        // recipe; replaying the recipe must not silently open another stream.
        if (isStdinExpression(expression) && expression.count) {
            return this.reference(yield* resume(this.context.execute(expression, tail)), expression);
        }
        if (isNameExpression(expression)) {
            const fn = !this.isReference(expression) && this.userFunction(expression);
            return fn && invokeName && fn.arities.includes(0)
                ? this.reference(yield* resume(this.context.execute(expression, tail)), expression) : expression;
        }
        if (isDeclaredCallExpression(expression) && isNameExpression(expression.callee)
            && this.userFunction(expression.callee) && !expression.ranks.length && !expression.axes.length
            && this.wholeCall(this.userFunction(expression.callee)!)) {
            return this.reference(yield* resume(this.context.execute(expression, tail)), expression);
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            const form = applicationForm(expression, name => this.context.operationOf(name));
            if (form.kind === 'plain') {
                for (let index = 1; index < parts.length; index++) {
                    const part = parts[index];
                    const fn = isNameExpression(part) && this.userFunction(part);
                    if (!fn || fn.arities.includes(0) || !this.wholeCall(fn)) continue;
                    // The ordinary call path owns argument grouping, arity,
                    // parameter modes and ownership transfers.
                    // Whole calls keep syntax identity for inferred input contracts.
                    const call = index === parts.length - 1 ? expression
                        : applicationExpression(parts.slice(0, index + 1), expression);
                    const result = yield* resume(this.context.execute(call, tail && index === parts.length - 1));
                    const remainder = applicationExpression([this.reference(result, call), ...parts.slice(index + 1)], expression);
                    return yield* resume(this.rewrite(remainder, tail));
                }
            }
            const callbacks = new Set<Expression>();
            if ('operation' in form && isExpression(form.operation)) callbacks.add(form.operation);
            if (form.kind === 'rank') callbacks.add(form.parts.at(-1)!);
            if (form.kind === 'repeat' && form.until) callbacks.add(form.until);
            if (form.kind === 'new-graph') {
                if (form.predicate) callbacks.add(form.predicate);
                if (form.successor) callbacks.add(form.successor);
            }
            // Flatten only this application's syntax. Callback positions retain
            // function references, including a parenthesized nullary function.
            const rewritten: Expression[] = [];
            for (let index = 0; index < parts.length; index++) {
                const part = parts[index];
                rewritten.push(yield* resume(callbacks.has(part) ? this.rewriteCallback(part)
                    : this.rewrite(part, false, index === 0 || nameNeedsExecution(part))));
            }
            return rewritten.every((part, index) => part === parts[index]) ? expression
                : { ...expression, ...applicationExpression(rewritten, expression) } as Expression;
        }
        if (isParenthesizedExpression(expression)) {
            const value = yield* resume(this.rewrite(expression.value, tail));
            return value === expression.value ? expression : { ...expression, value } as Expression;
        }
        if (isBinaryExpression(expression) && ['and', 'or', 'default'].includes(expression.operator)) {
            const left = yield* resume(this.rewrite(expression.left));
            const ready = this.readyValue(left);
            if (typeof ready === 'boolean' && (expression.operator === 'and' && !ready
                || expression.operator === 'or' && ready)) return left;
            if (expression.operator === 'default' && ready !== undefined && ready !== MISSING && !isRankArray(ready)) return left;
            const selected = expression.operator === 'default' ? ready === MISSING : ready !== undefined;
            const right = selected ? yield* resume(this.rewrite(expression.right)) : expression.right;
            return left === expression.left && right === expression.right ? expression
                : { ...expression, left, right } as Expression;
        }
        const clone: Record<string, unknown> = { ...expression };
        let changed = false;
        const order = isBinaryExpression(expression) ? ['left', 'right', 'step']
            : expression.$type === 'ArrayExpression' ? ['range', 'rows', 'items', 'dimensions', 'fill']
                : expression.$type === 'RecordUpdateExpression' ? ['source', 'fields'] : [];
        const entries = Object.entries(expression).sort(([a], [b]) =>
            (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
        for (const [key, value] of entries) {
            if (key.startsWith('$') || this.deferredChild(expression, key)) continue;
            const rewritten = yield* resume(this.rewriteChild(value));
            if (rewritten !== value) { clone[key] = rewritten; changed = true; }
        }
        return changed ? clone as unknown as Expression : expression;
    }

    private *rewriteCallback(expression: Expression): Execution<Expression> {
        if (isNameExpression(expression)) return expression;
        if (isParenthesizedExpression(expression)) {
            const value = yield* resume(this.rewriteCallback(expression.value));
            return value === expression.value ? expression : { ...expression, value } as Expression;
        }
        return yield* resume(this.rewrite(expression));
    }

    private readyValue(expression: Expression): RankValue | undefined {
        while (isParenthesizedExpression(expression)) expression = expression.value;
        if (isNameExpression(expression)) {
            const value = this.context.findVariable(expression.name);
            return value !== undefined && !isRankPlan(value) ? value : undefined;
        }
        if (isBooleanLiteral(expression) || isNumberLiteral(expression) || isStringLiteral(expression)) return expression.value;
        return isLabelLiteral(expression) && expression.name === 'NA' ? MISSING : undefined;
    }

    private deferredChild(expression: Expression, key: string): boolean {
        if (['TableFilterExpression', 'BoundClauseExpression'].includes(expression.$type)
            && (key === 'condition' || key === 'conditions')) return true;
        if (['TakeWhileExpression', 'FirstWhereExpression', 'FirstIndexWhereExpression'].includes(expression.$type)
            && key === 'mask') return true;
        return ['TableSelectExpression', 'TableWriteExpression'].includes(expression.$type) && key === 'entries';
    }

    private *rewriteChild(value: unknown): Execution<unknown> {
        if (isExpression(value)) return yield* resume(this.rewrite(value));
        if (Array.isArray(value)) {
            const result: unknown[] = [];
            for (const item of value) result.push(yield* resume(this.rewriteChild(item)));
            return result.every((item, index) => item === value[index]) ? value : result;
        }
        if (!isAstNode(value)) return value;
        const result: Record<string, unknown> = { ...value };
        let changed = false;
        for (const [key, item] of Object.entries(value)) {
            if (key.startsWith('$')) continue;
            const rewritten = yield* resume(this.rewriteChild(item));
            if (rewritten !== item) { result[key] = rewritten; changed = true; }
        }
        return changed ? result as unknown as AstNode : value;
    }

    private capture(expression: Expression): RankPlan {
        const source = {};
        const dependencies = new Map<string, RankValue>();
        const functions = new Map<NativeFunction, NativeFunction>();
        for (const node of expressionFreeReads(expression)) {
            const value = this.context.findVariable(node.name);
            if (value !== undefined) dependencies.set(node.name, isNativeFunction(value)
                ? this.context.snapshotFunction(value, functions) : value);
            else if (/^[A-Z]/.test(node.name)) this.context.resolve(node.name);
        }
        const snapshot = new LocalFrame(undefined, new Map(), new Set(dependencies.keys()));
        for (const [name, value] of dependencies) snapshot.set(name, value);
        const result = expressionFacts(expression, name => {
            const value = dependencies.get(name);
            if (value === undefined) return undefined;
            if (isRankPlan(value)) return value.result ?? UNKNOWN_VALUE;
            if (typeof value === 'bigint') return { types: ['integer'], rank: 0, shape: [] };
            if (typeof value === 'number') return { types: ['real'], rank: 0, shape: [] };
            if (typeof value === 'boolean') return { types: ['boolean'], rank: 0, shape: [] };
            if (typeof value === 'string') return { types: ['text'], rank: 1 };
            if (isRankSequence(value)) return { types: ['sequence'], rank: 1 };
            if (isRankArray(value) && denseScalarItems(value) !== undefined) {
                return { types: [value.kind], rank: value.shape.length, shape: [...value.shape] };
            }
            return UNKNOWN_VALUE;
        });
        const compiled = this.context.compileReduction(expression);
        return { kind: 'plan', expression, dependencies, result,
            evaluate: () => completed(this.context.bindings.withFrame(snapshot,
                () => identifySqliteSource(compiled?.() ?? runExecution(this.context.execute(expression, false)), source))),
        };
    }
}
