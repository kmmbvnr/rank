import {
    ExecutionStack, completed, emit, flatMapResult, mapExecution, mapPair, mapResult, normalizeStackError,
    resume, runExecution, type Evaluation, type Execution,
} from './execution.js';
import { LocalFrame } from './frame.js';
import { addToCollection, expectAddCollection, newStructure, removeFromCollection } from './collections.js';
import { RankDeque, RankHeap, pushCollection } from './containers.js';
import { prepareFunction } from './prepared-function.js';
import { isKnownFileFree, ResourceMap } from './resource-summary.js';
import { numericKernel } from './numeric-kernels.js';
import { compileFusedReduction, compileFusedSum } from './fused-reduction.js';
import {
    isAddStatement,
    isAllAxisExpression,
    isArrayAssignmentStatement,
    isArrayExpression,
    isArgsStatement,
    isArgumentStatement,
    isApplicationExpression,
    isAssignmentStatement,
    isBinaryExpression,
    isBooleanLiteral,
    isBreakStatement,
    isContinueStatement,
    isExpressionStatement,
    isFlagStatement,
    isForStatement,
    isFunctionStatement,
    isIfStatement,
    isIndexAssignmentStatement,
    isLabelLiteral,
    isMaterializeExpression,
    isNameExpression,
    isNewStructureExpression,
    isNumberLiteral,
    isOptionStatement,
    isParenthesizedExpression,
    isPushStatement,
    isRecordExpression,
    isRunStatement,
    isReturnStatement,
    isKeyedSortExpression,
    isStdinExpression,
    isStringLiteral,
    isTestStatement,
    isTryStatement,
    isUnaryExpression,
    isUnpackStatement,
    isUseStatement,
    isYieldStatement,
    type AddressItem,
    type ArrayExpression,
    type ArrayItem,
    type Expression,
    type FunctionStatement,
    type Program,
    type Statement,
} from 'rank-language';
import { MissingValueError, RankError } from './errors.js';
import { expectFenwick } from './fenwick.js';
import { graphConstructor } from './graph.js';
import { indexKey } from './index-key.js';
import type { RankInput, RankIo } from './io.js';
import { expectMultiset } from './multiset.js';
import { standardModules } from './modules/index.js';
import type { RuntimeModule } from './modules/types.js';
import { mapBroadcastArrays } from './tensor.js';
import { closeFile } from './modules/io.js';
import { matmulValues } from './modules/linalg.js';
import { roundValue, sumIndexed } from './modules/numbers.js';
import { formattedText } from './modules/text.js';
import { randomFromSeed, shuffleValue } from './modules/random.js';
import { compareOrderedValues, orderedKind } from './ordered.js';
import {
    argsortAxis,
    lengthOfAxis,
    sortByItems,
    sortByKeys,
    transposeValue,
} from './modules/sequences.js';
import { covarianceValue, errorMetricValue } from './modules/stats.js';
import { projectField } from './modules/tables.js';
import { parse } from './parser.js';
import { setValueKey } from './set.js';
import {
    atSequence,
    boundSequence,
    filterSequence,
    mapSequence,
    materializeSequence,
    sequence,
    sequenceMask,
    sequenceValues,
    windowValue,
    zipSequences,
} from './sequence.js';
import {
    formatValue,
    isNativeFunction,
    isRankArray,
    isRankCounter,
    isRankErrorValue,
    isRankFenwick,
    isRankFile,
    isRankGraph,
    isRankIndex,
    isRankLabel,
    isRankMultiset,
    isRankObject,
    isRankQueue,
    isRankRecord,
    isRankSet,
    isRankSequence,
    isRankSequenceMask,
    type IntrinsicRank,
    type RankArray,
    type RankCounter,
    type RankFile,
    type NativeFunction,
    type RankIndex,
    type RankQueue,
    type RankRecord,
    type RankSet,
    type RankSequence,
    type RankValue,
    type SequencePredicate,
} from './value.js';

type Output = (text: string) => void;

const ALL_AXIS = { kind: 'label', name: '#' } as const;

export interface LoadedModule {
    readonly id: string;
    readonly source: string;
}

export interface InterpreterOptions {
    readonly args?: readonly string[];
    readonly sourceId?: string;
    readonly testing?: boolean;
    readonly input?: RankInput;
    readonly io?: RankIo;
    readonly random?: () => number;
    readonly persistentResources?: boolean;
    readonly maxCallDepth?: number;
    readonly loadModule?: (specifier: string, fromId?: string) => LoadedModule;
}

export interface RankTestResult {
    readonly name: string;
    readonly passed: boolean;
    readonly output: readonly string[];
    readonly error?: string;
}

interface LoadedProgram {
    readonly id: string;
    readonly program: Program;
}

interface ExecutionContext {
    readonly assertBooleanExpressions: boolean;
    readonly insideLoop: boolean;
    readonly insideFinally: boolean;
    readonly insideGenerator: boolean;
    readonly tailCallsAllowed?: false;
}

type PreparedStatement =
    | { readonly run: (context: ExecutionContext) => RankValue | undefined }
    | { readonly stream: (context: ExecutionContext) => Evaluation<RankValue | undefined> };

const functionExecutions = new WeakMap<NativeFunction, (arguments_: RankValue[]) => Evaluation<RankValue>>();
const sourceIds = new WeakMap<object, string>();
interface FunctionDefinition {
    readonly interpreter: Interpreter;
    readonly statement: FunctionStatement;
    readonly context: LocalFrame | undefined;
    readonly direct: (() => RankValue) | undefined;
}
const functionDefinitions = new WeakMap<NativeFunction, FunctionDefinition>();

class TailCallSignal {
    constructor(readonly definition: FunctionDefinition, readonly arguments_: RankValue[]) {}
}
const SEED_RANDOM = Symbol('seedRandom');

type SeedableRandom = (() => number) & {
    readonly [SEED_RANDOM]: (seed: bigint) => void;
};

class ReturnSignal {
    constructor(readonly value?: RankValue) {}
}

class BreakSignal {}
class ContinueSignal {}

const raiseFunction: NativeFunction = {
    kind: 'function',
    name: 'raise',
    arities: [1, 2],
    monadicRank: 'all',
    call(arguments_) {
        const first = arguments_[0];
        if (arguments_.length === 1 && isRankErrorValue(first)) {
            if (first.source instanceof RankError) throw first.source;
            throw new RankError(first.message, first.errorKind.name, first.value);
        }
        if (!isRankLabel(first)) {
            throw new RankError('raise expects an error or a label followed by an optional value');
        }
        const value = arguments_[1];
        const message = value === undefined
            ? `.${first.name}`
            : typeof value === 'string'
                ? value
                : `.${first.name}: ${formatValue(value)}`;
        throw new RankError(message, first.name, value);
    },
};

const typeFunction: NativeFunction = {
    kind: 'function',
    name: 'type',
    arities: [1],
    monadicRank: 'all',
    call: arguments_ => ({ kind: 'label', name: typeName(arguments_[0]) }),
};

export class Interpreter {
    readonly variables = new Map<string, RankValue>();
    readonly modules = new Set<string>();
    readonly testResults: RankTestResult[] = [];
    private readonly output: Output;
    private readonly options: InterpreterOptions;
    private readonly random: SeedableRandom;
    private readonly openPrograms = new Map<string, LoadedProgram>();
    private readonly aliases = new Map<string, Interpreter>();
    private currentRunTarget: LoadedProgram | undefined;
    private pendingArgs: string[] | undefined;
    private loadedProgram: LoadedProgram | undefined;
    private readonly statements = new WeakMap<Statement, PreparedStatement>();
    private readonly expressions = new WeakMap<Expression, () => Evaluation<RankValue>>();
    private readonly standardFunctions = new Map<RuntimeModule[string], NativeFunction>();
    private localFrame: LocalFrame | undefined;
    private readonly variableTypes = new Map<string, ReadonlySet<string>>();
    private readonly resourceScopes: Set<RankFile>[] = [];
    private readonly generatorResourceScopes = new Set<Set<RankFile>>();
    private callDepth = 0;
    private readonly maxCallDepth: number;

    constructor(output: Output = console.log, options: InterpreterOptions = {}) {
        this.output = output;
        this.options = options;
        this.random = seedableRandom(options.random);
        this.maxCallDepth = options.maxCallDepth ?? 200_000;
        if (!Number.isSafeInteger(this.maxCallDepth) || this.maxCallDepth < 1) {
            throw new RankError('maxCallDepth must be a positive safe integer');
        }
    }

    execute(source: string): RankValue | undefined {
        const program = parse(source, this.options.sourceId);
        if (program.$cstNode) sourceIds.set(program.$cstNode.root, this.options.sourceId ?? '<input>');
        this.loadedProgram = {
            id: this.options.sourceId ?? '<input>',
            program,
        };
        if (this.options.persistentResources) {
            if (this.resourceScopes.length === 0) this.resourceScopes.push(new Set());
            return this.executeProgram(program, this.options.args ?? []);
        }
        return this.withResourceScope(
            () => this.executeProgram(program, this.options.args ?? []),
            false,
        );
    }

    dispose(): void {
        for (const child of this.aliases.values()) child.dispose();
        for (const scope of this.generatorResourceScopes) {
            this.closeResources(scope, new Set());
        }
        this.generatorResourceScopes.clear();
        while (this.resourceScopes.length > 0) {
            this.closeResources(this.resourceScopes.pop()!, new Set());
        }
    }

    private withResourceScope<T extends RankValue | undefined>(
        operation: () => T,
        transferResult = true,
    ): T {
        const scope = new Set<RankFile>();
        this.resourceScopes.push(scope);
        let result: T | undefined;
        let pending: unknown;
        try {
            result = operation();
        } catch (error) {
            pending = normalizeStackError(error);
        }

        return this.finishResourceScope(scope, result, pending, transferResult) as T;
    }

    private finishResourceScope(
        scope: Set<RankFile>,
        result: RankValue | undefined,
        pending: unknown,
        transferResult = true,
    ): RankValue | undefined {
        // Resource-free containers need no deep escape scan, just like scalars.
        // Keep the scope itself: nested calls must still transfer files here.
        if (scope.size === 0 && isKnownFileFree(result)) {
            this.resourceScopes.pop();
            if (pending !== undefined) throw pending;
            return result;
        }

        let escaped = new Set<RankFile>();
        if (pending === undefined && transferResult) {
            try {
                escaped = containedFiles(result);
            } catch (error) {
                pending = normalizeStackError(error);
            }
        }
        this.resourceScopes.pop();

        let closeError: unknown;
        try {
            this.closeResources(scope, escaped);
        } catch (error) {
            closeError = error;
        }
        if (transferResult) {
            for (const file of escaped) this.ownFile(file);
        }
        if (pending !== undefined) throw pending;
        if (closeError !== undefined) throw closeError;
        return result;
    }

    private ownFile(file: RankFile): void {
        let scope = this.resourceScopes.at(-1);
        if (!scope) {
            scope = new Set();
            this.resourceScopes.push(scope);
        }
        scope.add(file);
    }

    private withLexicalFrame<T>(
        frame: LocalFrame,
        operation: () => T,
    ): T {
        const caller = this.localFrame;
        this.localFrame = frame;
        try {
            return operation();
        } finally {
            this.localFrame = caller;
        }
    }

    private withGeneratorFrame<T>(
        frame: LocalFrame,
        resources: Set<RankFile>,
        operation: () => T,
    ): T {
        this.resourceScopes.push(resources);
        try {
            return this.withLexicalFrame(frame, operation);
        } finally {
            this.resourceScopes.pop();
        }
    }

    private ownFiles(value: RankValue | undefined): void {
        if (isKnownFileFree(value)) return;
        for (const file of containedFiles(value)) this.ownFile(file);
    }

    private closeResources(resources: Set<RankFile>, preserved: Set<RankFile>): void {
        let firstError: unknown;
        for (const file of [...resources].reverse()) {
            if (preserved.has(file)) continue;
            try {
                closeFile(file);
            } catch (error) {
                firstError ??= error;
            }
        }
        if (firstError !== undefined) throw firstError;
    }

    executeProgram(
        program: Program,
        args: readonly string[] = [],
        assertBooleanExpressions = false,
    ): RankValue | undefined {
        validateFunctionPlacement(program.statements, 'top');
        this.declareFunctions(program.statements);
        this.prepareInputs(program, args);
        return this.executeStatements(program.statements, assertBooleanExpressions);
    }

    private declareFunctions(statements: readonly Statement[]): void {
        for (const statement of statements) {
            if (isFunctionStatement(statement)) this.defineFunction(statement);
        }
    }

    private prepareModule(program: Program): void {
        validateFunctionPlacement(program.statements, 'top');
        this.declareFunctions(program.statements);
        for (const statement of program.statements) {
            if (!isUseStatement(statement)) continue;
            if (statement.path !== undefined) {
                this.useFile(statement.path, statement.alias);
            } else {
                this.useStandard(statement.module!);
            }
        }
    }

    private executeStatements(
        statements: Statement[],
        assertBooleanExpressions = false,
        insideLoop = false,
        insideFinally = false,
    ): RankValue | undefined {
        return runExecution(this.executeStatementStream(
            statements,
            assertBooleanExpressions,
            insideLoop,
            insideFinally,
            false,
        ));
    }

    private executeStatementStream(
        statements: Statement[],
        assertBooleanExpressions = false,
        insideLoop = false,
        insideFinally = false,
        insideGenerator = false,
        tailCallsAllowed = true,
    ): Evaluation<RankValue | undefined> {
        // Ordinary blocks keep their compact context; only protected blocks
        // need to carry the additional tail-call flag.
        const context: ExecutionContext = tailCallsAllowed
            ? { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator }
            : { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator, tailCallsAllowed: false };
        let result: RankValue | undefined;
        let index = 0;
        try {
            for (; index < statements.length; index += 1) {
                const prepared = this.preparedStatement(statements[index]);
                if ('run' in prepared) {
                    result = prepared.run(context);
                } else {
                    const task = prepared.stream(context);
                    if ('done' in task) result = task.value;
                    else return this.continueStatementStream(statements, index, context, task);
                }
            }
        } catch (error) {
            throw this.locateError(error, statements[index]);
        }
        return completed(result);
    }

    private preparedStatement(statement: Statement): PreparedStatement {
        let prepared = this.statements.get(statement);
        if (!prepared) {
            prepared = this.prepareStatement(statement);
            this.statements.set(statement, prepared);
        }
        return prepared;
    }

    private *continueStatementStream(
        statements: Statement[],
        index: number,
        context: ExecutionContext,
        first: Execution<RankValue | undefined>,
    ): Execution<RankValue | undefined> {
        try {
            let result = yield* resume(first);
            for (index += 1; index < statements.length; index += 1) {
                const prepared = this.preparedStatement(statements[index]);
                result = 'run' in prepared
                    ? prepared.run(context)
                    : yield* resume(prepared.stream(context));
            }
            return result;
        } catch (error) {
            throw this.locateError(error, statements[index]);
        }
    }

    private locateError(error: unknown, node: Statement | Expression): unknown {
        error = normalizeStackError(error);
        if (error instanceof RankError && !error.location && node.$cstNode) {
            const cst = node.$cstNode;
            const start = cst.range.start;
            error.location = {
                sourceId: sourceIds.get(cst.root) ?? this.options.sourceId ?? '<input>',
                line: start.line + 1,
                column: start.character + 1,
                sourceLine: cst.root.fullText.split(/\r?\n/)[start.line] ?? '',
            };
        }
        return error;
    }

