/**
 * Binding and mutation facts: where every name is bound, read and written.
 *
 * No types are inferred here. The questions this answers are the ones a syntax
 * tree already settles exactly — which scope a name belongs to, whether it is
 * ever written twice, whether a loop carries it, whether anything reads it, and
 * which reads resolve to standard-library vocabulary instead of a binding. That
 * last one is where the catalogue comes in: a read of a catalogued name in a
 * file that never opens its module is a missing `use`, decided without running.
 */

import {
    isAddStatement, isApplicationExpression, isArgsStatement, isArgumentStatement,
    isArrayAssignmentStatement, isArrayExpression, isAssignmentStatement, isBinaryExpression, isExpressionStatement, isFlagStatement,
    isForStatement, isFunctionStatement, isIfStatement, isIndexAssignmentStatement,
    isKeyedGroupExpression, isKeyedJoinExpression, isKeyedSortExpression,
    isMaterializeExpression, isNameExpression, isOptionStatement, isParenthesizedExpression,
    isTableFilterExpression, isTableSelectExpression, isTableWriteExpression, isTableWritePreviewExpression, isSelectLocal,
    isPushStatement, isRecordExpression, isRecordField, isReturnStatement, isStdinExpression,
    isTestStatement, isTryStatement, isUnaryExpression, isUnpackExpression,
    isUnpackStatement, isUseStatement, isYieldStatement,
    type Expression, type Program, type Statement,
} from '../generated/ast.js';
import type { AstNode } from 'langium';
import { findOperation } from '../operations.js';
import {
    compoundType, declaredType, typeOf, unionTypes, UNKNOWN, type Types,
} from './types.js';

/** A one-based position in the source. */
export interface Site {
    readonly line: number;
    readonly column: number;
}

/** How a name came to exist. */
export type BindingKind =
    | 'assignment' | 'parameter' | 'loop' | 'unpack' | 'catch'
    | 'argument' | 'option' | 'flag' | 'module' | 'function';

export interface Binding {
    readonly name: string;
    readonly kind: BindingKind;
    /** Where the name first appears as something being bound. */
    readonly bound: Site;
    readonly writes: readonly Site[];
    readonly reads: readonly Site[];
    /** Written more than once, so its value is not settled by one line. */
    readonly reassigned: boolean;
    /** Never read: dead, or kept only for its effect. */
    readonly unused: boolean;
    /** Read and written inside the same loop, so it accumulates across turns. */
    readonly loopCarried: boolean;
    /** Hides a name of the same spelling in the program scope. */
    readonly shadows: boolean;
    /**
     * Runtime types the name may hold. Empty means unknown, which is the
     * honest answer for a parameter, a loop value or anything a user function
     * returns: Rank states no types, so most names have none to report.
     */
    readonly types: Types;
}

export type ScopeKind = 'program' | 'function' | 'test' | 'select' | 'update';

export interface ScopeFacts {
    readonly kind: ScopeKind;
    /** The program, a function name, or a test description. */
    readonly name: string;
    readonly at: Site;
    readonly bindings: readonly Binding[];
}

/** A name read that no binding explains. */
export interface WordUse {
    /** The module that defines it, or undefined when nothing does. */
    readonly module: string | undefined;
    readonly name: string;
    readonly sites: readonly Site[];
}

/** A Rank source module the program loads. */
export interface Import {
    readonly path: string;
    readonly alias?: string;
    readonly at: Site;
}

export interface ProgramFacts {
    /** Source modules the program loads, which supply names this pass cannot see. */
    readonly imports: readonly Import[];
    /** Standard modules this program opens, in source order. */
    readonly modules: readonly string[];
    readonly scopes: readonly ScopeFacts[];
    /** Catalogued names the program reads, whose module it opens. */
    readonly operations: readonly WordUse[];
    /** Catalogued names the program reads without opening their module. */
    readonly missing: readonly WordUse[];
    /** Words that are neither a binding nor catalogue vocabulary. */
    readonly words: readonly WordUse[];
}

/**
 * Words the grammar parses as ordinary names but the runtime reads as part of a
 * form: application modifiers, container kinds and receiver methods. They are
 * not catalogue entries and not bindings, so they would otherwise be reported
 * as unknown on nearly every line.
 */
const CORE = new Set(['raise', 'type']);

/**
 * Structures every function gets without declaring them. `queue push X` names
 * one of these, so it is not a binding the program introduced.
 */
