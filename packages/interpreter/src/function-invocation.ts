import type { AstNode } from 'langium';
import {
    availableBuiltin, builtinBindingMessage, declaredRanks, flatArrayBorrowProofs, functionEffects, isReturnStatement,
    type Expression, type FunctionStatement, type Statement, type ValueFacts,
} from '@arrrank/language';
import { enterRuntime, isFlatScalarArray, isSharedArray, leaveRuntime } from './array-storage.js';
import type { BindingEnvironment } from './binding-environment.js';
import type { CompiledBlock } from './block-compiler.js';
import { ReturnSignal, TailCallSignal } from './control-signals.js';
import type { DebugInspection } from './debug-inspection.js';
import { RankError } from './errors.js';
import { ExecutionStack, completed, mapResult, resume, runExecution, type Evaluation, type Execution } from './execution.js';
import { LocalFrame } from './frame.js';
import type { InterpreterOptions } from './interpreter-options.js';
import { checkpoint, inspectionEnabled } from './interrupt.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { prepareFunction } from './prepared-function.js';
import type { ResourceOwnership } from './resource-ownership.js';
import { ReturnContract, argumentRankSignature, argumentSignature } from './return-contract.js';
import { compileScalarFunction } from './scalar-function-kernel.js';
import { sequence } from './sequence.js';
import type { ExecutionContext } from './statement-control.js';
import {
    formatValue, isNativeFunction, isRankDate, isRankLabel, typeName,
    type NativeFunction, type RankFile, type RankSequence, type RankValue,
} from './value.js';

/** A user function as its call sites see it. `owner` tells this interpreter's functions from a module child's. */
export interface FunctionDefinition {
    readonly specialization: (arguments_: RankValue[]) => ReturnContract;
    readonly owner: FunctionInvocation;
    readonly statement: FunctionStatement;
    readonly context: LocalFrame | undefined;
    readonly direct: (() => RankValue) | undefined;
}

/** What defining and running a function body needs from execution and the fast-path owner. */
export interface FunctionHost {
    /** A synchronous closure for an expression that cannot call Rank code, when one exists. */
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** A compiled body for these argument types, when the block compiler accepts it. */
    compiled(statement: FunctionStatement, arguments_: RankValue[]): CompiledBlock<ExecutionContext> | undefined;
    /** Runs statements as a function body, or as a generator body that may yield. */
    execute(statements: Statement[], generator: boolean): Evaluation<RankValue | undefined>;
    locate(error: unknown, node: AstNode): unknown;
    /** A proven scalar body that integer arguments may enter directly, when that path is enabled. */
    scalarEntry(statement: FunctionStatement, generator: boolean): { readonly locals: readonly string[] } | undefined;
    /** Offers a function to flat combinators; `available` is checked before each use. */
    flatCombine(fn: NativeFunction, statement: FunctionStatement, available: (builtins: ReadonlySet<string>) => boolean): void;
}

interface BorrowProof {
    readonly bindings: ReadonlyMap<string, RankValue | undefined>;
    readonly candidates: ReadonlyMap<number, ReadonlyMap<number, 'bigint' | 'boolean' | 'flat-array'>>;
}

// Functions are values that outlive the interpreter that made them, so their
// definitions are found from the function object rather than from a scope.
const functionExecutions = new WeakMap<NativeFunction, (arguments_: RankValue[]) => Evaluation<RankValue>>();
const functionDefinitions = new WeakMap<NativeFunction, FunctionDefinition>();

/**
 * Defining and calling user functions: closures over their defining frame,
 * return contracts, memo caches, tail calls, generators and the call depth
 * limit. A call runs its body in a fresh frame linked to the definition's
 * environment, inside its own resource scope.
 */
export class FunctionInvocation {
    readonly maxDepth: number;
    private depth = 0;
    private readonly sources = new WeakMap<NativeFunction, FunctionStatement>();
    private readonly globalBorrowProofs = new WeakMap<FunctionStatement, BorrowProof>();
    private readonly localBorrowProofs = new WeakMap<LocalFrame, WeakMap<FunctionStatement, BorrowProof>>();

    constructor(
        private readonly bindings: BindingEnvironment,
        private readonly resources: ResourceOwnership,
        private readonly builtins: BuiltinRegistry,
        private readonly inspection: DebugInspection,
        private readonly modules: ReadonlySet<string>,
        private readonly options: () => InterpreterOptions,
        private readonly host: FunctionHost,
    ) {
        this.maxDepth = options().maxCallDepth ?? 200_000;
        if (!Number.isSafeInteger(this.maxDepth) || this.maxDepth < 1) {
            throw new RankError('maxCallDepth must be a positive safe integer');
        }
    }