    // Cache only syntax. Flags and workspaces belong to each execution, including
    // resumed generators. Prepare a statement only when control reaches it.
    private prepareStatement(statement: Statement): PreparedStatement {
        const interpreter = this;
        if (isUseStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                if (statement.path !== undefined) {
                    interpreter.useFile(statement.path, statement.alias);
                } else {
                    interpreter.useStandard(statement.module!);
                }
                return undefined;
            } };
        }
        if (isRunStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> { return interpreter.run(statement.path); } };
        }
        if (isArgsStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                interpreter.pendingArgs = (yield* resume(mapExecution(statement.values, value => interpreter.evaluateTask(value)))).map(formatValue);
                return undefined;
            } };
        }
        if (isOptionStatement(statement)
            || isArgumentStatement(statement)
            || isFlagStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> { return undefined; } };
        }
        if (isTestStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                interpreter.executeTest(statement.description, statement.statements);
                return undefined;
            } };
        }
        if (isFunctionStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> { return interpreter.defineFunction(statement); } };
        }
        if (isYieldStatement(statement)) {
            const interpreter = this;
            return { stream: function* (context) {
                const { insideGenerator } = context;
                if (!insideGenerator) {
                    throw new RankError('yield is only valid inside a generator function');
                }
                yield* resume(emit((yield* resume(interpreter.evaluateTask(statement.value)))));
                return undefined;
            } };
        }
        if (isReturnStatement(statement)) {
            const validate = (context: ExecutionContext): void => {
                const { insideFinally, insideGenerator } = context;
                if (insideFinally) {
                    throw new RankError('return is not valid inside finally');
                }
                if (interpreter.localFrame === undefined) {
                    throw new RankError('return is only valid inside a function');
                }
                if (insideGenerator && statement.value !== undefined) {
                    throw new RankError('a generator cannot return a value');
                }
                if (!insideGenerator && statement.value === undefined) {
                    throw new RankError('a value-returning function must return a value');
                }
            };
            const direct = statement.value && this.compileDirectExpression(statement.value);
            if (direct) {
                return { run: context => {
                    validate(context);
                    throw new ReturnSignal(direct());
                } };
            }
            let candidate = statement.value;
            while (candidate && isParenthesizedExpression(candidate)) candidate = candidate.value;
            const tailCandidate = candidate && isApplicationExpression(candidate);
            if (!tailCandidate) {
                return { stream: function* (context): Execution<RankValue | undefined> {
                    validate(context);
                    throw new ReturnSignal(statement.value === undefined ? undefined
                        : yield* resume(interpreter.evaluateTask(statement.value)));
                } };
            }
            let tail: (() => Evaluation<RankValue>) | undefined;
            return { stream: context => {
                validate(context);
                if (statement.value === undefined) throw new ReturnSignal();
                const result = context.tailCallsAllowed !== false
                    ? (tail ??= interpreter.compileExpression(statement.value, undefined, true))()
                    : interpreter.evaluateTask(statement.value);
                return mapResult(result, value => { throw new ReturnSignal(value); });
            } };
        }
        if (isBreakStatement(statement) || isContinueStatement(statement)) {
            const operation = isBreakStatement(statement) ? 'break' : 'continue';
            return { stream: function* (context): Execution<RankValue | undefined> {
                const { insideLoop, insideFinally } = context;
                if (insideFinally) {
                    throw new RankError(`${operation} is not valid inside finally`);
                }
                if (!insideLoop) {
                    throw new RankError(`${operation} is only valid inside a for loop`);
                }
                throw operation === 'break' ? new BreakSignal() : new ContinueSignal();
            } };
        }
        if (isTryStatement(statement)) {
            const interpreter = this;
            return { stream: function* (context) {
                const { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator } = context;
                let result: RankValue | undefined;
                let pending: unknown;
                try {
                    try {
                        try {
                            result = yield* resume(interpreter.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                insideLoop,
                                insideFinally,
                                insideGenerator,
                                false,
                            ));
                        } catch (error) {
                            if (!(error instanceof RankError)) throw error;
                            const clause = statement.catches.find(candidate =>
                                candidate.errorKind === undefined
                                || candidate.errorKind.name === error.rankKind);
                            if (!clause) throw error;
                            interpreter.assign(clause.errorName, error.toValue());
                            result = yield* resume(interpreter.executeStatementStream(
                                clause.statements,
                                assertBooleanExpressions,
                                insideLoop,
                                insideFinally,
                                insideGenerator,
                                false,
                            ));
                        }
                    } catch (error) {
                        pending = error;
                    }
                } finally {
                    try {
                        yield* resume(interpreter.executeStatementStream(
                            statement.finallyStatements,
                            assertBooleanExpressions,
                            insideLoop,
                            true,
                            insideGenerator,
                            false,
                        ));
                    } catch (error) {
                        if (error instanceof RankError && pending instanceof RankError) {
                            error.attachCause(pending);
                        }
                        pending = error;
                    }
                    if (pending !== undefined) throw pending;
                }
                return result;
            } };
        }
        if (isIfStatement(statement)) {
            const conditions = [statement.condition, ...statement.elifClauses.map(clause => clause.condition)]
                .map(condition => this.compileDirectExpression(condition));
            if (conditions.every(condition => condition !== undefined)) {
                return { stream: context => {
                    let branch = statement.elseStatements;
                    for (let index = 0; index < conditions.length; index += 1) {
                        if (expectBoolean(conditions[index]())) {
                            branch = index === 0 ? statement.thenStatements : statement.elifClauses[index - 1].statements;
                            break;
                        }
                    }
                    return this.executeStatementStream(
                        branch, context.assertBooleanExpressions, context.insideLoop,
                        context.insideFinally, context.insideGenerator,
                        context.tailCallsAllowed,
                    );
                } };
            }
            const interpreter = this;
            return { stream: function* (context) {
                const { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator } = context;
                let result: RankValue | undefined;
                let branch = statement.elseStatements;
                if (expectBoolean((yield* resume(interpreter.evaluateTask(statement.condition))))) {
                    branch = statement.thenStatements;
                } else {
                    for (const clause of statement.elifClauses) {
                        if (expectBoolean((yield* resume(interpreter.evaluateTask(clause.condition))))) {
                            branch = clause.statements;
                            break;
                        }
                    }
                }
                result = yield* resume(interpreter.executeStatementStream(
                    branch,
                    assertBooleanExpressions,
                    insideLoop,
                    insideFinally,
                    insideGenerator,
                    context.tailCallsAllowed,
                ));
                return result;
            } };
        }
        if (isForStatement(statement)) {
            const binding = forIteration(statement.condition);
            const condition = !binding && statement.condition
                ? this.compileDirectExpression(statement.condition) : undefined;
            const interpreter = this;
            return { stream: function* (context) {
                const { assertBooleanExpressions, insideFinally, insideGenerator } = context;
                let result: RankValue | undefined;
                if (binding) {
                    const spec = tensorIterationSpec(binding.iterable);
                    const iterable = (yield* resume(interpreter.evaluateTask(spec?.source ?? binding.iterable)));
                    for (const entry of interpreter.forEntries(binding, iterable)) {
                        if (binding.names[0] !== '#') {
                            interpreter.assign(binding.names[0], entry.value);
                        }
                        binding.names.slice(1).forEach((name, position) => {
                            if (name !== '#') {
                                interpreter.assign(name, entry.indices[position]);
                            }
                        });
                        try {
                            result = yield* resume(interpreter.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                true,
                                insideFinally,
                                insideGenerator,
                                false, // Returning must close this iterator after the callee finishes.
                            ));
                        } catch (error) {
                            if (error instanceof BreakSignal) break;
                            if (error instanceof ContinueSignal) continue;
                            throw error;
                        }
                    }
                } else {
                    while (!statement.condition
                        || expectBoolean(condition ? condition()
                            : yield* resume(interpreter.evaluateTask(statement.condition)))) {
                        try {
                            result = yield* resume(interpreter.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                true,
                                insideFinally,
                                insideGenerator,
                                context.tailCallsAllowed,
                            ));
                        } catch (error) {
                            if (error instanceof BreakSignal) break;
                            if (error instanceof ContinueSignal) continue;
                            throw error;
                        }
                    }
                }
                return result;
            } };
        }
        if (isPushStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                const receiver = (yield* resume(interpreter.evaluateTask(statement.receiver)));
                interpreter.requireModule('algo', 'push');
                pushCollection(receiver, (yield* resume(interpreter.evaluateTask(statement.value))));
                return undefined;
            } };
        }
        if (isAddStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                const value = (yield* resume(interpreter.evaluateTask(statement.value)));
                if (statement.structure.startsWith('counter')) {
                    addToCollection(interpreter.localCounter(), value);
                } else {
                    addToCollection(interpreter.localSet(), value);
                }
                return undefined;
            } };
        }
        if (isIndexAssignmentStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                const index = interpreter.localIndex();
                const keys = yield* resume(mapExecution(statement.keys, key => interpreter.evaluateTask(key)));
                index.entries.set(indexKey(keys), (yield* resume(interpreter.evaluateTask(statement.value))));
                return undefined;
            } };
        }
        if (isUnpackStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                const result = (yield* resume(interpreter.evaluateTask(statement.value)));
                if (!isRankArray(result) || result.shape.length !== 1) {
                    throw new RankError('unpack expects a rank-1 array value');
                }
                const unpacked = result;
                if (unpacked.items.length !== statement.names.length) {
                    throw new RankError(
                        `unpack expects ${statement.names.length} values, got ${unpacked.items.length}`,
                    );
                }
                statement.names.forEach((name, index) => {
                    if (name !== '#') interpreter.assign(name, unpacked.items[index]);
                });
                return result;
            } };
        }
        if (isArrayAssignmentStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                const target = interpreter.resolveVariable(statement.name);
                const selectors = yield* resume(mapExecution(statement.indices, index => interpreter.evaluateAddressItem(index)));
                if (isRankIndex(target)) {
                    const key = indexKey(selectors);
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    if (statement.operator === '=') target.entries.set(key, value);
                    else {
                        const previous = target.entries.get(key);
                        if (previous === undefined) throw new MissingValueError('index key not found');
                        target.entries.set(key, interpreter.evaluateBinary(
                            assignmentOperator(statement.operator), previous, value,
                        ));
                    }
                    return undefined;
                }
                if (isRankFenwick(target)) {
                    if (selectors.length !== 1 || typeof selectors[0] !== 'bigint') {
                        throw new RankError('fenwick assignment expects one integer index');
                    }
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    const result = statement.operator === '=' ? value : interpreter.evaluateBinary(
                        assignmentOperator(statement.operator), target.at(selectors[0]), value,
                    );
                    if (typeof result !== 'bigint') {
                        throw new RankError('fenwick values must be integers');
                    }
                    target.set(selectors[0], result);
                    return result;
                }
                const field = selectors.at(-1);
                if (field !== undefined && isRankLabel(field) && field.name !== '#') {
                    let receiver: RankValue = target;
                    for (const selector of selectors.slice(0, -1)) {
                        receiver = interpreter.applySelectors([receiver, selector]);
                    }
                    if (!isRankRecord(receiver)) {
                        throw new RankError('field assignment expects a record target');
                    }
                    return interpreter.assignRecordField(
                        receiver,
                        field.name,
                        statement.operator,
                        yield* resume(interpreter.evaluateTask(statement.value)),
                    );
                }
                if (!isRankArray(target) || target.kind !== 'array') {
                    throw new RankError('array assignment expects an array target');
                }
                if (target.itemAt !== undefined) {
                    throw new RankError('cannot assign to a lazy array');
                }
                const selection = tensorSelection(target, selectors);
                const result = (yield* resume(interpreter.evaluateTask(statement.value)));
                const operator = statement.operator === '='
                    ? undefined : assignmentOperator(statement.operator);
                let operands: RankValue[];
                if (isRankArray(result)) {
                    if (!sameShape(selection.shape, result.shape)) {
                        throw new RankError(
                            `assignment shape mismatch: ${selection.shape} and ${result.shape}`,
                            'DimensionMismatch',
                        );
                    }
                    operands = Array.from(
                        { length: arraySize(selection.shape) },
                        (_, index) => arrayItem(result, index),
                    );
                } else {
                    operands = Array(arraySize(selection.shape)).fill(result) as RankValue[];
                }
                const replacements = operands.map((operand, index) => operator === undefined
                    ? operand
                    : interpreter.evaluateBinary(
                        operator,
                        target.items[selection.offsetAt(index)],
                        operand,
                    ));
                for (let index = 0; index < replacements.length; index += 1) {
                    target.items[selection.offsetAt(index)] = replacements[index];
                }
                return result;
            } };
        }
        if (isAssignmentStatement(statement)) {
            const operator = statement.operator === '='
                ? undefined : assignmentOperator(statement.operator);
            const direct = this.compileDirectExpression(statement.value);
            if (direct) {
                return { run: () => {
                    const result = operator === undefined ? direct() : this.evaluateBinary(
                        operator, this.resolveVariable(statement.name), direct(),
                    );
                    this.assign(statement.name, result);
                    return result;
                } };
            }
            return { stream: () => {
                const previous = operator === undefined ? undefined : this.resolveVariable(statement.name);
                return mapResult(this.evaluateTask(statement.value), value => {
                    const result = operator === undefined ? value : this.evaluateBinary(operator, previous!, value);
                    this.assign(statement.name, result);
                    return result;
                });
            } };
        }
        if (isExpressionStatement(statement)) {
            const mutation = explicitCollectionMutation(statement.value);
            if (mutation) {
                return { stream: function* (): Execution<RankValue | undefined> {
                    const target = yield* resume(interpreter.evaluateTask(mutation.receiver));
                    if (isRankGraph(target)) {
                        interpreter.requireModule('graph', mutation.operation);
                        if (mutation.operation !== 'add') {
                            throw new RankError('graph does not support remove');
                        }
                        const values = yield* resume(mapExecution(
                            mutation.arguments ?? [mutation.value],
                            value => interpreter.evaluateTask(value),
                        ));
                        target.add(values);
                        return undefined;
                    }
                    interpreter.requireModule('algo', mutation.operation);
                    const receiver = mutation.operation === 'add'
                        ? expectAddCollection(target) : target;
                    const value = yield* resume(interpreter.evaluateTask(mutation.value));
                    if (mutation.operation === 'add') addToCollection(receiver, value);
                    else removeFromCollection(receiver, value);
                    return undefined;
                } };
            }
            if (isNameExpression(statement.value) && statement.value.name.endsWith('.run')) {
                const alias = statement.value.name.slice(0, -4);
                return { stream: function* (): Execution<RankValue | undefined> { return interpreter.runAlias(alias); } };
            }
            const direct = this.compileDirectExpression(statement.value);
            if (direct) {
                return { run: context => {
                    const result = direct();
                    if (context.assertBooleanExpressions) assertTestExpression(result);
                    return result;
                } };
            }
            return { stream: context => mapResult(this.evaluateTask(statement.value), result => {
                if (context.assertBooleanExpressions) assertTestExpression(result);
                return result;
            }) };
        }
        return { stream: function* (): Execution<RankValue | undefined> { return undefined; } };
    }

    evaluate(expression: Expression): RankValue {
        try {
            return runExecution(this.evaluateTask(expression));
        } catch (error) {
            throw this.locateError(error, expression);
        }
    }

    private evaluateTask(expression: Expression): Evaluation<RankValue> {
        return this.prepareExpression(expression)();
    }

    private prepareExpression(expression: Expression): () => Evaluation<RankValue> {
        let execute = this.expressions.get(expression);
        if (!execute) {
            const direct = this.compileDirectExpression(expression);
            execute = direct
                ? () => completed(direct())
                : this.compileExpression(expression);
            this.expressions.set(expression, execute);
        }
        return execute;
    }

    // Arithmetic and conditions with direct operands cannot call
    // Rank functions. Keep those syntax trees synchronous to avoid allocating a task
    // for every atom of a counted loop. Bindings and values remain runtime work.
    private compileDirectExpression(expression: Expression): (() => RankValue) | undefined {
        if (isNewStructureExpression(expression)) return () => {
            if (expression.structure === 'graph') {
                this.requireModule('graph', 'new graph');
                return graphConstructor();
            }
            this.requireModule('algo', 'new');
            return newStructure(expression.structure);
        };
        if (isNumberLiteral(expression) || isBooleanLiteral(expression) || isStringLiteral(expression)) {
            return () => expression.value;
        }
        if (isLabelLiteral(expression)) return () => ({ kind: 'label', name: expression.name });
        if (isNameExpression(expression)) {
            const name = expression.name;
            if (name.includes('.')) return () => this.resolve(name);
            let layout: Map<string, number> | undefined;
            let slot: number | undefined;
            return () => {
                const frame = this.localFrame;
                if (frame) {
                    if (layout !== frame.layout || slot === undefined) {
                        layout = frame.layout;
                        slot = layout.get(name);
                    }
                    if (slot !== undefined) {
                        const value = frame.read(slot, name);
                        if (value !== undefined) return value;
                    }
                }
                return this.resolve(name);
            };
        }
        if (isParenthesizedExpression(expression)) return this.compileDirectExpression(expression.value);
        if (isUnaryExpression(expression)) {
            const operand = this.compileDirectExpression(expression.operand);
            return operand ? () => this.evaluateUnary(expression.operator, operand()) : undefined;
        }
        if (isBinaryExpression(expression) && expression.operator !== 'pad'
            && expression.operator !== '**'
            && !isNamed(expression.right, 'reduce')
            && !isNamed(expression.right, 'scan')
            && !isNamed(expression.right, 'outer')) {
            const left = this.compileDirectExpression(expression.left);
            const right = this.compileDirectExpression(expression.right);
            const step = expression.step ? this.compileDirectExpression(expression.step) : undefined;
            if (left && right && (!expression.step || step)) {
                return () => this.evaluateBinary(expression.operator, left(), right(), step?.());
            }
        }
        return undefined;
    }

    // Cache syntax decisions, never values or name bindings. Preparation stays
    // lazy so errors in unexecuted branches keep their existing timing.
    private compileExpression(
        expression: Expression,
        missing?: () => RankValue,
        tail = false,
    ): () => Evaluation<RankValue> {
        const interpreter = this;
        const pipeline = modifierPipeline(expression);
        if (pipeline) return this.compileExpression(pipeline, missing, tail);
        if (isNewStructureExpression(expression)) {
            const create = this.compileDirectExpression(expression)!;
            return () => completed(create());
        }
        if (isNumberLiteral(expression) || isBooleanLiteral(expression)) {
            return function* (): Execution<RankValue> { return expression.value; };
        }
        if (isStringLiteral(expression)) {
            return function* (): Execution<RankValue> { return expression.value; };
        }
        if (isLabelLiteral(expression)) {
            return function* (): Execution<RankValue> { return ({ kind: 'label', name: expression.name }); };
        }
        if (isStdinExpression(expression)) {
            return function* (): Execution<RankValue> {
                interpreter.requireModule('io', 'stdin');
                const mode = expression.mode.name;
                if (mode !== 'word' && mode !== 'integer') {
                    throw new RankError(`unsupported standard input mode: .${mode}`);
                }
                if (!expression.count) return interpreter.readStdin(mode);

                const count = (yield* resume(interpreter.evaluateTask(expression.count)));
                if (typeof count !== 'bigint' || count < 0n) {
                    throw new RankError('stdin count must be a nonnegative integer');
                }
                let consumed = false;
                return sequence({
                    name: `stdin .${mode}`,
                    size: { kind: 'exact', value: count },
                    *iterate() {
                        if (consumed) {
                            throw new RankError(
                                `standard input sequence .${mode} has already been consumed`,
                                'ConsumedSequence',
                            );
                        }
                        consumed = true;
                        for (let index = 0n; index < count; index += 1n) {
                            yield interpreter.readStdin(mode);
                        }
                    },
                });
            };
        }
        if (isArrayExpression(expression)) {
            return function* (): Execution<RankValue> {
                const items = yield* resume(mapExecution(expression.dimensions.length > 0
                    ? expression.rows.flatMap(row => row.items)
                    : expression.items, item => interpreter.evaluateArrayItem(item)));
                if (expression.dimensions.length === 0) return array(items);
                const shape = yield* resume(mapExecution(expression.dimensions, item => interpreter.arrayDimension(item)));
                const size = shape.reduce((product, dimension) => product * BigInt(dimension), 1n);
                if (expression.fill !== undefined) {
                    const fill = (yield* resume(interpreter.evaluateTask(expression.fill)));
                    return { kind: 'array', items: Array(Number(size)).fill(fill), shape };
                }
                if (BigInt(items.length) !== size) {
                    throw new RankError(
                        `array shape ${shape.join(' ')} expects ${size} elements, got ${items.length}`,
                    );
                }
                return { kind: 'array', items, shape };
            };
        }
        if (isRecordExpression(expression)) {
            return function* (): Execution<RankValue> {
                const entries = new ResourceMap<RankValue>(value => value);
                const record: RankRecord = entries.resources.track({
                    kind: 'record',
                    entries,
                    types: new Map(),
                });
                for (const field of expression.fields) {
                    if (record.entries.has(field.name)) {
                        throw new RankError(`duplicate record field: .${field.name}`);
                    }
                    const value = yield* resume(interpreter.evaluateTask(field.value));
                    record.entries.set(field.name, value);
                    record.types.set(field.name, typeName(value));
                }
                return record;
            };
        }
        if (isKeyedSortExpression(expression)) {
            return function* (): Execution<RankValue> {
                const operation = expression.operator.startsWith('argsort')
                    ? 'argsort by'
                    : 'sort by';
                const indices = operation === 'argsort by';
                interpreter.requireModule('sequences', operation);
                const source = yield* resume(interpreter.evaluateTask(expression.source));
                const items = sortByItems(source, operation);
                if (expression.fields.length > 0) {
                    const keys = items.map(item => expression.fields.map(field => {
                        if (!isRankRecord(item)) {
                            throw new RankError(`${operation} fields expects records`, 'TypeError');
                        }
                        const value = item.entries.get(field.name);
                        if (value === undefined) {
                            throw new MissingValueError(
                                `${operation} record is missing field .${field.name}`,
                            );
                        }
                        return value;
                    }));
                    return sortByKeys(items, keys, operation, indices);
                }
                if (!expression.key) throw new RankError(`${operation} requires a key`);
                const key = yield* resume(interpreter.evaluateTask(expression.key));
                if (!isNativeFunction(key) || !key.arities.includes(1)) {
                    throw new RankError(`${operation} key must be a unary function`);
                }
                const keys: RankValue[][] = [];
                for (const item of items) {
                    const value = yield* resume(interpreter.invoke(key, [item]));
                    interpreter.ownFiles(value);
                    keys.push([value]);
                }
                return sortByKeys(items, keys, operation, indices);
            };
        }
        if (isNameExpression(expression)) {
            return function* (): Execution<RankValue> { return interpreter.resolve(expression.name); };
        }
        if (isParenthesizedExpression(expression)) {
            if (tail) return this.compileExpression(expression.value, missing, true);
            return () => interpreter.evaluateTask(expression.value);
        }
        if (isUnaryExpression(expression)) {
            return function* (): Execution<RankValue> {
                return interpreter.evaluateUnary(expression.operator, (yield* resume(interpreter.evaluateTask(expression.operand))));
            };
        }
        if (isBinaryExpression(expression)) {
            const signedRound = explicitSignedRoundApplication(expression);
            if (signedRound) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('numbers', 'round');
                    const places = (yield* resume(interpreter.evaluateTask(signedRound.places)));
                    const values = yield* resume(mapExecution(
                        signedRound.source,
                        part => interpreter.evaluateTask(part),
                    ));
                    const source = values.length === 1
                        ? values[0]
                        : yield* resume(interpreter.apply(values));
                    return roundValue(
                        source,
                        typeof places === 'bigint' ? -places : places,
                    );
                };
            }
            if (expression.operator === '**' && isUnaryExpression(expression.left)
                && (expression.left.operator === '+' || expression.left.operator === '-')) {
                const left = expression.left;
                return function* (): Execution<RankValue> {
                    const powered = interpreter.evaluateBinary(
                        '**',
                        (yield* resume(interpreter.evaluateTask(left.operand))),
                        (yield* resume(interpreter.evaluateTask(expression.right))),
                    );
                    return interpreter.evaluateUnary(left.operator, powered);
                };
            }
            const outer = explicitOuterApplication(expression);
            if (outer) {
                return function* (): Execution<RankValue> {
                    return interpreter.evaluateOuter(
                        outer.operator,
                        (yield* resume(interpreter.evaluateTask(outer.left))),
                        (yield* resume(interpreter.evaluateTask(outer.right))),
                    );
                };
            }
            const scan = explicitScanApplication(expression);
            if (scan) {
                return function* (): Execution<RankValue> {
                    return interpreter.evaluateScan(
                        scan.operator,
                        (yield* resume(interpreter.evaluateTask(scan.source))),
                    );
                };
            }
            const reduction = explicitReduceApplication(expression);
            if (reduction) {
                const fused = reduction.rank === undefined ? compileFusedReduction(
                    reduction.source, reduction.operator, {
                        prepareLeaf: source => interpreter.compileDirectExpression(source)!,
                        binary: (operator, a, b) => interpreter.evaluateBinary(operator, a, b),
                        reduce: value => interpreter.evaluateReduction(reduction.operator, value),
                    },
                ) : undefined;
                if (fused) return () => completed(fused());
                return function* (): Execution<RankValue> {
                    return interpreter.evaluateReduction(
                        reduction.operator,
                        (yield* resume(interpreter.evaluateTask(reduction.source))),
                        reduction.rank,
                    );
                };
            }
            const slice = inlineSlice(expression);
            if (slice) {
                return function* (): Execution<RankValue> {
                    const start = expectInteger((yield* resume(interpreter.evaluateTask(slice.start))));
                    const end = expectInteger((yield* resume(interpreter.evaluateTask(slice.end))));
                    const source = (yield* resume(interpreter.evaluateTask(slice.source)));
                    const axis = slice.axis === undefined ? 0 : safeDimension(slice.axis, 'axis');
                    return sliceValue(source, axis, start, end, slice.inclusive);
                };
            }
            if (expression.operator === 'pad') {
                // Identity-only marker; never exposed to Rank or passed to functions.
                const absent: RankValue = { kind: 'label', name: '' };
                let left: (() => Evaluation<RankValue>) | undefined;
                return function* (): Execution<RankValue> {
                    try {
                        // Prepare on first use to preserve operand/error ordering.
                        left ??= interpreter.compileExpression(expression.left, () => absent);
                        const value = yield* resume(left());
                        if (value !== absent) return value;
                    } catch (error) {
                        if (!(error instanceof MissingValueError)) throw error;
                    }
                    return (yield* resume(interpreter.evaluateTask(expression.right)));
                };
            }
            if (!expression.step) {
                const right = () => interpreter.evaluateTask(expression.right);
                const operation = (left: RankValue, right: RankValue) =>
                    interpreter.evaluateBinary(expression.operator, left, right);
                return () => mapPair(interpreter.evaluateTask(expression.left), right, operation);
            }
            return function* (): Execution<RankValue> { return interpreter.evaluateBinary(
                expression.operator,
                (yield* resume(interpreter.evaluateTask(expression.left))),
                (yield* resume(interpreter.evaluateTask(expression.right))),
                (yield* resume(interpreter.evaluateTask(expression.step!))),
            ); };
        }
        if (isMaterializeExpression(expression)) {
            return function* (): Execution<RankValue> {
                const source = (yield* resume(interpreter.evaluateTask(expression.source)));
                if (!isRankSequence(source)) {
                    throw new RankError('postfix array expects a sequence');
                }
                return materializeSequence(source);
            };
        }
        if (isAllAxisExpression(expression)) {
            return function* (): Execution<RankValue> { throw new RankError('# is only valid inside tensor addressing'); };
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            if (isNewStructureExpression(parts[0])
                && parts[0].structure === 'graph') {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('graph', 'new graph');
                    const constructor = graphConstructor();
                    if (!isNativeFunction(constructor)) {
                        throw new RankError('invalid graph constructor');
                    }
                    const arguments_ = yield* resume(mapExecution(
                        parts.slice(1),
                        part => interpreter.evaluateTask(part),
                    ));
                    return constructor.call(arguments_);
                };
            }
            const namedOuter = explicitNamedOuterApplication(parts);
            if (namedOuter) {
                return function* (): Execution<RankValue> {
                    const operation = (yield* resume(interpreter.evaluateTask(namedOuter.operation)));
                    if (!isNativeFunction(operation)) {
                        throw new RankError('outer expects a binary function');
                    }
                    return interpreter.evaluateNamedOuter(
                        operation,
                        (yield* resume(interpreter.evaluateTask(namedOuter.left))),
                        (yield* resume(interpreter.evaluateTask(namedOuter.right))),
                    );
                };
            }
            const explicitRank = explicitRankApplication(parts);
            if (explicitRank) {
                return function* (): Execution<RankValue> {
                    const source = yield* resume(interpreter.evaluateTask(
                        applicationParts(explicitRank.parts.slice(0, -1)),
                    ));
                    const operation = yield* resume(interpreter.evaluateTask(explicitRank.parts.at(-1)!));
                    return yield* resume(interpreter.applyAtRank([source, operation], explicitRank.rank, explicitRank.axes));
                };
            }
            const axisMatmul = explicitAxisMatmul(parts);
            if (axisMatmul) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('linalg', 'matmul');
                    return matmulValues(
                        (yield* resume(interpreter.evaluateTask(axisMatmul.left))),
                        (yield* resume(interpreter.evaluateTask(axisMatmul.right))),
                        axisMatmul.axes,
                    );
                };
            }
            const axisCovariance = explicitAxisCovariance(parts);
            if (axisCovariance) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('stats', 'covariance');
                    return covarianceValue(
                        (yield* resume(interpreter.evaluateTask(axisCovariance.source))),
                        axisCovariance.axes,
                    );
                };
            }
            const textFormat = parts.findIndex((part, index) => index > 0
                && isNamed(part, 'text') && isStringLiteral(parts[index + 1]));
            if (textFormat >= 0) {
                const format = parts[textFormat + 1];
                if (!isStringLiteral(format)) throw new RankError('expected text format');
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('text', 'text');
                    const values = yield* resume(mapExecution(parts.slice(0, textFormat),
                        part => interpreter.evaluateTask(part)));
                    const source = values.length === 1 ? values[0] : yield* resume(interpreter.apply(values));
                    const result = formattedText(source, format.value);
                    const remaining = yield* resume(mapExecution(parts.slice(textFormat + 2),
                        part => interpreter.evaluateTask(part)));
                    return remaining.length ? yield* resume(interpreter.apply([result, ...remaining], missing, 0, [], tail)) : result;
                };
            }
            const round = explicitRoundApplication(parts);
            if (round) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('numbers', 'round');
                    const values = yield* resume(mapExecution(
                        round.source,
                        part => interpreter.evaluateTask(part),
                    ));
                    const source = values.length === 1
                        ? values[0]
                        : yield* resume(interpreter.apply(values));
                    return roundValue(
                        source,
                        (yield* resume(interpreter.evaluateTask(round.places))),
                    );
                };
            }
            const axisWindow = explicitAxisWindow(parts);
            if (axisWindow) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'window');
                    return windowValue(
                        (yield* resume(interpreter.evaluateTask(axisWindow.source))),
                        (yield* resume(interpreter.evaluateTask(axisWindow.size))),
                        axisWindow.axes,
                    );
                };
            }
            const axisShuffle = explicitAxisShuffle(parts);
            if (axisShuffle) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('random', 'shuffle');
                    return shuffleValue(
                        (yield* resume(interpreter.evaluateTask(axisShuffle.source))),
                        axisShuffle.seed ? (yield* resume(interpreter.evaluateTask(axisShuffle.seed))) : undefined,
                        axisShuffle.axis,
                        interpreter.random,
                    );
                };
            }
            const axisLength = explicitAxisLength(parts);
            if (axisLength) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'len');
                    return lengthOfAxis((yield* resume(interpreter.evaluateTask(axisLength.source))), axisLength.axis);
                };
            }
            const axisArgsort = explicitAxisArgsort(parts);
            if (axisArgsort) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'argsort');
                    return argsortAxis(
                        (yield* resume(interpreter.evaluateTask(axisArgsort.source))),
                        axisArgsort.axis,
                    );
                };
            }
            const axisMetric = explicitAxisMetric(parts);
            if (axisMetric) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('stats', axisMetric.metric);
                    return errorMetricValue(
                        (yield* resume(interpreter.evaluateTask(axisMetric.left))),
                        (yield* resume(interpreter.evaluateTask(axisMetric.right))),
                        axisMetric.metric,
                        axisMetric.axes,
                    );
                };
            }
            const axisReduction = explicitAxisReduction(parts);
            if (axisReduction) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule(
                        axisReduction.operation === 'mean'
                            || axisReduction.operation === 'std'
                            ? 'stats'
                            : axisReduction.operation === 'all'
                                || axisReduction.operation === 'any'
                                || axisReduction.operation === 'count'
                                ? 'sequences'
                                : 'numbers',
                        axisReduction.operation,
                    );
                    return interpreter.evaluateAxisReduction(
                        axisReduction.operation,
                        (yield* resume(interpreter.evaluateTask(axisReduction.source))),
                        axisReduction.axes,
                    );
                };
            }
            const axisTranspose = explicitAxisTranspose(parts);
            if (axisTranspose) {
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'transpose');
                    return transposeValue(
                        (yield* resume(interpreter.evaluateTask(axisTranspose.source))),
                        axisTranspose.axes,
                    );
                };
            }
            const extreme = explicitExtremeApplication(parts);
            if (extreme) {
                return this.compileApplication(extreme, missing, tail);
            }
            // Builtin postfix extrema reduce an addressed value (Matrix i max).
            // A shadowing callable uses the same argument rules as any function.
            const lastExtreme = extremeName(parts.at(-1)!);
            if (lastExtreme && parts.length > 2) return () => flatMapResult(mapExecution(
                parts.slice(0, -1), part => interpreter.evaluateTask(part),
            ), values => {
                const fn = interpreter.resolve(lastExtreme);
                const builtin = interpreter.standardFunctions.get(standardModules.numbers[lastExtreme]);
                if (fn === builtin && canApplySelectors(values)) {
                    return interpreter.apply([interpreter.applySelectors(values), fn], missing, 0, [], tail);
                }
                return interpreter.apply([...values, fn], missing, 0, [], tail);
            });
            const axisSelection = explicitAxisSelection(parts);
            if (axisSelection) {
                return function* (): Execution<RankValue> {
                    return selectAxis(
                        (yield* resume(interpreter.evaluateTask(axisSelection.source))),
                        axisSelection.axis,
                        (yield* resume(interpreter.evaluateTask(axisSelection.selector))),
                    );
                };
            }
            const graphEdges = explicitGraphEdges(parts);
            if (graphEdges) {
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(interpreter.evaluateTask(
                        graphEdges.receiver,
                    ));
                    const argument = yield* resume(interpreter.evaluateTask(
                        graphEdges.argument,
                    ));
                    if (isRankGraph(receiver)) {
                        interpreter.requireModule('graph', 'edges');
                        return receiver.edges(argument);
                    }
                    const operation = yield* resume(interpreter.evaluateTask(
                        graphEdges.operation,
                    ));
                    return yield* resume(interpreter.apply(
                        [receiver, argument, operation],
                        missing,
                        0,
                        [],
                        tail,
                    ));
                };
            }
            const multisetMethod = explicitMultisetMethod(parts);
            if (multisetMethod) {
                return function* (): Execution<RankValue> {
                    const receiverParts = yield* resume(mapExecution(
                        multisetMethod.receiver,
                        part => interpreter.evaluateTask(part),
                    ));
                    const argumentParts = yield* resume(mapExecution(
                        multisetMethod.argument,
                        part => interpreter.evaluateTask(part),
                    ));
                    const receiverValue = receiverParts.length === 1
                        ? receiverParts[0]
                        : yield* resume(interpreter.apply(receiverParts));
                    const argumentValue = argumentParts.length === 1
                        ? argumentParts[0]
                        : yield* resume(interpreter.apply(argumentParts));
                    if (isRankMultiset(receiverValue)) {
                        interpreter.requireModule('algo', multisetMethod.operation);
                        const receiver = expectMultiset(receiverValue);
                        if (multisetMethod.operation === 'floor') return receiver.floor(argumentValue);
                        if (multisetMethod.operation === 'upperbound') return receiver.upperBound(argumentValue);
                        return receiver.ceiling(argumentValue);
                    }
                    const operation = yield* resume(interpreter.evaluateTask(
                        parts[multisetMethod.receiver.length],
                    ));
                    return yield* resume(interpreter.apply(
                        [receiverValue, argumentValue, operation],
                        missing,
                        0,
                        [],
                        tail,
                    ));
                };
            }
            const materializePipeline = explicitMaterializePipeline(parts);
            if (materializePipeline) {
                return function* (): Execution<RankValue> {
                    const sourceParts = yield* resume(mapExecution(
                        materializePipeline.source,
                        part => interpreter.evaluateTask(part),
                    ));
                    const source = sourceParts.length === 1
                        ? sourceParts[0]
                        : yield* resume(interpreter.apply(sourceParts));
                    if (isRankSequence(source)) {
                        let result: RankValue = materializeSequence(source);
                        for (const item of materializePipeline.steps) {
                            result = yield* resume(interpreter.apply([
                                result,
                                yield* resume(interpreter.evaluateArrayItem(item)),
                            ], missing, 0, [], tail));
                        }
                        return result;
                    }
                    const selector = yield* resume(interpreter.evaluateTask(materializePipeline.selector));
                    return yield* resume(interpreter.apply(
                        [source, selector], missing, 0, [], tail,
                    ));
                };
            }
            if (parts.length === 2 && isNamed(parts[1], 'sum')) {
                const fused = compileFusedSum(parts[0], {
                    prepareLeaf: source => interpreter.compileDirectExpression(source)!,
                    binary: (operator, a, b) => interpreter.evaluateBinary(operator, a, b),
                }, (value, sum) => {
                    const fn = interpreter.resolve('sum');
                    if (isNativeFunction(fn) && fn === interpreter.standardFunctions.get(standardModules.numbers.sum)) {
                        return completed(sum ? sum() : fn.call([value]));
                    }
                    return interpreter.apply([value, fn], missing, 0, [], tail);
                });
                if (fused) return fused;
            }
            if (parts.some((part, index) => index > 0 && isNamed(part, 'sum'))) {
                return function* (): Execution<RankValue> {
                    let pending: RankValue[] = [];
                    for (let index = 0; index < parts.length; index += 1) {
                        const part = parts[index];
                        // Resolve receiver methods before looking up ordinary functions.
                        // Each operation consumes its arguments and leaves its result
                        // available to the remainder of the postfix chain.
                        if (isNamed(part, 'sum')) {
                            const receiver = pending.length === 1 ? pending[0]
                                : canApplySelectors(pending) ? interpreter.applySelectors(pending) : undefined;
                            if (receiver !== undefined && isRankFenwick(receiver)) {
                                interpreter.requireModule('algo', 'fenwick');
                                const argument = parts[++index];
                                if (!argument) throw new RankError('fenwick sum expects one integer index');
                                const position = yield* resume(interpreter.evaluateTask(argument));
                                pending = [expectFenwick(receiver).sum(expectInteger(position))];
                                continue;
                            }
                        }
                        const value = isAllAxisExpression(part)
                            ? ALL_AXIS : yield* resume(interpreter.evaluateTask(part));
                        pending.push(value);
                        if (isNativeFunction(value)) {
                            pending = [yield* resume(interpreter.apply(
                                pending, missing, 0, [], tail && index === parts.length - 1,
                            ))];
                        }
                    }
                    return pending.length === 1
                        ? pending[0] : interpreter.applySelectors(pending, missing);
                };
            }
            return this.compileApplication(parts, missing, tail);
        }
        return function* (): Execution<RankValue> { throw new RankError(`cannot evaluate ${expression.$type}`); };
    }

    private compileApplication(
        parts: Expression[], missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const interpreter = this;
        const directParts = parts.map(part => isAllAxisExpression(part)
            ? () => ALL_AXIS : this.compileDirectExpression(part));
        if (directParts.every(part => part !== undefined)) {
            const last = parts.at(-1)!;
            if (!tail && (parts.length === 2 || parts.length === 3) && isNameExpression(last)) {
                const [left, right, operation] = directParts;
                const binary = parts.length === 3;
                return () => {
                    const a = left();
                    const b = binary ? right() : undefined;
                    const arguments_ = binary ? [a, b!] : [a];
                    const simple = !isNativeFunction(a) && (b === undefined || !isNativeFunction(b));
                    const fn = (binary ? operation : right)();
                    if (simple && isNativeFunction(fn) && fn.arities.includes(arguments_.length)) {
                        const result = arguments_.length === 1 && fn.monadicRank !== 'all'
                            ? this.applyUnaryAtRank(arguments_[0], fn, fn.monadicRank)
                            : this.invoke(fn, arguments_);
                        if ('done' in result) {
                            this.ownFiles(result.value);
                            return result;
                        }
                        return this.finishApplication(result);
                    }
                    return this.apply([...arguments_, fn], missing, 0, [], tail);
                };
            }
            return () => this.apply(directParts.map(part => part()), missing, 0, [], tail);
        }
        return () => flatMapResult(mapExecution(parts, part => isAllAxisExpression(part)
            ? completed(ALL_AXIS) : interpreter.evaluateTask(part)),
        values => interpreter.apply(values, missing, 0, [], tail));
    }

    private readStdin(mode: 'word' | 'integer'): RankValue {
        const input = this.options.input;
        if (!input) {
            throw new RankError('standard input is unavailable in this host', 'IO');
        }
        const token = input.readToken();
        if (token === undefined) {
            throw new RankError(`standard input ended before .${mode}`, 'EndOfInput');
        }
        if (mode === 'word') return token;
        if (!/^[+-]?[0-9]+$/u.test(token)) {
            throw new RankError(`invalid integer input: ${token}`, 'InvalidNumber', token);
        }
        return BigInt(token);
    }

    private *evaluateArrayItem(item: ArrayItem): Execution<RankValue> {
        const value = (yield* resume(this.evaluateTask(item.value)));
        if (!item.sign) return value;
        return this.evaluateUnary(item.sign, value);
    }

    private evaluateAddressItem(item: AddressItem): Evaluation<RankValue> {
        if (item.all) return completed(ALL_AXIS);
        if (!item.value) throw new RankError('missing array selector');
        const result = this.evaluateTask(item.value);
        const sign = item.sign;
        return sign ? mapResult(result, value => this.evaluateUnary(sign, value)) : result;
    }

    private *arrayDimension(item: ArrayItem): Execution<number> {
        const dimension = expectInteger((yield* resume(this.evaluateArrayItem(item))));
        if (dimension < 0n) throw new RankError(`array dimension must be nonnegative: ${dimension}`);
        if (dimension > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`array dimension is too large: ${dimension}`);
        }
        return Number(dimension);
    }

    private useStandard(module: string): void {
        if (!(module in standardModules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        this.modules.add(module);
    }

    private defineFunction(statement: FunctionStatement): RankValue {
        const { generator } = prepareFunction(statement);
        if (statement.memo && generator) throw new RankError('memo functions cannot yield');
        const context = this.localFrame;
        const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
        const compiled = only && isReturnStatement(only) && only.value
            ? this.compileDirectExpression(only.value) : undefined;
        const direct = compiled ? () => {
            try { return compiled(); }
            catch (error) { throw this.locateError(error, only!); }
        } : undefined;
        const body = (arguments_: RankValue[]): Evaluation<RankValue> => direct
            ? completed(this.callDirectFunction(statement, arguments_, context, direct))
            : this.callFunction(statement, arguments_, context);
        // The closure owns the cache, so separate local declarations never share it.
        const cache = statement.memo ? new Map<string, RankValue>() : undefined;
        const execute = cache ? (arguments_: RankValue[]): Evaluation<RankValue> => {
            const key = JSON.stringify(arguments_.map(memoScalarKey));
            const cached = cache.get(key);
            if (cached !== undefined) return completed(cached);
            return mapResult(body(arguments_), value => {
                memoScalarKey(value);
                cache.set(key, value);
                return value;
            });
        } : body;
        const fn: NativeFunction = {
            kind: 'function',
            name: statement.name,
            arities: [statement.parameters.length],
            monadicRank: 'all',
            dyadicRanks: statement.parameters.length === 2 ? ['all', 'all'] : undefined,
            captures: context?.captures(),
            call: arguments_ => generator
                ? this.callGeneratorFunction(statement, arguments_, context)
                : runExecution(execute(arguments_)),
        };
        if (!generator) {
            functionExecutions.set(fn, execute);
            // A memo call must return through its cache writer. Do not bypass it
            // via the tail-call path that enters an ordinary function body.
            if (!statement.memo) functionDefinitions.set(fn, { interpreter: this, statement, context, direct });
        }
        this.assign(statement.name, fn);
        return fn;
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
        const frame = reusable?.reset() ? reusable
            : new LocalFrame(parent, prepareFunction(statement).layout);
        statement.parameters.forEach((parameter, index) => {
            frame.set(parameter, arguments_[index]);
            frame.types.set(parameter, new Set([typeName(arguments_[index])]));
        });
        return frame;
    }

    // A single return whose expression contains no applications cannot make a
    // direct Rank call. It needs a lexical/resource frame, but no suspended task.
    private callDirectFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
        direct: () => RankValue,
    ): RankValue {
        if (this.callDepth >= this.maxCallDepth) {
            throw new RankError(`function call depth exceeds ${this.maxCallDepth}`, 'RecursionLimit');
        }
        const frame = this.functionFrame(statement, arguments_, context);
        this.callDepth += 1;
        return this.withResourceScope(() => {
            try {
                return this.withLexicalFrame(frame, direct);
            } finally {
                this.callDepth -= 1;
            }
        });
    }

    private *callFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
    ): Execution<RankValue> {
        if (this.callDepth >= this.maxCallDepth) {
            throw new RankError(`function call depth exceeds ${this.maxCallDepth}`, 'RecursionLimit');
        }
        let frame = this.functionFrame(statement, arguments_, context);
        const caller = this.localFrame;
        const scope = new Set<RankFile>();
        this.resourceScopes.push(scope);
        this.localFrame = frame;
        this.callDepth += 1;
        let result: RankValue | undefined;
        let pending: unknown;
        try {
            while (true) {
                try {
                    this.localFrame = frame;
                    for (const local of prepareFunction(statement).locals) this.defineFunction(local);
                    yield* resume(this.executeStatementStream(statement.statements));
                    throw new RankError(`function ${statement.name} reached end without return`);
                } catch (error) {
                    if (error instanceof TailCallSignal) {
                        const reusable = statement === error.definition.statement
                            && frame.parent === error.definition.context ? frame : undefined;
                        statement = error.definition.statement;
                        frame = this.functionFrame(statement, error.arguments_, error.definition.context, reusable);
                        if (error.definition.direct) {
                            this.localFrame = frame;
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
            this.callDepth -= 1;
            this.localFrame = caller;
            this.finishResourceScope(scope, result, pending);
        }
        return result!;
    }

    private callGeneratorFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
    ): RankSequence {
        const frame = this.functionFrame(statement, arguments_, context);
        const interpreter = this;
        let consumed = false;

        this.withLexicalFrame(frame, () => {
            for (const local of prepareFunction(statement).locals) this.defineFunction(local);
        });

        return sequence({
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
                interpreter.generatorResourceScopes.add(resources);
                const execution = new ExecutionStack((function* (): Execution<RankValue | undefined> {
                    return yield* resume(interpreter.executeStatementStream(
                        statement.statements, false, false, false, true,
                    ));
                })());
                try {
                    while (true) {
                        let next: IteratorResult<RankValue, RankValue | undefined>;
                        try {
                            next = interpreter.withGeneratorFrame(
                                frame,
                                resources,
                                () => execution.next(),
                            );
                        } catch (error) {
                            if (error instanceof ReturnSignal && error.value === undefined) return;
                            throw error;
                        }
                        if (next.done) return;
                        yield next.value;
                    }
                } finally {
                    try {
                        interpreter.withGeneratorFrame(
                            frame,
                            resources,
                            () => {
                                let result = execution.return(undefined);
                                while (!result.done) result = execution.next();
                            },
                        );
                    } finally {
                        interpreter.generatorResourceScopes.delete(resources);
                        interpreter.closeResources(resources, new Set());
                    }
                }
            },
        });
    }

    private localIndex(): RankIndex {
        this.requireModule('algo', 'index');
        const scope = this.localFrame?.values ?? this.variables;
        const existing = scope.get('index');
        if (existing !== undefined) {
            if (!isRankIndex(existing)) throw new RankError('index name is already in use');
            return existing;
        }
        const index = newStructure('index') as RankIndex;
        scope.set('index', index);
        return index;
    }

    private localQueue(): RankQueue {
        this.requireModule('algo', 'queue');
        const scope = this.localFrame?.values ?? this.variables;
        const existing = scope.get('queue');
        if (existing !== undefined) {
            if (!isRankQueue(existing)) throw new RankError('queue name is already in use');
            return existing;
        }
        const queue: RankQueue = new RankDeque();
        scope.set('queue', queue);
        return queue;
    }

    private localSet(): RankSet {
        this.requireModule('algo', 'set');
        const scope = this.localFrame?.values ?? this.variables;
        const existing = scope.get('set');
        if (existing !== undefined) {
            if (!isRankSet(existing)) throw new RankError('set name is already in use');
            return existing;
        }
        const set = newStructure('set') as RankSet;
        scope.set('set', set);
        return set;
    }

    private localCounter(): RankCounter {
        this.requireModule('algo', 'counter');
        const scope = this.localFrame?.values ?? this.variables;
        const existing = scope.get('counter');
        if (existing !== undefined) {
            if (!isRankCounter(existing)) throw new RankError('counter name is already in use');
            return existing;
        }
        const counter = newStructure('counter') as RankCounter;
        scope.set('counter', counter);
        return counter;
    }

    private useFile(specifier: string, alias?: string): LoadedProgram {
        const loaded = this.load(specifier);
        const child = new Interpreter(this.output, {
            input: this.options.input,
            io: this.options.io,
            random: this.random,
            maxCallDepth: this.maxCallDepth,
            loadModule: this.options.loadModule,
            sourceId: loaded.id,
        });
        child.loadedProgram = loaded;
        child.prepareModule(loaded.program);

        if (alias) {
            if (this.aliases.has(alias) || this.variables.has(alias)) {
                throw new RankError(`name already defined: ${alias}`);
            }
            this.aliases.set(alias, child);
        } else {
            for (const statement of loaded.program.statements) {
                if (!isFunctionStatement(statement)) continue;
                this.assign(statement.name, child.resolveVariable(statement.name));
            }
            this.currentRunTarget = loaded;
        }
        return loaded;
    }

    private load(specifier: string): LoadedProgram {
        const cached = this.openPrograms.get(specifier);
        if (cached) return cached;
        if (!this.options.loadModule) {
            throw new RankError(`cannot load module without a loader: ${specifier}`);
        }
        const source = this.options.loadModule(specifier, this.options.sourceId);
        const loaded = { id: source.id, program: parse(source.source, source.id) };
        if (loaded.program.$cstNode) sourceIds.set(loaded.program.$cstNode.root, source.id);
        this.openPrograms.set(specifier, loaded);
        return loaded;
    }

    private run(specifier?: string): RankValue | undefined {
        const target = specifier ? this.useFile(specifier) : this.currentRunTarget;
        if (!target) {
            throw new RankError('run requires a previously used program or a file name');
        }
        const args = this.pendingArgs ?? [];
        this.pendingArgs = undefined;
        const previous = this.currentRunTarget;
        try {
            return this.withResourceScope(() => this.executeProgram(target.program, args));
        } finally {
            this.currentRunTarget = previous;
        }
    }

    private runAlias(alias: string): RankValue | undefined {
        const child = this.aliases.get(alias);
        if (!child?.loadedProgram) {
            throw new RankError(`unknown module alias: ${alias}`);
        }
        const result = child.withResourceScope(() => child.executeProgram(child.loadedProgram!.program));
        this.ownFiles(result);
        return result;
    }

    private executeTest(name: string, statements: Statement[]): void {
        if (!this.options.testing && !this.modules.has('testing')) {
            throw new RankError('test requires: use testing');
        }
        const output: string[] = [];
        const test = new Interpreter(line => output.push(line), {
            input: this.options.input,
            io: this.options.io,
            random: this.random,
            loadModule: this.options.loadModule,
            sourceId: this.options.sourceId,
            testing: true,
        });
        test.modules.add('testing');
        const program = { $type: 'Program' as const, statements } as Program;
        try {
            test.withResourceScope(() => test.executeProgram(program, [], true), false);
            this.testResults.push({ name, passed: true, output });
        } catch (error) {
            this.testResults.push({
                name,
                passed: false,
                output,
                error: error instanceof RankError ? error.format() : String(error),
            });
        }
    }

    private prepareInputs(program: Program, args: readonly string[]): void {
        const declarations = program.statements.filter(statement =>
            isOptionStatement(statement) || isArgumentStatement(statement) || isFlagStatement(statement));
        if (declarations.length === 0) {
            if (args.length > 0) throw new RankError(`unexpected arguments: ${args.join(' ')}`);
            return;
        }

        const parsed = parseArguments(args);
        let positionalIndex = 0;
        const knownOptions = new Set<string>();
        for (const declaration of declarations) {
            if (isOptionStatement(declaration)) {
                const optionName = kebabCase(declaration.name);
                knownOptions.add(optionName);
                const supplied = parsed.options.get(optionName);
                if (this.variables.has(declaration.name)) {
                    this.validateInput(declaration.name, declaration.valueType, declaration.many);
                } else if (supplied) {
                    this.variables.set(
                        declaration.name,
                        inputValues(supplied, declaration.valueType, declaration.many),
                    );
                } else if (declaration.defaultValue) {
                    this.variables.set(declaration.name, this.evaluate(declaration.defaultValue));
                    this.validateInput(declaration.name, declaration.valueType, declaration.many);
                } else {
                    throw new RankError(`missing option: --${optionName}`);
                }
            } else if (isArgumentStatement(declaration)) {
                if (this.variables.has(declaration.name)) {
                    this.validateInput(declaration.name, declaration.valueType, declaration.many);
                    continue;
                }
                const values = declaration.many
                    ? parsed.positionals.slice(positionalIndex)
                    : parsed.positionals.slice(positionalIndex, positionalIndex + 1);
                positionalIndex += values.length;
                if (values.length > 0) {
                    this.variables.set(
                        declaration.name,
                        inputValues(values, declaration.valueType, declaration.many),
                    );
                } else if (declaration.defaultValue) {
                    this.variables.set(declaration.name, this.evaluate(declaration.defaultValue));
                    this.validateInput(declaration.name, declaration.valueType, declaration.many);
                } else {
                    throw new RankError(`missing argument: ${declaration.name}`);
                }
            } else {
                const optionName = kebabCase(declaration.name);
                knownOptions.add(optionName);
                const supplied = parsed.options.get(optionName);
                if (this.variables.has(declaration.name)) {
                    this.validateInput(declaration.name, 'boolean', false);
                } else if (supplied) {
                    this.variables.set(declaration.name, true);
                } else {
                    this.variables.set(declaration.name, declaration.defaultValue ?? false);
                }
            }
        }

        const unknown = [...parsed.options.keys()].filter(name => !knownOptions.has(name));
        if (unknown.length > 0) throw new RankError(`unknown option: --${unknown[0]}`);
        if (positionalIndex < parsed.positionals.length) {
            throw new RankError(`unexpected argument: ${parsed.positionals[positionalIndex]}`);
        }
    }

    private validateInput(name: string, valueType: string, many: boolean): void {
        const value = this.variables.get(name)!;
        const values = many && isRankArray(value) ? value.items : [value];
        if (many && !isRankArray(value)) {
            throw new RankError(`${name} expects multiple ${valueType} values`);
        }
        for (const item of values) validateInputValue(name, valueType, item);
    }

    private resolve(name: string): RankValue {
        const qualified = splitQualified(name);
        if (qualified) {
            const [alias, member] = qualified;
            const child = this.aliases.get(alias);
            if (!child) throw new RankError(`unknown module alias: ${alias}`);
            if (member === 'run') throw new RankError(`${alias}.run is only valid as a statement`);
            return child.resolveVariable(member);
        }
        if (name === 'index') return this.localIndex();
        if (name === 'queue') return this.localQueue();
        if (name === 'set') return this.localSet();
        if (name === 'counter') return this.localCounter();
        const variable = this.findVariable(name);
        if (variable !== undefined) {
            return variable;
        }

        if (name === 'raise') return raiseFunction;
        if (name === 'type') return typeFunction;

        for (const module of this.modules) {
            const fn = standardModules[module]?.[name];
            if (fn) {
                const cached = this.standardFunctions.get(fn);
                if (cached !== undefined) return cached;
                const value = fn({
                    output: this.output,
                    io: this.options.io,
                    random: this.random,
                    seedRandom: seed => this.random[SEED_RANDOM](seed),
                    ownFile: file => this.ownFile(file),
                });
                if (isNativeFunction(value)) this.standardFunctions.set(fn, value);
                return value;
            }
        }

        const providers = Object.entries(standardModules)
            .filter(([module, exports]) => !this.modules.has(module) && Object.prototype.hasOwnProperty.call(exports, name))
            .map(([module]) => `use ${module}`);
        const hint = providers.length > 0
            ? `; did you forget ${providers.map(provider => `\`${provider}\``).join(' or ')}?`
            : '';
        throw new RankError(`unknown name: ${name}${hint}`);
    }

    private resolveVariable(name: string): RankValue {
        const qualified = splitQualified(name);
        if (qualified) {
            const [alias, member] = qualified;
            const child = this.aliases.get(alias);
            if (!child) throw new RankError(`unknown module alias: ${alias}`);
            return child.resolveVariable(member);
        }
        const value = this.findVariable(name);
        if (value === undefined) {
            throw new RankError(`unknown variable: ${name}`);
        }
        return value;
    }

    private assign(name: string, value: RankValue): void {
        const qualified = splitQualified(name);
        if (!qualified) {
            const frame = this.localFrame?.find(name) ?? this.localFrame;
            const scope = frame ?? this.variables;
            const typeScope = frame?.types ?? this.variableTypes;
            const previous = scope.get(name);
            const expected = typeScope.get(name)
                ?? (previous === undefined ? undefined : new Set([typeName(previous)]));
            const received = typeName(value);
            if (expected !== undefined && !expected.has(received)) {
                throw new RankError(
                    `${name} has type ${formatTypes(expected)} and cannot receive ${received}`,
                );
            }
            scope.set(name, value);
            typeScope.set(name, expected ?? new Set([received]));
            return;
        }
        const [alias, member] = qualified;
        const child = this.aliases.get(alias);
        if (!child) throw new RankError(`unknown module alias: ${alias}`);
        child.assign(member, value);
    }

    private assignRecordField(
        record: RankRecord,
        field: string,
        operator: string,
        value: RankValue,
    ): RankValue {
        const previous = record.entries.get(field);
        if (previous === undefined) {
            throw new RankError(`unknown record field: .${field}`);
        }
        const result = operator === '='
            ? value
            : this.evaluateBinary(assignmentOperator(operator), previous, value);
        const expected = record.types.get(field)!;
        const received = typeName(result);
        if (expected !== received) {
            throw new RankError(
                `record field .${field} has type ${expected} and cannot receive ${received}`,
            );
        }
        record.entries.set(field, result);
        return result;
    }

    private findVariable(name: string): RankValue | undefined {
        return this.localFrame?.find(name)?.get(name) ?? this.variables.get(name);
    }

    private apply(
        values: RankValue[],
        missing?: () => RankValue,
        start = 0,
        pending: RankValue[] = [],
        tail = false,
    ): Evaluation<RankValue> {
        if (start === 0 && !values.some(isNativeFunction)) return completed(this.applySelectors(values, missing));

        for (let index = start; index < values.length; index += 1) {
            const value = values[index];
            if (!isNativeFunction(value)) {
                pending.push(value);
                continue;
            }
            if (pending.length === 0) {
                throw new RankError(`operation must follow its data: ${value.name}`);
            }
            const arguments_ = callArguments(
                value,
                pending,
                parts => this.applySelectors(parts),
            );
            if (tail && index === values.length - 1 && this.resourceScopes.at(-1)?.size === 0) {
                const definition = functionDefinitions.get(value);
                if (definition?.interpreter === this) throw new TailCallSignal(definition, arguments_);
            }
            const task = arguments_.length === 1 && value.monadicRank !== 'all'
                ? this.applyUnaryAtRank(arguments_[0], value, value.monadicRank)
                : this.invoke(value, arguments_);
            if (!('done' in task)) return this.continueApplication(values, missing, index + 1, task, tail);
            this.ownFiles(task.value);
            pending = [task.value];
        }
        return completed(pending.length === 1 ? pending[0] : this.applySelectors(pending));
    }

    private *finishApplication(task: Execution<RankValue>): Execution<RankValue> {
        const result = yield* resume(task);
        this.ownFiles(result);
        return result;
    }

    private *continueApplication(
        values: RankValue[],
        missing: (() => RankValue) | undefined,
        start: number,
        task: Execution<RankValue>,
        tail: boolean,
    ): Execution<RankValue> {
        const result = yield* resume(task);
        this.ownFiles(result);
        return yield* resume(this.apply(values, missing, start, [result], tail));
    }

    private invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue> {
        const execution = functionExecutions.get(fn);
        return execution ? execution(arguments_) : completed(fn.call(arguments_));
    }

    private applySelectors(values: RankValue[], missing?: () => RankValue): RankValue {
        if (values.length === 2 && isRankArray(values[0])
            && (typeof values[1] === 'string' || isRankLabel(values[1]))) {
            this.requireModule('tables', 'table projection');
            const field = typeof values[1] === 'string' ? values[1] : values[1].name;
            return projectField(values[0], field);
        }
        return applySelectors(values, missing);
    }

    private *applyAtRank(
        values: RankValue[],
        rank: bigint,
        axes?: readonly number[],
    ): Execution<RankValue> {
        if (rank > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`rank is too large: ${rank}`);
        }
        const functions = values.filter(isNativeFunction);
        if (functions.length !== 1 || values.at(-1) !== functions[0]) {
            throw new RankError('rank requires one unary operation after its data');
        }
        const fn = functions[0];
        if (!fn.arities.includes(1)) throw new RankError(`rank requires a unary operation: ${fn.name}`);
        const receivers = values.slice(0, -1);
        if (receivers.length !== 1) throw new RankError('unary rank requires one data value');
        return yield* resume(this.applyUnaryAtRank(receivers[0], fn, Number(rank), axes));
    }

    private applyUnaryAtRank(
        value: RankValue,
        fn: Extract<RankValue, { kind: 'function' }>,
        cellRank: number,
        frameAxes?: readonly number[],
    ): Evaluation<RankValue> {
        if (frameAxes !== undefined && !isRankArray(value)) {
            throw new RankError('axis rank expects an array');
        }
        if (typeof value === 'string') {
            if (cellRank >= 1) return this.invoke(fn, [value]);
            return completed(mapTextAtoms(value, atom => fn.call([atom]), fn.name));
        }
        if (isRankSequence(value)) {
            if (cellRank >= 1) return this.invoke(fn, [value]);
            return completed(mapSequence(value, fn.name, atom => fn.call([atom])));
        }
        if (isRankArray(value)) {
            if (frameAxes === undefined && cellRank >= value.shape.length) return this.invoke(fn, [value]);
            const axes = tensorFrameAxes(value.shape, frameAxes, cellRank);
            if (axes.length === 0) return this.invoke(fn, [value]);
            return completed(this.applyToTensorCells(value, fn, axes));
        }
        return this.invoke(fn, [value]);
    }

    private applyToTensorCells(
        value: RankArray,
        fn: Extract<RankValue, { kind: 'function' }>,
        frameAxes: readonly number[],
    ): RankValue {
        const cells = tensorCells(value, frameAxes);
        const frameSize = arraySize(cells.frameShape);
        if (frameSize === 0) {
            const resultShape = fn.monadicResultShape?.(cells.cellShape) ?? [];
            return lazyArray([...cells.frameShape, ...resultShape], () => {
                throw new RankError('empty ranked result has no items');
            });
        }
        if (frameAxes.length === 0) return fn.call([cells.cellAt(0)]);

        const results = new Map<number, RankValue>();
        let resultCellShape: readonly number[] | undefined;
        const resultAt = (frameIndex: number): RankValue => {
            const cached = results.get(frameIndex);
            if (cached !== undefined) return cached;
            const result = fn.call([cells.cellAt(frameIndex)]);
            const shape = isRankArray(result) ? result.shape : [];
            if (resultCellShape === undefined) {
                resultCellShape = [...shape];
            } else if (!sameShape(resultCellShape, shape)) {
                throw new RankError(
                    `rank results must have one shape: ${resultCellShape.join(' ')} and ${shape.join(' ')}`,
                );
            }
            this.ownFiles(result);
            results.set(frameIndex, result);
            return result;
        };
        const outputShape = (): readonly number[] => {
            resultAt(0);
            return [...cells.frameShape, ...resultCellShape!];
        };

        let materialized: RankValue[] | undefined;
        return {
            kind: 'array',
            get shape() {
                return outputShape();
            },
            itemAt(index) {
                outputShape();
                const cellSize = arraySize(resultCellShape!);
                const frameIndex = Math.floor(index / cellSize);
                const result = resultAt(frameIndex);
                return isRankArray(result) ? arrayItem(result, index % cellSize) : result;
            },
            get items() {
                const shape = outputShape();
                materialized ??= Array.from(
                    { length: arraySize(shape) },
                    (_, index) => this.itemAt!(index),
                );
                return materialized;
            },
        };
    }

    private evaluateOuter(operator: string, left: RankValue, right: RankValue): RankValue {
        const a = outerOperand(left, 'left');
        const b = outerOperand(right, 'right');
        const rightSize = arraySize(b.shape);
        return lazyArray([...a.shape, ...b.shape], index => {
            const leftIndex = Math.floor(index / rightSize);
            const rightIndex = index % rightSize;
            return this.evaluateBinary(
                operator,
                arrayItem(a, leftIndex),
                arrayItem(b, rightIndex),
            );
        });
    }

    private evaluateNamedOuter(
        operation: NativeFunction,
        left: RankValue,
        right: RankValue,
    ): RankValue {
        if (!operation.arities.includes(2)) {
            throw new RankError(`outer operation ${operation.name} must accept 2 arguments`);
        }
        const [leftRank, rightRank] = operation.dyadicRanks ?? ['all', 'all'];
        const a = outerCells(left, leftRank, 'left');
        const b = outerCells(right, rightRank, 'right');
        const rightFrames = arraySize(b.frameShape);
        return lazyArray([...a.frameShape, ...b.frameShape], index => {
            const result = operation.call([
                a.cellAt(Math.floor(index / rightFrames)),
                b.cellAt(index % rightFrames),
            ]);
            if (valueRank(result) !== 0) {
                throw new RankError(`outer operation ${operation.name} must return a scalar`);
            }
            this.ownFiles(result);
            return result;
        });
    }

    private evaluateReduction(
        operator: string,
        value: RankValue,
        cellRank?: number,
    ): RankValue {
        if (cellRank === undefined) return this.reduceCell(operator, value);
        if (isRankArray(value)) {
            if (cellRank > value.shape.length) {
                throw new RankError(`rank ${cellRank} exceeds tensor rank ${value.shape.length}`);
            }
            if (cellRank === value.shape.length) return this.reduceCell(operator, value);
            const frameShape = value.shape.slice(0, value.shape.length - cellRank);
            const cellShape = value.shape.slice(value.shape.length - cellRank);
            const cellSize = arraySize(cellShape);
            return lazyArray(frameShape, frameIndex => {
                const start = frameIndex * cellSize;
                return cellRank === 0
                    ? this.reduceCell(operator, arrayItem(value, start))
                    : this.reduceArrayCell(operator, value, start, cellSize);
            });
        }
        if (cellRank > valueRank(value)) {
            throw new RankError(`rank ${cellRank} exceeds value rank ${valueRank(value)}`);
        }
        return this.reduceCell(operator, value);
    }

    private evaluateScan(operator: string, value: RankValue): RankValue {
        if (valueRank(value) !== 1) {
            throw new RankError(`${operator} scan expects a rank-1 value`);
        }
        if (isRankSequence(value) && value.plan.size.kind === 'infinite') {
            throw new RankError(`${operator} scan requires a bounded sequence`);
        }
        const result: RankValue[] = [];
        const operation = numericKernel(operator, (a, b) => this.evaluateBinary(operator, a, b));
        if (isRankArray(value)) {
            const size = arraySize(value.shape);
            if (size === 0) return array(result);
            let accumulated = arrayItem(value, 0);
            result.push(accumulated);
            for (let index = 1; index < size; index += 1) {
                accumulated = operation(accumulated, arrayItem(value, index));
                result.push(accumulated);
            }
            return array(result);
        }
        let accumulated: RankValue | undefined;
        for (const item of reductionValues(value, operator)) {
            accumulated = accumulated === undefined
                ? item
                : operation(accumulated, item);
            result.push(accumulated);
        }
        return { kind: 'array', items: result, shape: [result.length] };
    }

    private evaluateAxisReduction(
        operation: 'sum' | 'mean' | 'std' | 'min' | 'max' | 'all' | 'any' | 'count',
        value: RankValue,
        axes: readonly number[],
    ): RankValue {
        if (!isRankArray(value)) throw new RankError(`${operation} axis expects an array`);
        for (const axis of axes) {
            if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        }
        if (new Set(axes).size !== axes.length) {
            throw new RankError(`${operation} axes must be unique`);
        }

        const selected = new Set(axes);
        const reducedAxes = value.shape.map((_, axis) => axis).filter(axis => selected.has(axis));
        const frameAxes = value.shape.map((_, axis) => axis).filter(axis => !selected.has(axis));
        const reducedShape = reducedAxes.map(axis => value.shape[axis]);
        const frameShape = frameAxes.map(axis => value.shape[axis]);
        const reducer = this.resolve(operation);
        if (!isNativeFunction(reducer)) throw new RankError(`${operation} is not an operation`);

        const strides = value.shape.map(() => 1);
        for (let axis = strides.length - 2; axis >= 0; axis -= 1) {
            strides[axis] = strides[axis + 1] * value.shape[axis + 1];
        }
        const reducedSize = arraySize(reducedShape);
        const offsetAt = (index: number, axes: readonly number[]): number => {
            let offset = 0;
            for (let current = axes.length - 1; current >= 0; current -= 1) {
                const axis = axes[current];
                offset += (index % value.shape[axis]) * strides[axis];
                index = Math.floor(index / value.shape[axis]);
            }
            return offset;
        };
        // Lazy cells must still be fully read before the reducer validates them.
        const directSum = operation === 'sum' && value.itemAt === undefined
            && reducer === this.standardFunctions.get(standardModules.numbers.sum);

        const reduceAt = (frameIndex: number): RankValue => {
            const start = offsetAt(frameIndex, frameAxes);
            const itemAt = (index: number) => arrayItem(value, start + offsetAt(index, reducedAxes));
            if (directSum) return sumIndexed(reducedSize, itemAt);
            const items: RankValue[] = [];
            for (let index = 0; index < reducedSize; index += 1) {
                items.push(itemAt(index));
            }
            return reducer.call([{ kind: 'array', items, shape: reducedShape }]);
        };

        return frameShape.length === 0 ? reduceAt(0) : lazyArray(frameShape, reduceAt);
    }

    private reduceCell(operator: string, value: RankValue): RankValue {
        if (isRankArray(value)) return this.reduceArrayCell(operator, value, 0, arraySize(value.shape));
        if (isRankSequence(value)) {
            const planned = value.plan.reduce?.(operator);
            if (planned !== undefined) return planned;
        }
        const values = reductionValues(value, operator);
        const first = values.next();
        if (first.done) return reductionIdentity(operator);
        let result = first.value;
        const operation = numericKernel(operator, (a, b) => this.evaluateBinary(operator, a, b));
        for (let next = values.next(); !next.done; next = values.next()) {
            result = operation(result, next.value);
        }
        return result;
    }

    private reduceArrayCell(operator: string, value: RankArray, start: number, size: number): RankValue {
        if (size === 0) return reductionIdentity(operator);
        const operation = numericKernel(operator, (a, b) => this.evaluateBinary(operator, a, b));
        let result = arrayItem(value, start);
        const end = start + size;
        for (let index = start + 1; index < end; index += 1) {
            result = operation(result, arrayItem(value, index));
        }
        return result;
    }

    private evaluateUnary(operator: string, value: RankValue): RankValue {
        if (operator === 'not' && isRankSequenceMask(value)) {
            return sequenceMask(value.source, {
                name: `not ${value.predicate.name}`,
                test: item => !value.predicate.test(item),
            });
        }
        if (isRankArray(value)) {
            return {
                kind: 'array',
                items: value.items.map(item => this.evaluateUnary(operator, item)),
                shape: value.shape,
            };
        }
        if (operator === 'not' && typeof value === 'boolean') {
            return !value;
        }
        if ((operator === '+' || operator === '-')
            && (typeof value === 'bigint' || typeof value === 'number')) {
            return operator === '+' ? value : -value;
        }
        throw new RankError(`operator ${operator} does not accept ${typeName(value)}`);
    }

    private evaluateBinary(
        operator: string,
        left: RankValue,
        right: RankValue,
        rangeStep?: RankValue,
    ): RankValue {
        if (operator === 'min' || operator === 'max') {
            this.requireModule('numbers', operator);
        }
        if (operator === 'is') {
            if (!isRankLabel(right)) {
                throw new RankError('is expects a type symbol on the right');
            }
            if (!RUNTIME_TYPE_NAMES.has(right.name)) {
                throw new RankError(`unknown type symbol: .${right.name}`);
            }
            return typeName(left) === right.name;
        }
        if (operator === '+' && typeof left === 'string' && typeof right === 'string') {
            return left + right;
        }
        if (operator === 'to' || operator === 'until') {
            if (isRankSequence(left)) {
                if (rangeStep !== undefined) {
                    throw new RankError('by applies only to numeric ranges');
                }
                return boundSequence(left, expectInteger(right), operator === 'to');
            }
            this.requireModule('ranges', operator);
            return makeRange(
                expectInteger(left),
                expectInteger(right),
                operator === 'to',
                rangeStep === undefined ? undefined : expectInteger(rangeStep),
            );
        }
        if ((isRankSequenceMask(left) || isRankSequenceMask(right))
            && ['and', 'or', 'xor'].includes(operator)) {
            return this.combineSequenceMasks(operator, left, right);
        }
        if (operator === 'in') {
            if (typeof left === 'string' && typeof right === 'string') {
                return right.includes(left);
            }
            if (isRankObject(right) && typeof left === 'string') {
                return right.entries.has(left);
            }
            if (isRankIndex(right)) return right.entries.has(indexKey([left]));
            if (isRankSet(right)) return right.entries.has(setValueKey(left));
            if (isRankMultiset(right)) return right.has(left);
            if (isRankSequence(right)) {
                const planned = right.plan.contains?.(left);
                if (planned !== undefined) return planned;
                if (right.plan.size.kind === 'infinite') {
                    throw new RankError('in requires bounded sequence or membership support');
                }
                for (const item of right.plan.iterate()) {
                    if (equalValues(left, item)) return true;
                }
                return false;
            }
            throw new RankError('in expects text, an object, index, set, multiset or sequence on the right');
        }
        if (isRankSequence(left) || isRankSequence(right)) {
            if (isPredicateOperator(operator)) {
                return this.sequenceComparison(operator, left, right);
            }
            return mapBinary(left, right, operator, (a, b) => this.evaluateBinary(operator, a, b));
        }
        if (isRankArray(left) || isRankArray(right) || isRankQueue(left) || isRankQueue(right)) {
            return mapBinary(left, right, operator, (a, b) => this.evaluateBinary(operator, a, b));
        }
        if (operator === 'equal' || operator === 'notequal') {
            const equal = equalValues(left, right);
            return operator === 'equal' ? equal : !equal;
        }
        if (operator === 'and' || operator === 'or' || operator === 'xor') {
            const a = expectBoolean(left);
            const b = expectBoolean(right);
            if (operator === 'and') return a && b;
            if (operator === 'or') return a || b;
            return a !== b;
        }
        if (operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
            throw new RankError('+ expects two numeric or two text values');
        }
        if (operator === 'multipleby') {
            this.requireModule('numbers', 'multiple by');
            const dividend = expectInteger(left);
            const divisor = expectInteger(right);
            if (divisor === 0n) throw new RankError('division by zero');
            return dividend % divisor === 0n;
        }
        if (operator === 'less' || operator === 'greater'
            || operator === 'atleast' || operator === 'atmost') {
            const order = compareOrderedValues(left, right, orderedKind(left));
            if (operator === 'less') return order < 0;
            if (operator === 'greater') return order > 0;
            if (operator === 'atleast') return order >= 0;
            return order <= 0;
        }

        const a = expectNumeric(left);
        const b = expectNumeric(right);
        if ((operator === '/' || operator === '//' || operator === '%') && isZero(b)) {
            throw new RankError('division by zero');
        }
        const bothIntegers = typeof a === 'bigint' && typeof b === 'bigint';
        switch (operator) {
            case '+': return bothIntegers ? a + b : Number(a) + Number(b);
            case '-': return bothIntegers ? a - b : Number(a) - Number(b);
            case '*': return bothIntegers ? a * b : Number(a) * Number(b);
            case '**': return power(a, b);
            case '/': return Number(a) / Number(b);
            case '//': return bothIntegers ? floorDivide(a, b) : floorDivideReal(Number(a), Number(b));
            case '%': {
                if (bothIntegers) {
                    const remainder = a % b;
                    return remainder !== 0n && (remainder < 0n) !== (b < 0n)
                        ? remainder + b
                        : remainder;
                }
                const divisor = Number(b);
                const remainder = Number(a) % divisor;
                if (remainder === 0) return divisor < 0 ? -0 : 0;
                return (remainder < 0) !== (divisor < 0) ? remainder + divisor : remainder;
            }
            case 'min': return a < b ? a : b;
            case 'max': return a > b ? a : b;
            default: throw new RankError(`unknown operator: ${operator}`);
        }
    }

    private sequenceComparison(operator: string, left: RankValue, right: RankValue): RankValue {
        if (isRankSequence(left) && isRankSequence(right)) {
            throw new RankError('comparison between two sequences is not implemented');
        }
        const source = isRankSequence(left) ? left : right as RankSequence;
        const scalar = isRankSequence(left) ? right : left;
        const predicate: SequencePredicate = {
            name: operator,
            test: item => expectBoolean(isRankSequence(left)
                ? this.evaluateBinary(operator, item, scalar)
                : this.evaluateBinary(operator, scalar, item)),
        };
        return sequenceMask(source, predicate);
    }

    private combineSequenceMasks(operator: string, left: RankValue, right: RankValue): RankValue {
        if (!isRankSequenceMask(left) || !isRankSequenceMask(right)
            || !['and', 'or', 'xor'].includes(operator)) {
            throw new RankError(`operator ${operator} does not accept sequence masks`);
        }
        if (left.source !== right.source) {
            throw new RankError('cannot combine masks from different sequences');
        }
        return sequenceMask(left.source, {
            name: `${left.predicate.name} ${operator} ${right.predicate.name}`,
            test: value => {
                const a = left.predicate.test(value);
                const b = right.predicate.test(value);
                if (operator === 'and') return a && b;
                if (operator === 'or') return a || b;
                return a !== b;
            },
        });
    }

    private *forEntries(binding: ForBinding, value: RankValue): IterableIterator<ForEntry> {
        const spec = tensorIterationSpec(binding.iterable);
        if (spec) {
            if (!isRankArray(value)) throw new RankError('ranked for iteration expects an array');
            const frameAxes = tensorFrameAxes(value.shape, spec.axes, spec.cellRank);
            validateForBindings(binding.names, frameAxes.length);
            this.declareLoopTypes(binding.names, [
                spec.cellRank === 0 ? typesOf(value.items) : new Set(['array']),
                ...frameAxes.map(() => new Set(['integer'])),
            ]);
            yield* tensorEntries(value, frameAxes);
            return;
        }

        if (isRankObject(value)) {
            validateForBindings(binding.names, 1);
            this.declareLoopTypes(binding.names, [
                typesOf(value.entries.values()),
                new Set(['text']),
            ]);
            for (const [key, item] of value.entries) {
                yield { value: item, indices: [key] };
            }
            return;
        }
        if (isRankArray(value) && value.shape.length > 1) {
            validateForBindings(binding.names, 1);
            this.declareLoopTypes(binding.names, [new Set(['array']), new Set(['integer'])]);
            yield* tensorEntries(value, [0]);
            return;
        }

        validateForBindings(binding.names, 1);
        if (isRankArray(value)) {
            this.declareLoopTypes(binding.names, [typesOf(value.items), new Set(['integer'])]);
        } else if (isRankQueue(value)) {
            this.declareLoopTypes(binding.names, [typesOf(value.items), new Set(['integer'])]);
        } else if (isRankSet(value)) {
            this.declareLoopTypes(binding.names, [
                typesOf(value.entries.values()),
                new Set(['integer']),
            ]);
        } else if (typeof value === 'string') {
            this.declareLoopTypes(binding.names, [new Set(['text']), new Set(['integer'])]);
        }
        let index = 0n;
        for (const item of iterationValues(value)) {
            yield { value: item, indices: [index] };
            index += 1n;
        }
    }

    private declareLoopTypes(
        names: readonly string[],
        candidates: readonly ReadonlySet<string>[],
    ): void {
        const scope = this.localFrame ?? this.variables;
        const typeScope = this.localFrame?.types ?? this.variableTypes;
        names.forEach((name, index) => {
            if (name === '#') return;
            const inferred = candidates[index];
            if (!inferred || inferred.size === 0) return;
            const previous = typeScope.get(name)
                ?? (scope.get(name) !== undefined ? new Set([typeName(scope.get(name)!)]) : undefined);
            if (previous && [...inferred].some(type => !previous.has(type))) {
                throw new RankError(
                    `${name} has type ${formatTypes(previous)} and cannot receive ${formatTypes(inferred)}`,
                );
            }
            typeScope.set(name, previous ?? inferred);
        });
    }

    private requireModule(module: string, operation: string): void {
        if (!this.modules.has(module)) {
            throw new RankError(`${operation} requires: use ${module}`);
        }
    }
}

interface ParsedArguments {
    readonly options: Map<string, string[]>;
    readonly positionals: string[];
}

interface ForBinding {
    readonly names: readonly string[];
    readonly iterable: Expression;
}

interface ForEntry {
    readonly value: RankValue;
    readonly indices: readonly RankValue[];
}

interface TensorIterationSpec {
    readonly source: Expression;
    readonly axes?: readonly number[];
    readonly cellRank: number;
}

function parseArguments(args: readonly string[]): ParsedArguments {
    const options = new Map<string, string[]>();
    const positionals: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--') {
            positionals.push(...args.slice(index + 1));
            break;
        }
        if (!argument.startsWith('--')) {
            positionals.push(argument);
            continue;
        }
        const equals = argument.indexOf('=');
        const name = argument.slice(2, equals < 0 ? undefined : equals);
        if (!name) throw new RankError('empty option name');
        let value = equals < 0 ? undefined : argument.slice(equals + 1);
        if (value === undefined && args[index + 1] !== undefined && !args[index + 1].startsWith('--')) {
            value = args[index + 1];
            index += 1;
        }
        const values = options.get(name) ?? [];
        values.push(value ?? 'true');
        options.set(name, values);
    }
    return { options, positionals };
}

function inputValues(values: string[], valueType: string, many: boolean): RankValue {
    const converted = values.map(value => parseInputValue(valueType, value));
    return many ? array(converted) : converted.at(-1)!;
}

function parseInputValue(valueType: string, value: string): RankValue {
    if (valueType === 'integer') {
        try {
            return BigInt(value);
        } catch {
            throw new RankError(`expected integer input, got: ${value}`);
        }
    }
    if (valueType === 'real') {
        const real = Number(value);
        if (!Number.isFinite(real)) throw new RankError(`expected real input, got: ${value}`);
        return real;
    }
    if (valueType === 'text' || valueType === 'path') return value;
    if (valueType === 'boolean') {
        if (value === 'true') return true;
        if (value === 'false') return false;
        throw new RankError(`expected boolean input, got: ${value}`);
    }
    throw new RankError(`unknown input type: ${valueType}`);
}

function validateInputValue(name: string, valueType: string, value: RankValue): void {
    if (valueType === 'integer' && typeof value === 'bigint') return;
    if (valueType === 'real' && typeof value === 'number') return;
    if ((valueType === 'text' || valueType === 'path') && typeof value === 'string') return;
    if (valueType === 'boolean' && typeof value === 'boolean') return;
    if (!['integer', 'real', 'text', 'path', 'boolean'].includes(valueType)) {
        throw new RankError(`unknown input type: ${valueType}`);
    }
    throw new RankError(`${name} expects ${valueType}, got ${typeName(value)}`);
}

function kebabCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function splitQualified(name: string): [string, string] | undefined {
    const dot = name.indexOf('.');
    return dot < 0 ? undefined : [name.slice(0, dot), name.slice(dot + 1)];
}

function forIteration(
    condition: Expression | undefined,
): ForBinding | undefined {
    if (!condition || !isBinaryExpression(condition) || condition.operator !== 'in') return undefined;
    const bindings = flattenApplication(condition.left);
    if (bindings.length < 1 || !bindings.every(binding =>
        isNameExpression(binding) || isAllAxisExpression(binding))) {
        return undefined;
    }
    return {
        names: bindings.map(binding => isNameExpression(binding) ? binding.name : '#'),
        iterable: condition.right,
    };
}

function tensorIterationSpec(expression: Expression): TensorIterationSpec | undefined {
    const parts = flattenApplication(expression);
    const rankWord = parts.at(-2);
    const rankValue = parts.at(-1);
    if (!rankWord || !rankValue || !isNameExpression(rankWord)
        || rankWord.name !== 'rank' || !isNumberLiteral(rankValue)
        || typeof rankValue.value !== 'bigint') return undefined;

    const cellRank = safeDimension(rankValue.value, 'rank');
    const beforeRank = parts.slice(0, -2);
    const axisPosition = beforeRank.findIndex(part => isNameExpression(part) && part.name === 'axis');
    if (axisPosition < 0) {
        if (beforeRank.length !== 1) return undefined;
        return { source: beforeRank[0], cellRank };
    }
    if (axisPosition !== 1 || beforeRank.length === 2) {
        throw new RankError('axis expects an array followed by one or more axis numbers');
    }
    const axisParts = beforeRank.slice(2);
    return {
        source: beforeRank[0],
        axes: axisParts.map(axis => safeDimension(integerLiteral(axis, 'axis'), 'axis')),
        cellRank,
    };
}

function integerLiteral(expression: Expression, name: string): bigint {
    if (!isNumberLiteral(expression) || typeof expression.value !== 'bigint') {
        throw new RankError(`${name} expects nonnegative integer literals`);
    }
    return expression.value;
}

function safeDimension(value: bigint, name: string): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`${name} is too large: ${value}`);
    }
    return Number(value);
}

function tensorFrameAxes(
    shape: readonly number[],
    specifiedAxes: readonly number[] | undefined,
    cellRank: number,
): readonly number[] {
    if (cellRank > shape.length) {
        throw new RankError(`rank ${cellRank} exceeds tensor rank ${shape.length}`);
    }
    const frameRank = shape.length - cellRank;
    const axes = specifiedAxes ?? Array.from({ length: frameRank }, (_, index) => index);
    if (axes.length !== frameRank) {
        throw new RankError(
            `axis count ${axes.length} plus cell rank ${cellRank} must equal tensor rank ${shape.length}`,
        );
    }
    if (new Set(axes).size !== axes.length) throw new RankError('axis numbers must be unique');
    for (const axis of axes) {
        if (axis >= shape.length) throw new RankError(`axis out of bounds: ${axis}`);
    }
    return axes;
}

function validateForBindings(names: readonly string[], frameRank: number): void {
    if (names.length !== 1 && names.length !== frameRank + 1) {
        throw new RankError(
            `for expects one value name or ${frameRank + 1} value/index names, got ${names.length}`,
        );
    }
}

function* tensorEntries(source: RankArray, frameAxes: readonly number[]): IterableIterator<ForEntry> {
    const frameShape = frameAxes.map(axis => source.shape[axis]);
    const frameSet = new Set(frameAxes);
    const cellAxes = source.shape.map((_, axis) => axis).filter(axis => !frameSet.has(axis));
    const cellShape = cellAxes.map(axis => source.shape[axis]);

    for (const frameCoordinates of coordinates(frameShape)) {
        const fullCoordinates = Array(source.shape.length).fill(0) as number[];
        frameAxes.forEach((axis, position) => {
            fullCoordinates[axis] = frameCoordinates[position];
        });
        const items: RankValue[] = [];
        const cellSize = cellShape.reduce((product, dimension) => product * dimension, 1);
        for (let linear = 0; linear < cellSize; linear++) {
            if (cellShape.length !== cellAxes.length) {
                // A host callback can resize the shared cell shape. Preserve
                // the ordinary missing/extra coordinate behavior in that case.
                const cellCoordinates = coordinatesAt(cellShape, linear);
                cellAxes.forEach((axis, position) => {
                    fullCoordinates[axis] = cellCoordinates[position];
                });
            } else {
                let remaining = linear;
                for (let position = cellShape.length - 1; position >= 0; position--) {
                    fullCoordinates[cellAxes[position]] = remaining % cellShape[position];
                    remaining = Math.floor(remaining / cellShape[position]);
                }
            }
            items.push(source.items[arrayOffset(source.shape, fullCoordinates)]);
        }
        yield {
            value: cellShape.length === 0
                ? items[0]
                : { kind: 'array', items, shape: cellShape },
            indices: frameCoordinates.map(BigInt),
        };
    }
}

function* coordinates(shape: readonly number[]): IterableIterator<number[]> {
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    for (let linear = 0; linear < size; linear += 1) {
        let remaining = linear;
        const result = Array(shape.length).fill(0) as number[];
        for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
            result[axis] = remaining % shape[axis];
            remaining = Math.floor(remaining / shape[axis]);
        }
        yield result;
    }
}

function coordinatesAt(shape: readonly number[], index: number): number[] {
    const result = Array(shape.length).fill(0) as number[];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        result[axis] = index % shape[axis];
        index = Math.floor(index / shape[axis]);
    }
    return result;
}

function arrayOffset(shape: readonly number[], coordinates: readonly number[]): number {
    return coordinates.reduce((offset, coordinate, axis) => offset * shape[axis] + coordinate, 0);
}

function array(items: RankValue[]): RankArray {
    return { kind: 'array', items, shape: [items.length] };
}

function lazyArray(
    shape: readonly number[],
    itemAt: (index: number) => RankValue,
): RankArray {
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        get items() {
            materialized ??= Array.from({ length: arraySize(shape) }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

function arrayItem(source: RankArray, index: number): RankValue {
    return source.itemAt?.(index) ?? source.items[index];
}

function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}

function outerOperand(value: RankValue, side: 'left' | 'right'): RankArray {
    if (isRankArray(value)) return value;
    if (isRankQueue(value)) {
        return { kind: 'array', items: value.items, shape: [value.items.length] };
    }
    if (!isRankSequence(value)) {
        throw new RankError(`outer ${side} operand must be a finite sequence or array`);
    }
    if (value.plan.size.kind === 'infinite') {
        throw new RankError(`outer ${side} operand must be finite`);
    }

    let items: RankValue[] | undefined;
    const values = () => items ??= [...sequenceValues(value, 'outer')];
    const size = value.plan.size.kind === 'exact'
        ? safeDimension(value.plan.size.value, 'outer operand size')
        : values().length;
    return lazyArray([size], index => values()[index]);
}

interface OuterCells {
    readonly frameShape: readonly number[];
    readonly cellAt: (frameIndex: number) => RankValue;
}

interface TensorCells {
    readonly frameShape: readonly number[];
    readonly cellShape: readonly number[];
    readonly cellAt: (frameIndex: number) => RankValue;
}

function tensorCells(source: RankArray, frameAxes: readonly number[]): TensorCells {
    const frameShape = frameAxes.map(axis => source.shape[axis]);
    const frameSet = new Set(frameAxes);
    const cellAxes = source.shape.map((_, axis) => axis).filter(axis => !frameSet.has(axis));
    const cellShape = cellAxes.map(axis => source.shape[axis]);
    return {
        frameShape,
        cellShape,
        cellAt(frameIndex) {
            const sourceCoordinates = Array(source.shape.length).fill(0) as number[];
            coordinatesAt(frameShape, frameIndex).forEach((coordinate, index) => {
                sourceCoordinates[frameAxes[index]] = coordinate;
            });
            if (cellShape.length === 0) {
                return arrayItem(source, arrayOffset(source.shape, sourceCoordinates));
            }
            return lazyArray(cellShape, cellIndex => {
                const coordinates = [...sourceCoordinates];
                coordinatesAt(cellShape, cellIndex).forEach((coordinate, index) => {
                    coordinates[cellAxes[index]] = coordinate;
                });
                return arrayItem(source, arrayOffset(source.shape, coordinates));
            });
        },
    };
}

function outerCells(
    value: RankValue,
    rank: IntrinsicRank,
    side: 'left' | 'right',
): OuterCells {
    const source = outerOperand(value, side);
    const receivesWhole = rank === 'all' || rank >= source.shape.length;
    const cellRank = rank === 'all' ? source.shape.length : Math.min(rank, source.shape.length);
    const frameShape = source.shape.slice(0, source.shape.length - cellRank);
    const cellShape = source.shape.slice(source.shape.length - cellRank);
    const cellSize = arraySize(cellShape);
    return {
        frameShape,
        cellAt(frameIndex) {
            if (receivesWhole) return value;
            const start = frameIndex * cellSize;
            if (cellRank === 0) return arrayItem(source, start);
            return lazyArray(cellShape, index => arrayItem(source, start + index));
        },
    };
}

function makeRange(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
    const step = stride ?? 1n;
    if (step === 0n) throw new RankError('range step must be a nonzero integer');

    const ascending = step > 0n;
    const magnitude = absolute(step);
    const distance = ascending ? end - start : start - end;
    const size = distance < 0n ? 0n : inclusive
        ? distance / magnitude + 1n
        : (distance + magnitude - 1n) / magnitude;
    const within = ascending
        ? (value: bigint) => inclusive ? value <= end : value < end
        : (value: bigint) => inclusive ? value >= end : value > end;
    return sequence({
        name: `${start} ${inclusive ? 'to' : 'until'} ${end}${stride === undefined ? '' : ` by ${stride}`}`,
        size: {
            kind: 'exact',
            value: size,
        },
        *iterate() {
            for (let value = start; within(value); value += step) yield value;
        },
    });
}

function mapTextAtoms(
    value: string,
    operation: (atom: string) => RankValue,
    name: string,
): RankSequence {
    const atoms = [...value];
    return sequence({
        name: `text ${name} rank 0`,
        size: { kind: 'exact', value: BigInt(atoms.length) },
        *iterate() {
            for (const atom of atoms) yield operation(atom);
        },
        at(index) {
            if (index >= BigInt(atoms.length)) return undefined;
            return operation(atoms[Number(index)]);
        },
    });
}

function iterationValues(value: RankValue): Iterable<RankValue> {
    if (value instanceof RankDeque || value instanceof RankHeap) return value.values();
    if (isRankSequence(value)) return sequenceValues(value, 'for');
    if (isRankArray(value)) return value.items;
    if (isRankQueue(value)) return value.items;
    if (isRankSet(value)) return value.entries.values();
    if (isRankMultiset(value)) return value.values();
    if (typeof value === 'string') return [...value];
    throw new RankError(`for expects text or a sequence, got ${typeName(value)}`);
}

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function applySelectors(values: RankValue[], missing?: () => RankValue): RankValue {
    if (values.length === 2 && isRankErrorValue(values[0]) && isRankLabel(values[1])) {
        const [error, field] = values;
        if (field.name === 'Kind') return error.errorKind;
        if (field.name === 'Message') return error.message;
        if (field.name === 'Trace') return error.trace;
        if (field.name === 'Cause') {
            if (error.cause === undefined) throw new MissingValueError('error has no cause');
            return error.cause;
        }
        if (field.name === 'Value') {
            if (error.value === undefined) throw new MissingValueError('error has no value');
            return error.value;
        }
        throw new RankError(`unknown error field: .${field.name}`);
    }
    if (values.length === 2 && isRankRecord(values[0]) && isRankLabel(values[1])) {
        const [record, field] = values;
        const value = record.entries.get(field.name);
        if (value === undefined) {
            throw new MissingValueError(`missing record field: .${field.name}`);
        }
        return value;
    }
    if (values.length === 2 && isRankGraph(values[0])) {
        return values[0].neighbors(values[1]);
    }
    if (values.length === 2 && typeof values[0] === 'string' && typeof values[1] === 'bigint') {
        const atoms = [...values[0]];
        const index = values[1];
        if (index < 0n) throw new RankError('text index must be nonnegative');
        if (index >= BigInt(atoms.length)) {
            throw new MissingValueError(`text index out of bounds: ${index}`);
        }
        return atoms[Number(index)];
    }
    if (values.length === 2 && typeof values[0] === 'string'
        && isCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (values.length === 2 && isRankSequence(values[0]) && typeof values[1] === 'bigint') {
        return atSequence(values[0], values[1]);
    }
    if (values.length === 2 && isRankSequence(values[0]) && isRankSequenceMask(values[1])) {
        const [source, selector] = values;
        if (selector.source !== source) {
            throw new RankError('mask belongs to a different sequence');
        }
        return filterSequence(source, selector.predicate);
    }
    if (values.length === 2 && isRankSequence(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankIndex(values[0])) {
        const value = values[0].entries.get(indexKey(values.slice(1)));
        if (value === undefined) {
            // Missing keys under pad are ordinary sparse reads, not exceptions.
            if (missing) return missing();
            throw new MissingValueError('missing keyed value');
        }
        return value;
    }
    if (isRankCounter(values[0]) && values.length === 2) {
        return values[0].entries.get(setValueKey(values[1]))?.count ?? 0n;
    }
    if (isRankFenwick(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankMultiset(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankObject(values[0])) {
        if (values.length !== 2 || typeof values[1] !== 'string') {
            throw new RankError('object addressing expects one text key');
        }
        const value = values[0].entries.get(values[1]);
        if (value === undefined) throw new MissingValueError(`missing object key: ${values[1]}`);
        return value;
    }
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') {
        const position = values[1];
        if (position < 0n) throw new RankError('queue index must be nonnegative');
        if (values[0] instanceof RankDeque) {
            const item = values[0].at(Number(position));
            if (item === undefined) throw new MissingValueError(`queue index out of bounds: ${position}`);
            return item;
        }
        if (position >= BigInt(values[0].items.length)) {
            throw new MissingValueError(`queue index out of bounds: ${position}`);
        }
        return values[0].items[Number(position)];
    }
    if (values.length === 2 && isRankQueue(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankArray(values[0]) && values.length > 1
        && values.slice(1).every(value => typeof value === 'bigint')) {
        const source = values[0];
        const indices = values.slice(1) as bigint[];
        if (source.shape.length > 0 && indices.length > source.shape.length) {
            const selected = atArray(source, indices.slice(0, source.shape.length));
            return applySelectors([selected, ...indices.slice(source.shape.length)], missing);
        }
        return atArray(source, indices);
    }
    if (values.length === 2 && isRankArray(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankArray(values[0]) && isTensorAddress(values.slice(1))) {
        const source = values[0];
        const selection = tensorSelection(source, values.slice(1));
        if (selection.shape.length === 0) return arrayItem(source, selection.offsetAt(0));
        return lazyArray(selection.shape, index => arrayItem(source, selection.offsetAt(index)));
    }
    const last = values.at(-1);
    if (values.length > 2 && last !== undefined && isRankLabel(last) && last.name !== '#') {
        const receiver = applySelectors(values.slice(0, -1), missing);
        return applySelectors([receiver, last], missing);
    }
    if (values.length !== 2 || !isRankArray(values[0]) || !isRankArray(values[1])) {
        throw new RankError('value application requires a sequence and one selector');
    }

    const [source, selector] = values;
    const sourceSize = arraySize(source.shape);
    if (!sameShape(source.shape, selector.shape)) {
        throw new RankError(`mask shape mismatch: ${source.shape} and ${selector.shape}`);
    }
    if (!selector.items.every(item => typeof item === 'boolean')) {
        throw new RankError('array selector must be a boolean mask');
    }

    const mask = selector.items as boolean[];
    return sequence({
        name: 'array mask selection',
        size: { kind: 'unknown' },
        *iterate() {
            for (let index = 0; index < sourceSize; index += 1) {
                if (mask[index]) yield arrayItem(source, index);
            }
        },
    });
}

function callArguments(
    fn: Extract<RankValue, { kind: 'function' }>,
    values: RankValue[],
    select: (values: RankValue[]) => RankValue = applySelectors,
): RankValue[] {
    if (fn.arities.includes(values.length)) return values;

    const arities = [...fn.arities].sort((left, right) => right - left);
    for (const arity of arities) {
        if (arity < 1 || values.length <= arity) continue;
        const firstLength = values.length - arity + 1;
        const firstParts = values.slice(0, firstLength);
        if (!canApplySelectors(firstParts)) continue;
        return [select(firstParts), ...values.slice(firstLength)];
    }

    return values;
}

function seedableRandom(source?: () => number): SeedableRandom {
    if (source && SEED_RANDOM in source) return source as SeedableRandom;

    let next = source ?? Math.random;
    const random = (() => next()) as SeedableRandom;
    Object.defineProperty(random, SEED_RANDOM, {
        value(seed: bigint) {
            next = randomFromSeed(seed);
        },
    });
    return random;
}

function canApplySelectors(values: RankValue[]): boolean {
    if (values.length < 2) return false;
    if (values.length === 2 && isRankGraph(values[0])) return true;
    if (values.length === 2 && typeof values[0] === 'string'
        && typeof values[1] === 'bigint') return true;
    if (values.length === 2 && typeof values[0] === 'string'
        && isCollectionSelector(values[1])) return true;
    if (values.length === 2 && isRankSequence(values[0])
        && typeof values[1] === 'bigint') return true;
    if (values.length === 2 && isRankSequence(values[0])
        && isRankSequenceMask(values[1])) {
        return values[0] === values[1].source;
    }
    if (values.length === 2 && isRankSequence(values[0])
        && isIntegerCollectionSelector(values[1])) return true;
    if (values.length === 2 && isRankArray(values[0]) && isRankArray(values[1])) {
        return values[1].items.every(item => typeof item === 'bigint')
            || (sameShape(values[0].shape, values[1].shape)
                && values[1].items.every(item => typeof item === 'boolean'));
    }
    if (values.length === 2 && isRankArray(values[0])
        && (typeof values[1] === 'string' || isRankLabel(values[1]))) return true;
    if (isRankArray(values[0]) && isRankSequence(values[1])) return true;
    if (isRankIndex(values[0]) && values.length > 1) return true;
    if (isRankCounter(values[0]) && values.length === 2) return true;
    if (isRankFenwick(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankMultiset(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankObject(values[0]) && values.length === 2
        && typeof values[1] === 'string') return true;
    if (isRankRecord(values[0]) && values.length === 2
        && isRankLabel(values[1])) return true;
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') return true;
    if (isRankQueue(values[0]) && isIntegerCollectionSelector(values[1])) return true;
    if (isRankArray(values[0]) && values.length > 1
        && values.slice(1).every(value => typeof value === 'bigint')) return true;
    if (isRankArray(values[0]) && isTensorAddress(values.slice(1))) return true;
    const last = values.at(-1);
    if (values.length > 2 && last !== undefined && isRankLabel(last) && last.name !== '#') {
        return canApplySelectors(values.slice(0, -1));
    }
    return false;
}

interface TensorSelection {
    readonly shape: readonly number[];
    offsetAt(index: number): number;
}

function isAllAxisSelector(value: RankValue): boolean {
    return value === ALL_AXIS;
}

function isTensorAddress(selectors: readonly RankValue[]): boolean {
    if (selectors.length === 0) return false;
    if (!selectors.every(selector =>
        isAllAxisSelector(selector)
        || typeof selector === 'bigint'
        || isCollectionSelector(selector))) return false;
    return selectors.some(isAllAxisSelector)
        || (selectors.length > 1 && selectors.some(isCollectionSelector));
}

function tensorSelection(source: RankArray, selectors: readonly RankValue[]): TensorSelection {
    if (selectors.length > source.shape.length) {
        throw new RankError(`array expects at most ${source.shape.length} selectors`);
    }
    const axes = source.shape.map((size, axis) => {
        const selector = selectors[axis] ?? ALL_AXIS;
        if (isAllAxisSelector(selector)) {
            return { preserve: true, size, indexAt: (coordinate: number) => coordinate };
        }
        if (typeof selector === 'bigint') {
            if (selector < 0n) {
                throw new RankError(`array index must be nonnegative on axis ${axis}`);
            }
            if (selector >= BigInt(size)) {
                throw new MissingValueError(`array index out of bounds on axis ${axis}: ${selector}`);
            }
            return { preserve: false, size: 1, indexAt: () => Number(selector) };
        }
        if (typeof selector === 'number') {
            throw new RankError(`array index must be an integer on axis ${axis}`);
        }
        const indices = selectorIndices(selector, size, axis);
        return {
            preserve: true,
            size: indices.length,
            indexAt: (coordinate: number) => indices[coordinate],
        };
    });
    const shape = axes.filter(axis => axis.preserve).map(axis => axis.size);
    return {
        shape,
        offsetAt(index) {
            const output = coordinatesAt(shape, index);
            let outputAxis = 0;
            const sourceCoordinates = axes.map(axis => {
                if (!axis.preserve) return axis.indexAt(0);
                return axis.indexAt(output[outputAxis++]);
            });
            return arrayOffset(source.shape, sourceCoordinates);
        },
    };
}

function atArray(source: RankArray, indices: readonly bigint[]): RankValue {
    if (indices.length > source.shape.length) {
        throw new RankError(`array expects at most ${source.shape.length} indices`);
    }
    let offset = 0;
    for (let axis = 0; axis < indices.length; axis += 1) {
        const index = indices[axis];
        const size = source.shape[axis];
        if (index < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (index >= BigInt(size)) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
        }
        const stride = source.shape.slice(axis + 1).reduce((product, value) => product * value, 1);
        offset += Number(index) * stride;
    }
    if (indices.length === source.shape.length) return arrayItem(source, offset);
    const shape = source.shape.slice(indices.length);
    return lazyArray(shape, index => arrayItem(source, offset + index));
}

function sliceValue(
    source: RankValue,
    axis: number,
    start: bigint,
    end: bigint,
    inclusive: boolean,
): RankValue {
    const size = axisSize(source, axis);
    const indices = sliceIndices(size, start, end, inclusive);
    return selectAxis(source, axis, array(indices));
}

function sliceIndices(
    size: number,
    start: bigint,
    end: bigint,
    inclusive: boolean,
): bigint[] {
    if (start < 0n || end < 0n) throw new RankError('slice bounds must be nonnegative');
    const stop = inclusive ? end + 1n : end;
    if (start > BigInt(size) || stop > BigInt(size)) {
        throw new RankError(`slice ${start} ${inclusive ? 'to' : 'until'} ${end} exceeds axis size ${size}`);
    }
    if (stop <= start) return [];
    const result: bigint[] = [];
    for (let position = start; position < stop; position += 1n) result.push(position);
    return result;
}

function selectAxis(source: RankValue, axis: number, selector: RankValue): RankValue {
    const size = axisSize(source, axis);
    if (isRankArray(source)) {
        const selectors = Array(axis).fill(ALL_AXIS) as RankValue[];
        selectors.push(selector);
        const selection = tensorSelection(source, selectors);
        if (selection.shape.length === 0) return arrayItem(source, selection.offsetAt(0));
        return lazyArray(selection.shape, index => arrayItem(source, selection.offsetAt(index)));
    }
    if (typeof selector === 'bigint') {
        if (selector < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (selector >= BigInt(size)) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${selector}`);
        }
        if (typeof source === 'string') return [...source][Number(selector)];
        if (isRankSequence(source)) return atSequence(source, selector);
        if (isRankQueue(source)) return source.items[Number(selector)];
    }
    const indices = selectorIndices(selector, size, axis);
    if (typeof source === 'string') {
        const atoms = [...source];
        return indices.map(index => atoms[index]).join('');
    }
    if (isRankSequence(source)) {
        return array(indices.map(index => atSequence(source, BigInt(index))));
    }
    if (!isRankQueue(source)) throw new RankError(`selection does not accept ${typeName(source)}`);
    return array(indices.map(index => source.items[index]));
}