const IMPLICIT = new Set(['queue', 'set', 'counter', 'index']);

/**
 * Words that dispatch on the receiver when they stand in the middle of an
 * application chain: `Bag floor Limit`, `Counts sum Position`, `Dsu A B merge`.
 * The runtime resolves these by the receiver's type and never looks the word up
 * as a name, so a middle-position occurrence is not a read of any module.
 */
const METHODS = new Set([
    'add', 'remove', 'sum', 'floor', 'ceiling', 'lowerbound', 'upperbound',
    'find', 'merge', 'connected', 'jump', 'distance', 'edges',
]);

const MODIFIERS = new Set([
    'axis', 'rank', 'by', 'with', 'reduce', 'scan', 'outer', 'stride', 'padding',
    'ascending', 'descending', 'array', 'shape', 'index', 'type', 'edges', 'value', 'key', 'from',
    'queue', 'stack', 'deque', 'heap', 'set', 'counter', 'orderedset',
    'graph', 'dsu', 'multiset', 'fenwick', 'segment', 'wavelet',
]);

/**
 * `imported` names come from Rank source modules the caller has already read.
 * Without them a program that loads a module reports every borrowed name as
 * unresolved, so a caller that can reach the file system should supply them.
 */
export function analyzeBindings(
    program: Program,
    imported: Iterable<string> = [],
): ProgramFacts {
    return new Analyzer(new Set(imported)).run(program);
}

interface Slot {
    readonly name: string;
    kind: BindingKind;
    bound: Site;
    readonly writes: Site[];
    readonly reads: Site[];
    /** Loop depths at which the name was written, to spot accumulators. */
    readonly writeDepths: Set<number>;
    readonly readDepths: Set<number>;
    shadows: boolean;
    types: Types;
}

interface ScopeState {
    readonly kind: ScopeKind;
    readonly name: string;
    readonly at: Site;
    readonly slots: Map<string, Slot>;
}

function site(node: AstNode | undefined): Site {
    const start = node?.$cstNode?.range.start;
    return { line: (start?.line ?? 0) + 1, column: (start?.character ?? 0) + 1 };
}

/** A read whose name no binding explained yet, kept with the scopes it saw. */
interface PendingRead {
    readonly name: string;
    readonly at: Site;
    readonly chain: readonly ScopeState[];
    readonly depth: number;
}

/**
 * Facts for a program together with the names its source modules supply.
 * `load` returns the parsed module for an import path, or undefined when it
 * cannot be read; this package never reaches a file system itself.
 */
export function analyzeWithImports(
    program: Program,
    load: (path: string) => Program | undefined,
): ProgramFacts {
    const first = analyzeBindings(program);
    const names: string[] = [];
    for (const entry of first.imports) {
        const module = load(entry.path);
        if (module === undefined) continue;
        for (const scope of analyzeBindings(module).scopes) {
            if (scope.kind !== 'program') continue;
            for (const binding of scope.bindings) names.push(binding.name);
        }
    }
    return names.length === 0 ? first : analyzeBindings(program, names);
}

class Analyzer {
    constructor(private readonly imported: ReadonlySet<string>) {}

    private readonly modules: string[] = [];
    private readonly imports: Import[] = [];
    private readonly scopes: ScopeState[] = [];
    private readonly pending: PendingRead[] = [];
    private readonly free = new Map<string, Site[]>();
    private readonly expressionScopes: ScopeState[] = [];
    private program!: ScopeState;
    private loopDepth = 0;

    run(program: Program): ProgramFacts {
        this.program = {
            kind: 'program', name: 'program', at: site(program), slots: new Map(),
        };
        this.scopes.push(this.program);
        const nested: ScopeState[] = [];
        this.block(program.statements, nested);
        this.settleReads();
        const opened = new Set(this.modules);
        const operations: WordUse[] = [];
        const missing: WordUse[] = [];
        const words: WordUse[] = [];
        for (const [name, sites] of [...this.free].sort()) {
            if (this.imported.has(name)) continue;
            const operation = findOperation(name);
            if (operation === undefined) {
                if (!MODIFIERS.has(name) && !CORE.has(name)) {
                    words.push({ module: undefined, name, sites });
                }
                continue;
            }
            const use: WordUse = { module: operation.module, name, sites };
            (opened.has(operation.module) ? operations : missing).push(use);
        }
        return {
            imports: this.imports,
            modules: this.modules,
            scopes: [this.program, ...nested, ...this.expressionScopes].map(scope => finish(scope)),
            operations, missing, words,
        };
    }