    /** Calls a function, through its Rank body when it has one so the call can suspend. */
    invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue> {
        const execution = functionExecutions.get(fn);
        return execution ? execution(arguments_) : completed(fn.call(arguments_));
    }

    /** A call in tail position to one of this interpreter's own functions unwinds to the active call. */
    throwTailCall(fn: NativeFunction, arguments_: RankValue[]): void {
        const definition = functionDefinitions.get(fn);
        if (definition?.owner === this) throw new TailCallSignal(definition, arguments_);
    }

    definitionOf(fn: NativeFunction): FunctionDefinition | undefined {
        return functionDefinitions.get(fn);
    }

    /** The declaration behind a function value, for diagnostics and previews. */
    sourceOf(fn: NativeFunction): FunctionStatement | undefined {
        return this.sources.get(fn);
    }

    adoptSource(fn: NativeFunction, statement: FunctionStatement): void {
        this.sources.set(fn, statement);
    }

    /** Binds a function declaration in the current scope; the definition captures that scope. */
    define(statement: FunctionStatement): RankValue {
        if (availableBuiltin(statement.name, this.modules)) {
            throw new RankError(builtinBindingMessage(statement.name), 'TypeError');
        }
        const { generator } = prepareFunction(statement);
        if (statement.memo && generator) throw new RankError('memo functions cannot yield');
        const context = this.bindings.current;
        const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
        const compiled = !inspectionEnabled() && only && isReturnStatement(only) && only.value
            ? this.host.compileDirect(only.value) : undefined;
        const direct = compiled ? () => {
            try { return compiled(); }
            catch (error) { throw this.host.locate(error, only!); }
        } : undefined;
        const proof = this.host.scalarEntry(statement, generator);
        const scalar = proof ? this.prepareScalarCall(statement) : undefined;
        const instances = new Map<string, ReturnContract>();
        const returnRanks = new Map<string, { rank?: number }>();
        const specialization = (arguments_: RankValue[]): ReturnContract => {
            const key = argumentSignature(arguments_);
            let instance = instances.get(key);
            if (!instance) {
                prepareFunction(statement, key);
                const rankKey = argumentRankSignature(arguments_);
                let rank = returnRanks.get(rankKey);
                if (!rank) returnRanks.set(rankKey, rank = {});
                instances.set(key, instance = new ReturnContract(statement.name, rank));
            }
            return instance;
        };
        const body = (arguments_: RankValue[]): Evaluation<RankValue> => {
            if (scalar && arguments_.length === statement.parameters.length
                && arguments_.every(value => typeof value === 'bigint')
                && !proof!.locals.some(name => context?.find(name))) {
                return completed(scalar(arguments_));
            }
            return direct ? completed(this.callDirectFunction(statement, arguments_, context, direct))
                : this.callFunction(statement, arguments_, context);
        };
        const checkedBody = (arguments_: RankValue[]): Evaluation<RankValue> => {
            const contract = specialization(arguments_);
            return mapResult(body(arguments_), value => {
                try { return contract.check(value); }
                catch (error) {
                    if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                    throw this.host.locate(error, statement);
                }
            });
        };
        // Only successful, validated returns enter the closure's memo cache.
        const cache = statement.memo ? new Map<string, RankValue>() : undefined;
        const execute = cache ? (arguments_: RankValue[]): Evaluation<RankValue> => {
            const key = JSON.stringify(arguments_.map(memoScalarKey));
            const cached = cache.get(key);
            if (cached !== undefined) return completed(cached);
            return mapResult(checkedBody(arguments_), value => {
                memoScalarKey(value);
                cache.set(key, value);
                return value;
            });
        } : checkedBody;
        const declared = declaredRanks(statement);
        if (typeof declared === 'string') throw this.host.locate(new RankError(declared, 'TypeError'), statement);
        const fn: NativeFunction = {
            kind: 'function',
            name: statement.name,
            arities: [statement.parameters.length],
            monadicRank: declared?.ranks.length === 1 ? declared.ranks[0] : 'all',
            arrayCells: declared ? true : undefined,
            monadicResultShape: generator ? undefined
                : cellShape => this.userResultCellShape(statement, context, returnRanks, cellShape),
            dyadicRanks: statement.parameters.length === 2
                ? declared?.ranks.length === 2 ? [declared.ranks[0], declared.ranks[1]] : ['all', 'all']
                : undefined,
            captures: context?.captures(),
            // What a caller outside the runtime reaches. A Rank call made from a
            // Rank body takes a shorter path, so the stretch this opens is the
            // work our embedder asked for; readers over storage we cannot track
            // keep their cells for exactly that long. See enterRuntime.
            call: arguments_ => {
                enterRuntime();
                try {
                    return generator
                        ? this.callGeneratorFunction(statement, arguments_, context)
                        : runExecution(execute(arguments_));
                } finally { leaveRuntime(); }
            },
        };
        this.sources.set(fn, statement);
        if (!generator) {
            functionExecutions.set(fn, execute);
            // A memo call must return through its cache writer. Do not bypass it
            // via the tail-call path that enters an ordinary function body.
            if (!statement.memo) functionDefinitions.set(fn, { owner: this, statement, context, direct, specialization });
        }
        if (!generator && !statement.memo) {
            this.host.flatCombine(fn, statement, builtins => {
                if (this.depth >= this.maxDepth) return false;
                for (const name of builtins) {
                    // Rank locals cannot hide core names; only host-injected globals need a guard.
                    const bound = this.bindings.globals.get(name);
                    if (bound !== undefined) {
                        if (!this.builtins.is('core', name, bound)) return false;
                    }
                }
                return true;
            });
        }
        this.bindings.assign(statement.name, fn);
        return fn;
    }