function axisSize(source: RankValue, axis: number): number {
    if (typeof source === 'string') {
        if (axis !== 0) throw new RankError(`text has no axis ${axis}`);
        return [...source].length;
    }
    if (isRankSequence(source)) {
        if (axis !== 0) throw new RankError(`sequence has no axis ${axis}`);
        if (source.plan.size.kind !== 'exact') {
            throw new RankError('sequence selection requires an exact finite size');
        }
        return safeDimension(source.plan.size.value, 'sequence size');
    }
    if (isRankQueue(source)) {
        if (axis !== 0) throw new RankError(`queue has no axis ${axis}`);
        return source.items.length;
    }
    if (!isRankArray(source)) throw new RankError(`selection does not accept ${typeName(source)}`);
    if (axis >= source.shape.length) throw new RankError(`array has no axis ${axis}`);
    return source.shape[axis];
}

function selectorIndices(selector: RankValue, size: number, axis: number): number[] {
    const values = isRankArray(selector)
        ? selector.items
        : isRankQueue(selector)
            ? selector.items
            : isRankSequence(selector)
                ? [...sequenceValues(selector, 'selection')]
                : undefined;
    if (!values) throw new RankError('selection expects an array, queue or finite sequence');
    if (isRankArray(selector) && selector.shape.length !== 1) {
        throw new RankError('axis selector must have rank 1');
    }
    if (values.length === 0) return [];
    if (values.every(value => typeof value === 'boolean')) {
        if (values.length !== size) {
            throw new RankError(`mask length ${values.length} does not match axis ${axis} size ${size}`);
        }
        return values.flatMap((value, index) => value ? [index] : []);
    }
    if (!values.every(value => typeof value === 'bigint')) {
        throw new RankError('axis selector must contain only integers or only booleans');
    }
    return values.map(value => {
        const index = value as bigint;
        if (index < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (index >= BigInt(size)) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
        }
        return Number(index);
    });
}