    /**
     * A statement list. Function names are bound first: a program may call a
     * function written further down, as most of the corpus does.
     */
    private block(statements: readonly Statement[], nested: ScopeState[]): void {
        for (const statement of statements) {
            if (isFunctionStatement(statement)) {
                this.bind(statement.name, 'function', statement, ['function']);
            }
        }
        for (const statement of statements) this.statement(statement, nested);
    }

    private statement(statement: Statement, nested: ScopeState[]): void {
        if (isUseStatement(statement)) {
            if (statement.module) this.modules.push(statement.module);
            if (statement.path !== undefined) {
                this.imports.push({
                    path: statement.path,
                    alias: statement.alias,
                    at: site(statement),
                });
            }
            if (statement.alias) this.bind(statement.alias, 'module', statement);
            return;
        }
        if (isFunctionStatement(statement) || isTestStatement(statement)) {
            const scope: ScopeState = {
                kind: isFunctionStatement(statement) ? 'function' : 'test',
                name: isFunctionStatement(statement) ? statement.name : statement.description,
                at: site(statement),
                slots: new Map(),
            };
            nested.push(scope);
            this.scopes.push(scope);
            if (isFunctionStatement(statement)) {
                for (const parameter of statement.parameters) {
                    this.bind(parameter, 'parameter', statement);
                }
            }
            this.block(statement.statements, nested);
            this.scopes.pop();
            return;
        }
        if (isAssignmentStatement(statement)) {
            // A compound operator reads the name before it writes it.
            if (statement.operator !== '=') this.read(statement.name, statement);
            this.expression(statement.value);
            const value = this.typeOf(statement.value);
            this.bind(statement.name, 'assignment', statement, statement.operator === '='
                ? value
                : compoundType(statement.operator,
                    this.lookup(statement.name)?.types ?? UNKNOWN, value));
            return;
        }
        if (isArrayAssignmentStatement(statement)) {
            this.read(statement.name, statement);
            for (const index of statement.indices) this.expression(index.value);
            this.expression(statement.value);
            this.write(statement.name, statement);
            return;
        }
        if (isUnpackStatement(statement)) {
            this.expression(statement.value);
            for (const name of statement.names) {
                if (name !== '#') this.bind(name, 'unpack', statement);
            }
            return;
        }
        if (isForStatement(statement)) {
            this.forStatement(statement, nested);
            return;
        }
        if (isIfStatement(statement)) {
            this.expression(statement.condition);
            this.block(statement.thenStatements, nested);
            for (const clause of statement.elifClauses) {
                this.expression(clause.condition);
                this.block(clause.statements, nested);
            }
            this.block(statement.elseStatements, nested);
            return;
        }
        if (isTryStatement(statement)) {
            this.block(statement.statements, nested);
            for (const clause of statement.catches) {
                this.bind(clause.errorName, 'catch', clause);
                this.block(clause.statements, nested);
            }
            this.block(statement.finallyStatements, nested);
            return;
        }
        if (isOptionStatement(statement) || isArgumentStatement(statement)) {
            if (statement.defaultValue) this.expression(statement.defaultValue);
            this.bind(statement.name, isOptionStatement(statement) ? 'option' : 'argument',
                statement, declaredType(statement.valueType, statement.many === true));
            return;
        }
        if (isFlagStatement(statement)) {
            this.bind(statement.name, 'flag', statement, ['boolean']);
            return;
        }
        if (isPushStatement(statement)) {
            this.mutate(statement.receiver);
            this.expression(statement.value);
            return;
        }
        if (isAddStatement(statement)) {
            this.expression(statement.value);
            return;
        }
        if (isIndexAssignmentStatement(statement)) {
            for (const key of statement.keys) this.expression(key);
            this.expression(statement.value);
            return;
        }
        if (isArgsStatement(statement)) {
            for (const value of statement.values) this.expression(value);
            return;
        }
        if (isReturnStatement(statement) || isYieldStatement(statement)) {
            if (statement.value) this.expression(statement.value);
            return;
        }
        if (isExpressionStatement(statement)) this.expression(statement.value);
    }