    /**
     * The result cell shape of a user function over an empty frame, found
     * without calling it: its body may print or loop. Static result facts for
     * an integer cell of that shape come first, then a return rank that earlier
     * calls settled. Lengths the facts leave open are zero.
     */
    private userResultCellShape(
        statement: FunctionStatement,
        context: LocalFrame | undefined,
        returnRanks: ReadonlyMap<string, { rank?: number }>,
        cellShape: readonly number[],
    ): readonly number[] | undefined {
        const valueOf = (name: string) => context?.lookup(name) ?? this.bindings.globals.get(name);
        const functionValue = (name: string) => {
            const value = valueOf(name);
            return value !== undefined && isNativeFunction(value) ? value : undefined;
        };
        const cell: ValueFacts = cellShape.length === 0
            ? { types: ['integer'], rank: 0, shape: [] }
            : { types: ['array'], rank: cellShape.length, shape: cellShape,
                elements: ['integer'], eagerScalarCells: true };
        const result = functionEffects(
            name => name === statement.name ? statement : this.sources.get(functionValue(name)!),
            name => functionValue(name) !== undefined,
            name => valueOf(name) !== undefined,
        )(statement.name, [cell]).result;
        // Like a called cell, a non-array result leaves only the frame.
        if (result?.types.length && !result.types.some(type => ['array', 'bytes'].includes(type))) return [];
        if (result?.types.join() === 'array' && result.shape?.length === result.rank) {
            return result.shape!.map(dimension => dimension ?? 0);
        }
        const settled = new Set<number>();
        for (const [key, contract] of returnRanks) {
            const [argument, ...rest] = JSON.parse(key) as [string, number, unknown][];
            if (rest.length || contract.rank === undefined || argument[1] !== cellShape.length
                || cellShape.length > 0 && argument[0] !== 'array') continue;
            settled.add(contract.rank);
        }
        return settled.size === 1 ? Array<number>([...settled][0]).fill(0) : undefined;
    }

    /** A proven scalar body compiled to a direct call, counted against the call depth. */
    prepareScalarCall(statement: FunctionStatement): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined {
        if (this.options().scalarFunctionCompilation === false) return undefined;
        const kernel = compileScalarFunction(statement);
        if (!kernel) return undefined;
        const locate = (error: unknown, index: number) => this.host.locate(error, kernel.locations[index] ?? statement);
        return (arguments_, tail = false) => {
            if (!tail && this.depth >= this.maxDepth) {
                throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
            }
            if (!tail) this.depth += 1;
            try {
                this.options().onScalarFunctionExecuted?.();
                return kernel.run(arguments_, locate);
            } catch (error) {
                if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                throw error;
            } finally { if (!tail) this.depth -= 1; }
        };
    }