function isCollectionSelector(value: RankValue): boolean {
    return isRankArray(value) || isRankQueue(value) || isRankSequence(value);
}

function isIntegerCollectionSelector(value: RankValue): boolean {
    if (isRankSequence(value)) return true;
    if (!isRankArray(value) && !isRankQueue(value)) return false;
    return value.items.every(item => typeof item === 'bigint');
}

function memoScalarKey(value: RankValue): string {
    if (typeof value === 'number' && Object.is(value, -0)) return 'number:-0';
    if (typeof value !== 'object') return `${typeof value}:${value}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    throw new RankError('memo arguments and results must be scalar values');
}

function assignmentOperator(operator: string): string {
    return operator.slice(0, -1);
}

type FunctionPlacement = 'top' | 'function' | 'block';

function validateFunctionPlacement(
    statements: readonly Statement[],
    placement: FunctionPlacement,
): void {
    for (const statement of statements) {
        if (isFunctionStatement(statement)) {
            if (placement === 'block') {
                throw new RankError('a local function must be declared directly inside a function');
            }
            validateFunctionPlacement(statement.statements, 'function');
        } else if (isTestStatement(statement)) {
            validateFunctionPlacement(statement.statements, 'top');
        } else if (isIfStatement(statement)) {
            validateFunctionPlacement(statement.thenStatements, 'block');
            for (const clause of statement.elifClauses) {
                validateFunctionPlacement(clause.statements, 'block');
            }
            validateFunctionPlacement(statement.elseStatements, 'block');
        } else if (isForStatement(statement)) {
            validateFunctionPlacement(statement.statements, 'block');
        } else if (isTryStatement(statement)) {
            validateFunctionPlacement(statement.statements, 'block');
            for (const clause of statement.catches) {
                validateFunctionPlacement(clause.statements, 'block');
            }
            validateFunctionPlacement(statement.finallyStatements, 'block');
        }
    }
}

function* reductionValues(value: RankValue, operation: string): IterableIterator<RankValue> {
    if (isRankArray(value)) {
        for (let index = 0; index < arraySize(value.shape); index += 1) {
            yield arrayItem(value, index);
        }
        return;
    }
    if (isRankQueue(value)) {
        yield* value.items;
        return;
    }
    if (typeof value === 'string') {
        yield* value;
        return;
    }
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError(`${operation} reduce requires a bounded sequence`);
        }
        yield* value.plan.iterate();
        return;
    }
    yield value;
}

function reductionIdentity(operator: string): RankValue {
    if (operator === '+') return 0n;
    if (operator === '*') return 1n;
    if (operator === 'and') return true;
    if (operator === 'or' || operator === 'xor') return false;
    throw new RankError(`${operator} reduce does not define a value for an empty cell`);
}

function valueRank(value: RankValue): number {
    if (isRankArray(value)) return value.shape.length;
    if (isRankSequence(value) || isRankQueue(value) || typeof value === 'string') return 1;
    return 0;
}

function mapBinary(
    left: RankValue,
    right: RankValue,
    name: string,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankValue {
    const scalarOperation = numericKernel(name, operation);
    if (isRankSequence(left) && isRankSequence(right)) {
        return zipSequences(left, right, name, scalarOperation);
    }
    if (isRankSequence(left)) {
        return mapSequence(left, name, item => scalarOperation(item, right));
    }
    if (isRankSequence(right)) {
        return mapSequence(right, name, item => scalarOperation(left, item));
    }
    const leftArray = asRankArray(left);
    const rightArray = asRankArray(right);
    if (leftArray && rightArray) {
        return mapBroadcastArrays(leftArray, rightArray, scalarOperation);
    }
    const source = leftArray ?? rightArray!;
    return lazyArray(source.shape, index => {
        const item = arrayItem(source, index);
        return leftArray ? scalarOperation(item, right) : scalarOperation(left, item);
    });
}

function asRankArray(value: RankValue): RankArray | undefined {
    if (isRankArray(value)) return value;
    if (isRankQueue(value)) return { kind: 'array', items: value.items, shape: [value.items.length] };
    return undefined;
}

function sameShape(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length
        && left.every((dimension, index) => dimension === right[index]);
}

function assertTestExpression(value: RankValue): void {
    const failed = typeof value === 'boolean'
        ? !value
        : isRankArray(value)
            && value.items.every(item => typeof item === 'boolean')
            && value.items.some(item => item === false);
    if (failed) throw new RankError('boolean test expression evaluated to false');
}

function isPredicateOperator(operator: string): boolean {
    return ['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'multipleby']
        .includes(operator);
}

interface InlineSlice {
    readonly source: Expression;
    readonly axis?: bigint;
    readonly start: Expression;
    readonly end: Expression;
    readonly inclusive: boolean;
}

function inlineSlice(expression: Expression): InlineSlice | undefined {
    if (!isBinaryExpression(expression)
        || (expression.operator !== 'to' && expression.operator !== 'until')) return undefined;
    const parts = flattenApplication(expression.left);
    const base = { end: expression.right, inclusive: expression.operator === 'to' };
    if (parts.length === 3 && isNamed(parts[1], 'from')) {
        return { ...base, source: parts[0], start: parts[2] };
    }
    if (parts.length === 5 && isNamed(parts[1], 'axis')
        && isNumberLiteral(parts[2]) && typeof parts[2].value === 'bigint'
        && isNamed(parts[3], 'from')) {
        return {
            ...base,
            source: parts[0],
            axis: parts[2].value,
            start: parts[4],
        };
    }
    return undefined;
}

function explicitAxisSelection(
    parts: Expression[],
): { source: Expression; axis: number; selector: Expression } | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'axis')
        || !isNumberLiteral(parts[2]) || typeof parts[2].value !== 'bigint') return undefined;
    return {
        source: parts[0],
        axis: safeDimension(parts[2].value, 'axis'),
        selector: parts[3],
    };
}

function explicitAxisLength(
    parts: Expression[],
): { source: Expression; axis: number } | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'len') || !isNamed(parts[2], 'axis')) {
        return undefined;
    }
    return {
        source: parts[0],
        axis: safeDimension(integerLiteral(parts[3], 'len axis'), 'len axis'),
    };
}

function explicitAxisArgsort(
    parts: Expression[],
): { source: Expression; axis: number } | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'argsort')
        || !isNamed(parts[2], 'axis')) return undefined;
    return {
        source: parts[0],
        axis: safeDimension(integerLiteral(parts[3], 'argsort axis'), 'argsort axis'),
    };
}

function explicitAxisShuffle(
    parts: Expression[],
): { source: Expression; seed?: Expression; axis: number } | undefined {
    const shuffle = parts.findIndex(part => isNamed(part, 'shuffle'));
    if (shuffle < 0 || !isNamed(parts[shuffle + 1], 'axis')) return undefined;
    if ((shuffle !== 1 && shuffle !== 2) || parts.length !== shuffle + 3) {
        throw new RankError('shuffle axis expects data, an optional seed and one axis');
    }
    return {
        source: parts[0],
        seed: shuffle === 2 ? parts[1] : undefined,
        axis: safeDimension(integerLiteral(parts[shuffle + 2], 'shuffle axis'), 'shuffle axis'),
    };
}

function explicitAxisReduction(
    parts: Expression[],
): {
    source: Expression;
    operation: 'sum' | 'mean' | 'std' | 'min' | 'max' | 'all' | 'any' | 'count';
    axes: readonly number[];
} | undefined {
    if (parts.length < 4) return undefined;
    const operation = isNameExpression(parts[1]) ? parts[1].name : undefined;
    if ((operation !== 'sum' && operation !== 'mean' && operation !== 'std'
        && operation !== 'min' && operation !== 'max'
        && operation !== 'all' && operation !== 'any' && operation !== 'count')
        || !isNamed(parts[2], 'axis')) return undefined;
    return {
        source: parts[0],
        operation,
        axes: parts.slice(3).map(axis =>
            safeDimension(integerLiteral(axis, `${operation} axis`), `${operation} axis`)),
    };
}

function explicitAxisMetric(
    parts: Expression[],
): {
    left: Expression;
    right: Expression;
    metric: 'mse' | 'mae';
    axes: readonly number[];
} | undefined {
    if (parts.length < 4 || !isNamed(parts[3], 'axis')) return undefined;
    const metric = isNameExpression(parts[2]) ? parts[2].name : undefined;
    if (metric !== 'mse' && metric !== 'mae') return undefined;
    if (parts.length < 5) {
        throw new RankError(`${metric} axis expects one or more axes`);
    }
    return {
        left: parts[0],
        right: parts[1],
        metric,
        axes: parts.slice(4).map(axis =>
            safeDimension(integerLiteral(axis, `${metric} axis`), `${metric} axis`)),
    };
}

function explicitAxisTranspose(
    parts: Expression[],
): { source: Expression; axes: readonly number[] } | undefined {
    if (parts.length < 4 || !isNamed(parts[1], 'transpose')
        || !isNamed(parts[2], 'axis')) return undefined;
    return {
        source: parts[0],
        axes: parts.slice(3).map(axis =>
            safeDimension(integerLiteral(axis, 'transpose axis'), 'transpose axis')),
    };
}

interface AxisMatmulApplication {
    readonly left: Expression;
    readonly right: Expression;
    readonly axes: readonly [number, number];
}

function explicitAxisMatmul(parts: Expression[]): AxisMatmulApplication | undefined {
    if (parts.length < 4 || !isNamed(parts[2], 'matmul') || !isNamed(parts[3], 'axis')) {
        return undefined;
    }
    if (parts.length !== 6) {
        throw new RankError('matmul axis expects one axis for each operand');
    }
    return {
        left: parts[0],
        right: parts[1],
        axes: [
            safeDimension(integerLiteral(parts[4], 'matmul axis'), 'matmul axis'),
            safeDimension(integerLiteral(parts[5], 'matmul axis'), 'matmul axis'),
        ],
    };
}

interface AxisCovarianceApplication {
    readonly source: Expression;
    readonly axes: readonly [number, number];
}

interface RoundApplication {
    readonly source: readonly Expression[];
    readonly places: Expression;
}

function explicitSignedRoundApplication(expression: Expression): RoundApplication | undefined {
    if (!isBinaryExpression(expression) || expression.operator !== '-') return undefined;
    const parts = flattenApplication(expression.left);
    if (parts.length < 2 || !isNamed(parts.at(-1)!, 'round')) return undefined;
    return { source: parts.slice(0, -1), places: expression.right };
}

function explicitRoundApplication(parts: Expression[]): RoundApplication | undefined {
    if (parts.length < 3 || !isNamed(parts.at(-2)!, 'round')) return undefined;
    return { source: parts.slice(0, -2), places: parts.at(-1)! };
}

function explicitAxisCovariance(parts: Expression[]): AxisCovarianceApplication | undefined {
    if (parts.length < 3 || !isNamed(parts[1], 'covariance') || !isNamed(parts[2], 'axis')) {
        return undefined;
    }
    if (parts.length !== 5) {
        throw new RankError('covariance axis expects feature and observation axes');
    }
    return {
        source: parts[0],
        axes: [
            safeDimension(integerLiteral(parts[3], 'covariance axis'), 'covariance axis'),
            safeDimension(integerLiteral(parts[4], 'covariance axis'), 'covariance axis'),
        ],
    };
}

function isNamed(expression: Expression, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}

function flattenApplication(expression: Expression): Expression[] {
    if (!isApplicationExpression(expression)) return [expression];
    return [
        ...flattenApplication(expression.head),
        ...expression.arguments.flatMap(flattenApplication),
    ];
}

// Group a completed modified operation before compiling the remaining pipeline.
// These private syntax nodes reuse the existing evaluator; no values are cached.
function applicationParts(parts: Expression[]): Expression {
    if (parts.length === 1) return parts[0];
    return { $type: 'ApplicationExpression', head: parts[0], arguments: parts.slice(1) } as Expression;
}

function continueModified(prefix: Expression, rest: Expression[]): Expression {
    return applicationParts([
        { $type: 'ParenthesizedExpression', value: prefix } as Expression,
        ...rest,
    ]);
}

function modifierPipeline(expression: Expression): Expression | undefined {
    if (isBinaryExpression(expression)) {
        const parts = flattenApplication(expression.right);
        const scan = REDUCE_OPERATORS.has(expression.operator) && isNamed(parts[0], 'scan');
        const reduce = REDUCE_OPERATORS.has(expression.operator) && isNamed(parts[0], 'reduce');
        const outer = OUTER_OPERATORS.has(expression.operator) && isNamed(parts[0], 'outer');
        if (!scan && !reduce && !outer) return undefined;
        const end = reduce && parts[1] && isNamed(parts[1], 'rank') ? 3 : 1;
        if (parts.length <= end) return undefined;
        return continueModified(
            { ...expression, right: applicationParts(parts.slice(0, end)) } as Expression,
            parts.slice(end),
        );
    }
    if (!isApplicationExpression(expression)) return undefined;
    const parts = flattenApplication(expression);
    const rank = parts.findIndex((part, index) => index >= 2 && isNamed(part, 'rank'));
    if (rank >= 0 && parts.length > rank + 2) {
        return continueModified(applicationParts(parts.slice(0, rank + 2)), parts.slice(rank + 2));
    }
    const axis = parts.findIndex((part, index) => index >= 2 && isNamed(part, 'axis'));
    if (axis >= 0) {
        let end = axis + 1;
        while (end < parts.length && isNumberLiteral(parts[end])) end++;
        if (end > axis + 1 && end < parts.length && !isNamed(parts[end], 'rank')) {
            return continueModified(applicationParts(parts.slice(0, end)), parts.slice(end));
        }
    }
    if (parts.length > 4 && isNamed(parts[3], 'outer')) {
        return continueModified(applicationParts(parts.slice(0, 4)), parts.slice(4));
    }
    return undefined;
}

function explicitMaterializePipeline(parts: Expression[]): {
    readonly source: readonly Expression[];
    readonly selector: ArrayExpression;
    readonly steps: readonly ArrayItem[];
} | undefined {
    const position = parts.findIndex((part, index) => index > 0
        && isArrayExpression(part)
        && part.dimensions.length === 0
        && part.items.length > 0
        && part.items.every(item => !item.sign));
    if (position < 0 || position !== parts.length - 1) return undefined;
    const selector = parts[position] as ArrayExpression;
    return { source: parts.slice(0, position), selector, steps: selector.items };
}

function explicitRankApplication(
    parts: Expression[],
): { parts: Expression[]; rank: bigint; axes?: readonly number[] } | undefined {
    const modifier = parts.at(-2);
    const rank = parts.at(-1);
    if (!modifier || !rank || !isNameExpression(modifier) || modifier.name !== 'rank') return undefined;
    if (!isNumberLiteral(rank) || typeof rank.value !== 'bigint') {
        throw new RankError('rank expects a nonnegative integer');
    }
    const beforeRank = parts.slice(0, -2);
    if (beforeRank.length < 2) throw new RankError('rank requires data and a unary operation');
    const axisPosition = beforeRank.findIndex(part => isNamed(part, 'axis'));
    if (axisPosition < 0) return { parts: beforeRank, rank: rank.value };
    if (axisPosition !== 2 || beforeRank.length === 3) {
        throw new RankError(
            'axis rank expects data and a unary operation followed by one or more frame axes',
        );
    }
    return {
        parts: beforeRank.slice(0, axisPosition),
        rank: rank.value,
        axes: beforeRank.slice(axisPosition + 1).map(axis =>
            safeDimension(integerLiteral(axis, 'axis rank'), 'axis rank')),
    };
}

interface NamedOuterApplication {
    readonly left: Expression;
    readonly right: Expression;
    readonly operation: Expression;
}

// Infix extrema are left-associative calls, not builtin dispatch. The ordinary
// application evaluator resolves the name after evaluating both operands.
function explicitExtremeApplication(parts: Expression[]): Expression[] | undefined {
    const first = parts.findIndex((part, index) => index > 0
        && (isNamed(part, 'min') || isNamed(part, 'max')));
    if (first < 0 || first === parts.length - 1) return undefined;

    for (let index = first; index < parts.length; index += 2) {
        const operation = parts[index];
        const right = parts[index + 1];
        const operationName = operation && extremeName(operation);
        if (!operationName) {
            throw new RankError('min/max chains require an operation between each value');
        }
        if (!right) throw new RankError(`${operationName} expects a value on the right`);
    }
    return [
        { $type: 'ParenthesizedExpression', value: applicationParts(parts.slice(0, -2)) } as Expression,
        parts.at(-1)!, parts.at(-2)!,
    ];
}

function extremeName(expression: Expression): 'min' | 'max' | undefined {
    if (!isNameExpression(expression)) return undefined;
    return expression.name === 'min' || expression.name === 'max'
        ? expression.name
        : undefined;
}

function explicitNamedOuterApplication(parts: Expression[]): NamedOuterApplication | undefined {
    if (parts.length !== 4 || !isNamed(parts[3], 'outer')) return undefined;
    return {
        left: parts[0],
        right: parts[1],
        operation: parts[2],
    };
}

interface OuterApplication {
    readonly operator: string;
    readonly left: Expression;
    readonly right: Expression;
}

function explicitOuterApplication(expression: Expression): OuterApplication | undefined {
    if (!isBinaryExpression(expression)
        || !OUTER_OPERATORS.has(expression.operator)
        || !isNamed(expression.right, 'outer')) return undefined;
    const operands = flattenApplication(expression.left);
    if (operands.length !== 2) {
        throw new RankError(`outer expects two operands, got ${operands.length}`);
    }
    return {
        operator: expression.operator,
        left: operands[0],
        right: operands[1],
    };
}

const OUTER_OPERATORS = new Set([
    '+', '-', '*', '**', '/', '//', '%',
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost',
    'and', 'or', 'xor', 'multipleby',
]);

interface ReduceApplication {
    readonly operator: string;
    readonly source: Expression;
    readonly rank?: number;
}

interface ScanApplication {
    readonly operator: string;
    readonly source: Expression;
}

function explicitScanApplication(expression: Expression): ScanApplication | undefined {
    if (!isBinaryExpression(expression) || !REDUCE_OPERATORS.has(expression.operator)) {
        return undefined;
    }
    const parts = flattenApplication(expression.right);
    if (parts.length !== 1 || !isNamed(parts[0], 'scan')) return undefined;
    return { operator: expression.operator, source: expression.left };
}

function explicitReduceApplication(expression: Expression): ReduceApplication | undefined {
    if (!isBinaryExpression(expression) || !REDUCE_OPERATORS.has(expression.operator)) {
        return undefined;
    }
    const parts = flattenApplication(expression.right);
    if (parts.length === 1 && isNamed(parts[0], 'reduce')) {
        return { operator: expression.operator, source: expression.left };
    }
    if (parts.length !== 3 || !isNamed(parts[0], 'reduce') || !isNamed(parts[1], 'rank')) {
        return undefined;
    }
    return {
        operator: expression.operator,
        source: expression.left,
        rank: safeDimension(integerLiteral(parts[2], 'rank'), 'rank'),
    };
}

const REDUCE_OPERATORS = new Set(['+', '-', '*', '**', '/', '//', '%', 'and', 'or', 'xor']);

interface AxisWindowApplication {
    readonly source: Expression;
    readonly size: Expression;
    readonly axes: readonly number[];
}

interface MultisetMethodApplication {
    readonly receiver: Expression[];
    readonly operation: 'floor' | 'ceiling' | 'lowerbound' | 'upperbound';
    readonly argument: Expression[];
}

interface CollectionMutationApplication {
    readonly receiver: Expression;
    readonly operation: 'add' | 'remove';
    readonly value: Expression;
    readonly arguments?: readonly Expression[];
}

function explicitCollectionMutation(
    expression: Expression,
): CollectionMutationApplication | undefined {
    if (isBinaryExpression(expression)) {
        const mutation = explicitCollectionMutation(expression.left);
        if (!mutation) return undefined;
        return {
            ...mutation,
            value: { ...expression, left: mutation.value } as Expression,
            arguments: undefined,
        };
    }
    if (!isApplicationExpression(expression)) return undefined;
    const parts = flattenApplication(expression);
    const receiver = parts[0];
    const operation = parts[1];
    if (!isNameExpression(receiver)
        || !/^[A-Z]/.test(receiver.name)
        || parts.length < 3) return undefined;
    if (!isNameExpression(operation)
        || (operation.name !== 'add' && operation.name !== 'remove')) return undefined;
    const values = parts.slice(2);
    const value = values.length === 1 ? values[0] : {
        $type: 'ApplicationExpression',
        head: values[0],
        arguments: values.slice(1),
    } as Expression;
    return {
        receiver,
        operation: operation.name,
        value,
        arguments: values,
    };
}

function explicitMultisetMethod(parts: Expression[]): MultisetMethodApplication | undefined {
    const operations = ['floor', 'ceiling', 'lowerbound', 'upperbound'] as const;
    const position = parts.findIndex((part, index) =>
        index > 0 && index < parts.length - 1
        && operations.some(operation => isNamed(part, operation)));
    if (position < 0) return undefined;
    const operation = operations.find(candidate => isNamed(parts[position], candidate))!;
    return {
        receiver: parts.slice(0, position),
        operation,
        argument: parts.slice(position + 1),
    };
}

interface GraphEdgesApplication {
    readonly receiver: Expression;
    readonly operation: Expression;
    readonly argument: Expression;
}

function explicitGraphEdges(parts: Expression[]): GraphEdgesApplication | undefined {
    if (parts.length !== 3 || !isNamed(parts[1], 'edges')) return undefined;
    return {
        receiver: parts[0],
        operation: parts[1],
        argument: parts[2],
    };
}

function explicitAxisWindow(parts: Expression[]): AxisWindowApplication | undefined {
    if (parts.length < 5 || !isNamed(parts[2], 'window') || !isNamed(parts[3], 'axis')) {
        return undefined;
    }
    return {
        source: parts[0],
        size: parts[1],
        axes: parts.slice(4).map(axis =>
            safeDimension(integerLiteral(axis, 'window axis'), 'window axis')),
    };
}

function expectInteger(value: RankValue): bigint {
    if (typeof value !== 'bigint') {
        throw new RankError(`expected integer, got ${typeName(value)}`);
    }
    return value;
}

function expectNumeric(value: RankValue): bigint | number {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        throw new RankError(`expected number, got ${typeName(value)}`);
    }
    return value;
}

function isZero(value: bigint | number): boolean {
    return value === 0n || value === 0;
}

function power(base: bigint | number, exponent: bigint | number): bigint | number {
    if (isZero(base) && exponent < 0) {
        throw new RankError('zero cannot be raised to a negative power');
    }
    if (typeof base === 'bigint' && typeof exponent === 'bigint' && exponent >= 0n) {
        return base ** exponent;
    }
    const result = Number(base) ** Number(exponent);
    if (Number.isNaN(result)) throw new RankError('power result is not real');
    return result;
}

function floorDivideReal(left: number, right: number): number {
    const remainder = left % right;
    // Derive the quotient from the remainder so rounding near an integer
    // boundary cannot make // disagree with %.
    let quotient = (left - remainder) / right;
    if (remainder !== 0 && (remainder < 0) !== (right < 0)) quotient -= 1;
    if (quotient === 0) {
        const ratio = left / right;
        return ratio < 0 || Object.is(ratio, -0) ? -0 : 0;
    }
    const floor = Math.floor(quotient);
    return quotient - floor > 0.5 ? floor + 1 : floor;
}

function floorDivide(left: bigint, right: bigint): bigint {
    const quotient = left / right;
    const remainder = left % right;
    return remainder !== 0n && (left < 0n) !== (right < 0n)
        ? quotient - 1n
        : quotient;
}

function expectBoolean(value: RankValue): boolean {
    if (typeof value !== 'boolean') {
        throw new RankError(`expected boolean, got ${typeName(value)}`);
    }
    return value;
}

function equalValues(left: RankValue, right: RankValue): boolean {
    return equalNestedValues(left, right, new WeakMap());
}

function equalNestedValues(
    left: RankValue,
    right: RankValue,
    compared: WeakMap<object, WeakSet<object>>,
): boolean {
    if ((typeof left === 'bigint' || typeof left === 'number')
        && (typeof right === 'bigint' || typeof right === 'number')) {
        if (typeof left === typeof right) return left === right;
        const integer = typeof left === 'bigint' ? left : right as bigint;
        const real = typeof left === 'number' ? left : right as number;
        return Number.isFinite(real) && Number.isInteger(real) && integer === BigInt(real);
    }
    if (typeof left !== 'object' || typeof right !== 'object') {
        return left === right;
    }
    if (left.kind === 'label' && right.kind === 'label') {
        return left.name === right.name;
    }
    if (isRankArray(left) && isRankArray(right)) {
        if (!sameShape(left.shape, right.shape)) return false;
        if (alreadyCompared(left, right, compared)) return true;
        const size = arraySize(left.shape);
        for (let index = 0; index < size; index += 1) {
            if (!equalNestedValues(arrayItem(left, index), arrayItem(right, index), compared)) {
                return false;
            }
        }
        return true;
    }
    if (isRankRecord(left) && isRankRecord(right)) {
        if (left.entries.size !== right.entries.size) return false;
        if (alreadyCompared(left, right, compared)) return true;
        for (const [name, value] of left.entries) {
            const other = right.entries.get(name);
            if (other === undefined || !equalNestedValues(value, other, compared)) return false;
        }
        return true;
    }
    return left === right;
}

function alreadyCompared(
    left: object,
    right: object,
    compared: WeakMap<object, WeakSet<object>>,
): boolean {
    const matches = compared.get(left);
    if (matches?.has(right)) return true;
    if (matches) matches.add(right);
    else compared.set(left, new WeakSet([right]));
    return false;
}

function typeName(value: RankValue): string {
    if (value instanceof RankDeque) return value.mode;
    if (typeof value === 'number') return 'real';
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'string') return 'text';
    if (typeof value !== 'object') return typeof value;
    return value.kind === 'label' ? 'symbol' : value.kind;
}

const RUNTIME_TYPE_NAMES = new Set([
    'integer',
    'real',
    'boolean',
    'text',
    'array',
    'bytes',
    'symbol',
    'object',
    'record',
    'file',
    'error',
    'index',
    'queue',
    'deque',
    'stack',
    'set',
    'counter',
    'multiset',
    'fenwick',
    'heap',
    'function',
    'sequence',
]);

function typesOf(values: Iterable<RankValue>): ReadonlySet<string> {
    return new Set([...values].map(typeName));
}

function formatTypes(types: ReadonlySet<string>): string {
    return [...types].sort().join(' or ');
}

function containedFiles(value: RankValue | undefined): Set<RankFile> {
    const files = new Set<RankFile>();
    if (isKnownFileFree(value)) return files;
    const seen = new Set<object>();
    const pending: Iterator<RankValue | undefined>[] = [[value].values()];
    const captures = function* (scopes: readonly ReadonlyMap<string, RankValue>[]): IterableIterator<RankValue> {
        for (const scope of scopes) yield* scope.values();
    };
    while (pending.length > 0) {
        const next = pending[pending.length - 1].next();
        if (next.done) {
            pending.pop();
            continue;
        }
        const item = next.value;
        if (isKnownFileFree(item) || item === undefined || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);
        if (isRankFile(item)) {
            files.add(item);
        } else if (isRankArray(item) && item.containsFiles === false) {
            continue;
        } else if (item instanceof RankDeque || item instanceof RankHeap) {
            pending.push(item.values());
        } else if (isRankArray(item) || isRankQueue(item)) {
            pending.push(item.items.values());
        } else if (isRankIndex(item) || isRankSet(item)
            || isRankObject(item) || isRankRecord(item)) {
            pending.push(item.entries.values());
        } else if (isRankCounter(item)) {
            pending.push(Array.from(item.entries.values(), entry => entry.value).values());
        } else if (isRankErrorValue(item)) {
            pending.push([item.value, item.cause].values());
        } else if (isNativeFunction(item)) {
            if (item.captures) pending.push(captures(item.captures));
        } else if (isRankSequence(item)) {
            if (item.plan.captures) pending.push(captures(item.plan.captures));
        }
    }
    return files;
}