    private forStatement(
        statement: Extract<Statement, { $type: 'ForStatement' }>,
        nested: ScopeState[],
    ): void {
        const condition = statement.condition;
        const iteration = condition !== undefined && isBinaryExpression(condition)
            && condition.operator === 'in' ? condition : undefined;
        const binding = iteration && loopNames(iteration.left);
        if (iteration && binding) {
            this.expression(iteration.right);
            for (const name of binding) this.bind(name, 'loop', iteration);
        } else if (condition !== undefined) {
            this.expression(condition);
        }
        this.loopDepth += 1;
        this.block(statement.statements, nested);
        this.loopDepth -= 1;
    }

    /** A receiver that a statement changes in place is read and written at once. */
    private mutate(expression: Expression): void {
        this.expression(expression);
        if (isNameExpression(expression) && !IMPLICIT.has(expression.name)) {
            this.write(expression.name, expression);
        }
    }

    private expression(expression: Expression | undefined): void {
        if (expression === undefined) return;
        if (isNameExpression(expression)) {
            this.read(expression.name, expression);
            return;
        }
        if (isBinaryExpression(expression)) {
            this.expression(expression.left);
            this.expression(expression.right);
            // Only a range carries a step, and the field is optional on it.
            this.expression((expression as { step?: Expression }).step);
            return;
        }
        if (isUnaryExpression(expression)) {
            this.expression(expression.operand);
            return;
        }
        if (isApplicationExpression(expression)) {
            const parts = flatten(expression);
            for (const [index, part] of parts.entries()) {
                const method = index > 0 && index < parts.length - 1
                    && isNameExpression(part) && METHODS.has(part.name);
                if (!method) this.expression(part);
            }
            return;
        }
        if (isParenthesizedExpression(expression) || isUnpackExpression(expression)) {
            this.expression(expression.value);
            return;
        }
        if (isMaterializeExpression(expression)) {
            this.expression(expression.source);
            return;
        }
        if (isTableFilterExpression(expression)) {
            this.expression(expression.source);
            this.expression(expression.condition);
            for (const condition of expression.conditions) this.expression(condition);
            return;
        }
        if (isTableSelectExpression(expression)) {
            this.expression(expression.source);
            this.expression(expression.columns);
            const scope: ScopeState = {
                kind: 'select', name: 'select', at: site(expression), slots: new Map(),
            };
            this.expressionScopes.push(scope);
            this.scopes.push(scope);
            for (const entry of expression.entries) {
                // A calculation sees only earlier select locals, not later ones.
                const before = this.pending.length;
                if (!(isRecordField(entry) && isNameExpression(entry.value)
                    && entry.value.name === 'rownumber')) this.expression(entry.value);
                const visible = { ...scope, slots: new Map(scope.slots) };
                for (let i = before; i < this.pending.length; i += 1) {
                    const read = this.pending[i];
                    this.pending[i] = { ...read, chain: read.chain.map(s => s === scope ? visible : s) };
                }
                if (isSelectLocal(entry)) this.bind(entry.name, 'assignment', entry);
            }
            this.scopes.pop();
            return;
        }
        if (isTableWriteExpression(expression)) {
            this.expression(expression.source);
            for (const value of expression.values) this.expression(value);
            if (expression.entries.length === 0) return;
            const scope: ScopeState = {
                kind: 'update', name: 'update', at: site(expression), slots: new Map(),
            };
            this.expressionScopes.push(scope);
            this.scopes.push(scope);
            for (const entry of expression.entries) {
                const before = this.pending.length;
                this.expression(entry.value);
                const visible = { ...scope, slots: new Map(scope.slots) };
                for (let i = before; i < this.pending.length; i += 1) {
                    const read = this.pending[i];
                    this.pending[i] = { ...read, chain: read.chain.map(s => s === scope ? visible : s) };
                }
                if (isSelectLocal(entry)) this.bind(entry.name, 'assignment', entry);
            }
            this.scopes.pop();
            return;
        }
        if (isTableWritePreviewExpression(expression)) {
            this.expression(expression.write);
            return;
        }
        if (isKeyedSortExpression(expression)) {
            this.expression(expression.source);
            this.expression(expression.key);
            return;
        }
        if (isKeyedGroupExpression(expression)) {
            this.expression(expression.source);
            return;
        }
        if (isKeyedJoinExpression(expression)) {
            this.expression(expression.left);
            this.expression(expression.right);
            return;
        }
        if (isArrayExpression(expression)) {
            for (const dimension of expression.dimensions) this.expression(dimension.value);
            this.expression(expression.fill);
            for (const row of expression.rows) {
                for (const item of row.items) this.expression(item.value);
            }
            for (const item of expression.items) this.expression(item.value);
            return;
        }
        if (isRecordExpression(expression)) {
            for (const field of expression.fields) this.expression(field.value);
            return;
        }
        if (isStdinExpression(expression)) this.expression(expression.count);
    }