    private functionFrame(
        statement: FunctionStatement,
        arguments_: RankValue[],
        parent: LocalFrame | undefined,
        reusable?: LocalFrame,
    ): LocalFrame {
        if (arguments_.length !== statement.parameters.length) {
            throw new RankError(
                `${statement.name} expects ${statement.parameters.length} arguments, got ${arguments_.length}`,
            );
        }
        const prepared = prepareFunction(statement, argumentSignature(arguments_));
        const frame = reusable?.reset() ? reusable
            : new LocalFrame(parent, prepared.layout);
        const candidates = arguments_.some((argument, index) => isFlatScalarArray(argument) && !isSharedArray(argument)
            && !prepared.borrowedParameters.has(statement.parameters[index]))
            ? this.borrowCandidates(statement, parent) : undefined;
        statement.parameters.forEach((parameter, index) => {
            const argument = arguments_[index];
            const guards = candidates?.get(index);
            const borrowed = isFlatScalarArray(argument)
                && (prepared.borrowedParameters.has(parameter)
                    || !!guards && [...guards].every(([selector, type]) => type === 'flat-array'
                        ? isFlatScalarArray(arguments_[selector]) : typeof arguments_[selector] === type));
            frame.define(parameter, argument, new Set([typeName(argument)]), borrowed);
        });
        return frame;
    }

    private borrowCandidates(statement: FunctionStatement, parent: LocalFrame | undefined): ReadonlyMap<number, ReadonlyMap<number, 'bigint' | 'boolean' | 'flat-array'>> {
        const cache = parent ? this.localBorrowProofs.get(parent) : this.globalBorrowProofs;
        const current = cache?.get(statement);
        const lookup = (name: string) => parent?.lookup(name) ?? this.bindings.globals.get(name);
        if (current && [...current.bindings].every(([name, value]) => lookup(name) === value)) {
            return current.candidates;
        }
        const bindings = new Map<string, RankValue | undefined>();
        const candidates = flatArrayBorrowProofs(statement, name => {
            // These names bypass ordinary variable lookup in resolve().
            if (name.includes('.') || name === 'index' || name === 'queue'
                || name === 'set' || name === 'counter') return undefined;
            const bound = lookup(name);
            bindings.set(name, bound);
            const helper = bound && isNativeFunction(bound) ? functionDefinitions.get(bound) : undefined;
            return helper?.owner === this && helper.context === parent ? helper.statement : undefined;
        }, name => {
            const bound = lookup(name);
            bindings.set(name, bound);
            return this.builtins.is('core', name, bound ?? this.builtins.lookup(name)!);
        });
        const proof = { bindings, candidates };
        if (parent) {
            const local = cache ?? new WeakMap<FunctionStatement, BorrowProof>();
            local.set(statement, proof);
            if (!cache) this.localBorrowProofs.set(parent, local);
        } else this.globalBorrowProofs.set(statement, proof);
        return candidates;
    }

    // A single return whose expression contains no applications cannot make a
    // direct Rank call. It needs a lexical/resource frame, but no suspended task.
    private callDirectFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
        direct: () => RankValue,
    ): RankValue {
        if (this.depth >= this.maxDepth) {
            throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
        }
        const frame = this.functionFrame(statement, arguments_, context);
        this.depth += 1;
        return this.resources.withResourceScope(() => {
            try {
                return this.bindings.withFrame(frame, direct);
            } catch (error) {
                if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                throw error;
            } finally {
                this.depth -= 1;
            }
        });
    }

    private *callFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
    ): Execution<RankValue> {
        if (this.depth >= this.maxDepth) {
            throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
        }
        let frame = this.functionFrame(statement, arguments_, context);
        const callerStatement = this.inspection.statement;
        const caller = this.bindings.current;
        const scope = new Set<RankFile>();
        this.resources.pushScope(scope);
        this.bindings.current = frame;
        this.depth += 1;
        if (inspectionEnabled()) this.inspection.enter(statement.name, frame);
        let result: RankValue | undefined;
        let pending: unknown;
        let compiledTail = false;
        const tailContracts = new Set<ReturnContract>();
        try {
            while (true) {
                checkpoint();
                try {
                    this.bindings.current = frame;
                    if (inspectionEnabled()) this.inspection.replace(statement.name, frame);
                    for (const local of prepareFunction(statement, argumentSignature(arguments_)).locals) this.define(local);
                    const body = this.host.compiled(statement, arguments_);
                    if (body) {
                        result = yield* resume(body({ assertBooleanExpressions: false, insideLoop: false,
                            insideFinally: false, insideGenerator: false }));
                        break;
                    }
                    yield* resume(this.host.execute(statement.statements, false));
                    throw new RankError(`function ${statement.name} reached end without return`);
                } catch (error) {
                    if (error instanceof TailCallSignal) {
                        tailContracts.add(error.definition.specialization(error.arguments_));
                        if (error.compiled) {
                            compiledTail = true;
                            // Keep the tail driver's logical depth and resource scope;
                            // this proven scalar body needs no new lexical frame.
                            try { result = error.compiled(error.arguments_, true); }
                            catch (error) { pending = error; }
                            break;
                        }
                        const reusable = statement === error.definition.statement
                            && frame.parent === error.definition.context ? frame : undefined;
                        statement = error.definition.statement;
                        arguments_ = error.arguments_;
                        frame = this.functionFrame(statement, error.arguments_, error.definition.context, reusable);
                        if (error.definition.direct) {
                            this.bindings.current = frame;
                            try {
                                result = error.definition.direct();
                            } catch (error) {
                                pending = error;
                            }
                            break;
                        }
                        continue;
                    }
                    if (error instanceof ReturnSignal && error.value !== undefined) result = error.value;
                    else pending = error;
                    break;
                }
            }
        } finally {
            this.depth -= 1;
            this.bindings.current = caller;
            if (inspectionEnabled()) this.inspection.leave(callerStatement);
            if (pending instanceof RankError && !compiledTail) pending.addCall(statement.name, statement.parameters, arguments_);
            if (pending === undefined && result !== undefined) {
                try { for (const contract of tailContracts) result = contract.check(result); }
                catch (error) { pending = error; }
            }
            this.resources.finishResourceScope(scope, result, pending);
        }
        return result!;
    }

    private callGeneratorFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
    ): RankSequence {
        const frame = this.functionFrame(statement, arguments_, context);
        const invocation = this;
        let consumed = false;

        this.bindings.withFrame(frame, () => {
            for (const local of prepareFunction(statement, argumentSignature(arguments_)).locals) this.define(local);
        });

        return this.singlePass({
            name: statement.name,
            size: { kind: 'unknown' },
            captures: frame.captures(),
            *iterate() {
                if (consumed) {
                    throw new RankError(
                        `generator sequence ${statement.name} has already been consumed`,
                        'ConsumedSequence',
                    );
                }
                consumed = true;

                const resources = new Set<RankFile>();
                invocation.resources.addGeneratorScope(resources);
                const execution = new ExecutionStack((function* (): Execution<RankValue | undefined> {
                    return yield* resume(invocation.host.execute(statement.statements, true));
                })());
                try {
                    while (true) {
                        let next: IteratorResult<RankValue, RankValue | undefined>;
                        try {
                            next = invocation.withGeneratorFrame(
                                frame,
                                resources,
                                () => {
                                    if (!inspectionEnabled()) return execution.next();
                                    const callerStatement = invocation.inspection.statement;
                                    invocation.inspection.enter(statement.name, frame);
                                    try { return execution.next(); }
                                    finally { invocation.inspection.leave(callerStatement); }
                                },
                            );
                        } catch (error) {
                            if (error instanceof ReturnSignal && error.value === undefined) return;
                            if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                            throw error;
                        }
                        if (next.done) return;
                        yield next.value;
                    }
                } finally {
                    try {
                        invocation.withGeneratorFrame(
                            frame,
                            resources,
                            () => {
                                let result = execution.return(undefined);
                                while (!result.done) result = execution.next();
                            },
                        );
                    } finally {
                        invocation.resources.deleteGeneratorScope(resources);
                        invocation.resources.closeResources(resources, new Set());
                    }
                }
            },
        });
    }

    private withGeneratorFrame<T>(
        frame: LocalFrame,
        resources: Set<RankFile>,
        operation: () => T,
    ): T {
        this.resources.pushScope(resources);
        try {
            return this.bindings.withFrame(frame, operation);
        } finally {
            this.resources.popScope();
        }
    }

    private singlePass(plan: RankSequence['plan']): RankSequence {
        const source = sequence({ ...plan, singlePass: true });
        return this.options().wrapSinglePassSequence?.(source) ?? source;
    }
}

function memoScalarKey(value: RankValue): string {
    if (typeof value === 'number' && Object.is(value, -0)) return 'number:-0';
    if (typeof value !== 'object') return `${typeof value}:${value}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    if (isRankDate(value)) return `${value.kind}:${formatValue(value)}`;
    throw new RankError('memo arguments and results must be scalar values');
}