    private bind(name: string, kind: BindingKind, node: AstNode, types: Types = UNKNOWN): void {
        const scope = this.scopes.at(-1)!;
        const existing = scope.slots.get(name);
        if (existing === undefined) {
            scope.slots.set(name, {
                name, kind, bound: site(node), types,
                writes: [site(node)], reads: [],
                writeDepths: new Set([this.loopDepth]), readDepths: new Set(),
                shadows: scope !== this.program && this.program.slots.has(name),
            });
            return;
        }
        existing.writes.push(site(node));
        existing.writeDepths.add(this.loopDepth);
        // A second write widens the fact rather than replacing it.
        existing.types = unionTypes(existing.types, types);
    }

    /** The type of an expression, read against the scopes now in force. */
    private typeOf(expression: Expression | undefined): Types {
        return typeOf(expression, name => this.lookup(name)?.types);
    }

    /** An element or field write: the name keeps its kind but loses its type. */
    private write(name: string, node: AstNode): void {
        const slot = this.lookup(name);
        if (slot === undefined) {
            this.bind(name, 'assignment', node);
            return;
        }
        slot.writes.push(site(node));
        slot.writeDepths.add(this.loopDepth);
    }

    /**
     * Reads are settled after the walk. A loop body commonly reads a name that
     * the source binds further down, and resolving on the spot would report it
     * as unknown, so each unmatched read keeps the scopes it could see.
     */
    private read(name: string, node: AstNode): void {
        this.pending.push({
            name, at: site(node), chain: [...this.scopes], depth: this.loopDepth,
        });
    }

    private settleReads(): void {
        for (const read of this.pending) {
            const slot = resolve(read.name, read.chain);
            if (slot === undefined) {
                const sites = this.free.get(read.name) ?? [];
                sites.push(read.at);
                this.free.set(read.name, sites);
                continue;
            }
            slot.reads.push(read.at);
            slot.readDepths.add(read.depth);
        }
    }

    /** The nearest binding: a nested function reads the one that encloses it. */
    private lookup(name: string): Slot | undefined {
        return resolve(name, this.scopes);
    }
}

/**
 * The nearest binding for a name, innermost scope first. A qualified name
 * belongs to the module alias in front of the dot.
 */
function resolve(name: string, chain: readonly ScopeState[]): Slot | undefined {
    for (let depth = chain.length - 1; depth >= 0; depth -= 1) {
        const slot = chain[depth].slots.get(name);
        if (slot !== undefined) return slot;
    }
    const dot = name.indexOf('.');
    return dot > 0 ? resolve(name.slice(0, dot), chain) : undefined;
}

/** An application chain as the flat operand list the runtime works with. */
function flatten(expression: Expression): Expression[] {
    const parts: Expression[] = [];
    let current: Expression | undefined = expression;
    while (current !== undefined && isApplicationExpression(current)) {
        parts.unshift(...current.arguments);
        current = current.head;
    }
    if (current !== undefined) parts.unshift(current);
    return parts;
}

/** The names `for A B in Values` binds, or undefined when the left side is not a list. */
function loopNames(left: Expression): string[] | undefined {
    const parts = flatten(left);
    if (parts.length === 0) return undefined;
    const names: string[] = [];
    for (const part of parts) {
        if (isNameExpression(part)) names.push(part.name);
        else if (part.$type === 'AllAxisExpression') names.push('#');
        else return undefined;
    }
    return names.filter(name => name !== '#');
}

function finish(scope: ScopeState): ScopeFacts {
    const bindings = [...scope.slots.values()].map(slot => ({
        name: slot.name,
        kind: slot.kind,
        bound: slot.bound,
        writes: slot.writes,
        reads: slot.reads,
        reassigned: slot.writes.length > 1,
        unused: slot.reads.length === 0,
        // A name written and read at the same loop depth carries across turns.
        loopCarried: [...slot.writeDepths].some(depth =>
            depth > 0 && slot.readDepths.has(depth)),
        shadows: slot.shadows,
        types: slot.types,
    }));
    return { kind: scope.kind, name: scope.name, at: scope.at, bindings };
}
