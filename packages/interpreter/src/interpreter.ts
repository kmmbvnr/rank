import { checkpoint, InterruptedError, inspectionEnabled } from './interrupt.js';
import { AstUtils, type AstNode } from 'langium';
import { nameMask } from './array-mask.js';
import { FlatRecords } from './flat.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { allValid, isPresentAt, maskedCells, typedArray, createArraySnapshot, ownedArray, readArrayItem, arrayForWrite, noteArrayBinding, enterRuntime, leaveRuntime } from './array-storage.js';
import { ByteArray } from './bytes.js';
import { isPureHostFunction } from './host-effects.js';
import { typedNativeCall } from './typed-native.js';
import { compileTensorCellCopy } from './tensor-cell-compiler.js';
import { compileIntegerLoop } from './integer-loop.js';
import { compileBlock, type CompiledBlock } from './block-compiler.js';
import { compileScalarExpression } from './scalar-compiler.js';
import { compileTensorKernel } from './tensor-kernel.js';
import {
    completed, emit, flatMapResult, mapExecution, mapPair, mapResult, resume, runExecution, type Evaluation, type Execution,
} from './execution.js';
import { BindingEnvironment } from './binding-environment.js';
import { FunctionInvocation } from './function-invocation.js';
import { ApplicationEvaluator, integerLiteral, isNamed } from './eval/application.js';
import type { InterpreterOptions, RankTestResult } from './interpreter-options.js';
import { DebugInspection } from './debug-inspection.js';
import { BuiltinRegistry, reseed, seedableRandom, type SeedableRandom } from './modules/builtins.js';
import { locateError, registerSource } from './source-location.js';
import { Operators, arraySize, expectInteger } from './operators.js';
import {
    applySelectors, maskSelection, selectValues, unpackApplicationItems,
} from './value-selection.js';
import { BREAK_SIGNAL, BreakSignal, CONTINUE_SIGNAL, ContinueSignal, ReturnSignal } from './control-signals.js';
import { compileKeyedTableExpression } from './keyed-table-expression.js';
import { compileTableExpression } from './table-query-expression.js';
import { compileClauseExpression, isBoundCondition, type ClauseExpressionContext } from './clause-expression.js';
import { prepareIfStatement, prepareTryStatement,
    type ExecutionContext, type LoopControl } from './statement-control.js';
import { addToCollection, expectAddCollection, newStructure, removeFromCollection } from './collections.js';
import { RankDeque, RankHeap, pushCollection } from './containers.js';
import { argumentSignature } from './return-contract.js';
import { checkRecordField, recordContract, retainRecordContract } from './record-contract.js';
import { ResourceMap } from './resource-summary.js';
import { ResourceOwnership } from './resource-ownership.js';
import { inputDeclarationName, inputValues, kebabCase, parseArguments, validateInputValue } from './cli-args.js';
import { ReductionEvaluator } from './reduction.js';
import { RankApplication, tensorFrameAxes } from './rank-application.js';
import {
    ALL_AXIS, atArray, scalarArrayWriteOffset, tensorSelection,
} from './selectors.js';
import { arrayOffset, coordinatesAt, safeDimension, sameShape } from './tensor-index.js';
import {
    nameNeedsExecution, requiresDataOperand, flattenApplication, isAddStatement,
    isAliasedTableExpression,
    isAllAxisExpression,
    isArrayAssignmentStatement,
    isArrayExpression,
    isTextBlockExpression,
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
    isRecordUpdateExpression,
    isRunStatement,
    isReturnStatement,
    isKeyedSortExpression,
    isKeyedGroupExpression,
    isKeyedRollingExpression,
    isKeyedJoinExpression,
    isKeyedReachExpression,
    isStdinExpression,
    isStringLiteral,
    isTestStatement,
    isTryStatement,
    isUnaryExpression,
    isUnpackExpression,
    isUnpackStatement,
    isUseStatement,
    isYieldStatement,
    type AddressItem,
    type ArrayItem,
    type Expression,
    type FunctionStatement,
    type Program,
    type Statement,
    applicationForm, findOperation, availableBuiltin, builtinBindingDiagnostics, builtinBindingMessage,
    bindingTypeMessage,
} from '@arrrank/language';
import { MissingValueError, RankError } from './errors.js';
import {
    RankPersistentSumSegment,
    RankRangeSumSegment,
} from './segment.js';
import { graphConstructor } from './graph.js';
import { dsuFrom } from './dsu.js';
import { indexKey } from './index-key.js';
import { standardModules } from './modules/index.js';
import {
    sortByItems,
    sortByKeys,
} from './modules/sequences.js';
import { writeTable } from './table-access.js';
import { sortTable } from './table-ops.js';
import { RankArrowTable } from './arrow-table.js';
import {
    materializeSqlite,
    materializeSqliteExpression, sortSqlite,
} from './modules/sqlite.js';
import { parse } from './parser.js';
import {
    materializeSequence,
    sequence,
    sequenceValues,
} from './sequence.js';
import {
    formatValue,
    expectBoolean,
    isNativeFunction,
    isRankArray,
    isRankBytes,
    isRankCounter,
    isRankFenwick,
    isRankGraph,
    isRankIndex,
    isRankLabel,
    isRankMultiset,
    isRankObject,
    isRankSqliteExpression,
    isRankSqliteTable,
    isRankTable,
    isRankTableAlias,
    isRankQueue,
    isRankRecord,
    isRankSet,
    isRankSequence,
    MISSING,
    isRankSegment,
    type RankArray,
    type RankCounter,
    type NativeFunction,
    type RankIndex,
    type RankQueue,
    type RankRecord,
    type RankSet,
    type RankSequence,
    type RankValue,
    typeName,
} from './value.js';

type Output = (text: string) => void;

/** Detach the ordinary mutable values a preview function can reach. */
function clonePreviewValue(value: RankValue): RankValue {
    if (typeof value !== 'object') return value;
    if (isRankBytes(value)) return new ByteArray(value.data.slice());
    if (isRankArray(value)) {
        const size = value.shape.reduce((product, dimension) => product * dimension, 1);
        return ownedArray(Array.from({ length: size }, (_, index) =>
            clonePreviewValue(readArrayItem(value, index))), value.shape, false, value.columnNames);
    }
    if (isRankIndex(value)) return { kind: 'index', entries: new Map([...value.entries]
        .map(([key, item]) => [key, clonePreviewValue(item)])) };
    if (isRankQueue(value)) return { kind: 'queue', items: value.items.map(clonePreviewValue) };
    if (isRankSet(value)) return { kind: 'set', entries: new Map([...value.entries]
        .map(([key, item]) => [key, clonePreviewValue(item)])) };
    if (isRankCounter(value)) return { kind: 'counter', entries: new Map([...value.entries]
        .map(([key, item]) => [key, { value: clonePreviewValue(item.value), count: item.count }])) };
    if (isRankObject(value)) return { kind: 'object', entries: new Map([...value.entries]
        .map(([key, item]) => [key, clonePreviewValue(item)])) };
    if (isRankRecord(value)) {
        const copy: RankRecord = { kind: 'record', entries: new Map([...value.entries]
            .map(([key, item]) => [key, clonePreviewValue(item)])), types: new Map(value.types) };
        retainRecordContract(copy, recordContract(value));
        return copy;
    }
    return value;
}

interface LoadedProgram {
    readonly id: string;
    readonly program: Program;
}

interface TensorGroup { readonly count: number; run(): RankValue | undefined }
type PreparedStatement = (
    | { readonly run: (context: ExecutionContext) => RankValue | undefined }
    | { readonly stream: (context: ExecutionContext) => Evaluation<RankValue | undefined> }
) & { readonly tensor?: TensorGroup };

const NO_INDICES: readonly RankValue[] = [];

export class Interpreter {
    readonly variables = new Map<string, RankValue>();
    readonly modules = new Set<string>(['core']);
    private readonly bindings = new BindingEnvironment(this.variables, this.modules);
    private readonly operators = new Operators(this.modules, value => this.resources.ownFiles(value));
    readonly testResults: RankTestResult[] = [];
    private readonly output: Output;
    private readonly baseOptions: InterpreterOptions;
    get options(): InterpreterOptions {
        return inspectionEnabled() ? { ...this.baseOptions,
            integerLoopCompilation: false,
            scalarFunctionCompilation: false,
            scalarEntryCompilation: false,
            blockCompilation: false,
            scalarCompilation: false,
            tensorFusion: false,
            functionBodyCompilation: false,
        } : this.baseOptions;
    }
    private readonly random: SeedableRandom;
    private readonly openPrograms = new Map<string, LoadedProgram>();
    private readonly aliases = new Map<string, Interpreter>();
    private currentRunTarget: LoadedProgram | undefined;
    private pendingArgs: string[] | undefined;
    private loadedProgram: LoadedProgram | undefined;
    private readonly statements = new WeakMap<Statement, PreparedStatement>();
    private readonly debugStatements = new WeakMap<Statement, PreparedStatement>();
    private readonly functionBodies = new WeakMap<FunctionStatement, Map<string, CompiledBlock<ExecutionContext> | null>>();
    private readonly blocks = new WeakMap<Statement[], CompiledBlock<ExecutionContext> | null>();
    private readonly expressions = new WeakMap<Expression, () => Evaluation<RankValue>>();
    private readonly builtins: BuiltinRegistry;
    private readonly reductions: ReductionEvaluator;
    private readonly rankApplication: RankApplication;
    private readonly resources = new ResourceOwnership();
    private readonly inspection = new DebugInspection(this.bindings, () => this.options.sourceId ?? '<input>');
    private readonly functions: FunctionInvocation;
    private readonly application: ApplicationEvaluator;

    constructor(output: Output = console.log, options: InterpreterOptions = {}) {
        this.output = output;
        this.baseOptions = options;
        this.random = seedableRandom(options.random);
        this.builtins = new BuiltinRegistry(this.modules, {
            output,
            io: options.io,
            md5: options.md5,
            random: this.random,
            seedRandom: seed => reseed(this.random, seed),
            ownFile: file => this.resources.ownFile(file),
        });
        this.functions = new FunctionInvocation(this.bindings, this.resources, this.builtins, this.inspection,
            this.modules, () => this.options, {
                compileDirect: expression => this.compileDirectExpression(expression),
                compiled: (statement, arguments_) => this.compiledFunctionBody(statement, arguments_),
                execute: (statements, generator) => this.executeStatementStream(statements, false, false, false, generator),
                locate: (error, node) => this.locateError(error, node),
            });
        this.reductions = new ReductionEvaluator(
            (operator, left, right) => this.operators.evaluateBinary(operator, left, right),
            name => this.resolve(name), this.builtins.functions, () => this.options.tensorFusion !== false,
        );
        this.rankApplication = new RankApplication(
            (fn, args) => this.invoke(fn, args),
            value => this.resources.ownFiles(value), this.builtins.functions,
        );
        this.application = new ApplicationEvaluator({
            evaluate: expression => this.evaluateTask(expression),
            compileDirect: expression => this.compileDirectExpression(expression),
            compile: (expression, missing, tail, classify) => this.compileExpression(expression, missing, tail, classify),
            evaluateArrayItem: item => this.evaluateArrayItem(item),
            operationOf: name => this.applicationOperation(name),
            resolve: name => this.resolve(name),
            select: (values, missing) => this.select(values, missing),
            requireModule: (module, operation) => this.requireModule(module, operation),
            random: this.random,
            operators: this.operators,
            reductions: this.reductions,
            rankApplication: this.rankApplication,
            builtins: this.builtins,
            resources: this.resources,
            functions: this.functions,
        });
    }

    execute(source: string, syntheticNames: ReadonlySet<string> = new Set()): RankValue | undefined {
        enterRuntime();
        const previous = this.syntheticNames;
        this.syntheticNames = syntheticNames;
        try { return this.executeSource(source); }
        finally { this.syntheticNames = previous; leaveRuntime(); }
    }

    private syntheticNames: ReadonlySet<string> = new Set();

    private executeSource(source: string): RankValue | undefined {
        const program = parse(source, this.options.sourceId, {
            bindings: new Map([...this.variables].map(([name, value]) => [name, isNativeFunction(value) ? value.arities : false])),
        }, new Set(this.variables.keys()), this.syntheticNames);
        registerSource(program, this.options.sourceId ?? '<input>');
        this.loadedProgram = {
            id: this.options.sourceId ?? '<input>',
            program,
        };
        if (this.options.persistentResources) {
            this.resources.ensureScope();
            return this.executeProgram(program, this.options.args ?? []);
        }
        return this.resources.withResourceScope(
            () => this.executeProgram(program, this.options.args ?? []),
            false,
        );
    }

    /** Register notebook function cells without executing any statements or bodies. */
    declareFunctionSource(source: string): string[] {
        const program = parse(source, this.options.sourceId, {
            bindings: new Map([...this.variables].map(([name, value]) => [name, isNativeFunction(value) ? value.arities : false])),
        }, new Set(this.variables.keys()));
        registerSource(program, this.options.sourceId ?? '<input>');
        validateFunctionPlacement(program.statements, 'top');
        this.checkBuiltinBindings(program);
        this.declareFunctions(program.statements);
        return program.statements.filter(isFunctionStatement).map(statement => statement.name);
    }

    /** Includes inferred global types whose declaration has not produced a value yet. */
    bindingNames(): ReadonlySet<string> {
        return this.bindings.globals.names();
    }

    /** Assignment contracts for editor diagnostics, copied without exposing runtime state. */
    bindingTypeNames(name: string): readonly string[] | undefined {
        const types = this.bindings.globals.typeOf(name);
        return types === undefined ? undefined : [...types];
    }

    bindingArrayRank(name: string): number | undefined {
        return this.bindings.globals.rankOf(name);
    }

    /** Copy the current bindings without rerunning the program that produced them. */
    forkForPreview(output: Output = this.output): Interpreter {
        const { wrapSinglePassSequence: _singlePass, wrapStoredSequence: _stored,
            persistentResources: _persistent, ...options } = this.options;
        const fork = new Interpreter(output, options);
        for (const module of this.modules) fork.modules.add(module);
        for (const name of this.bindings.sourceBindings) fork.bindings.sourceBindings.add(name);
        fork.bindings.globals.adoptContracts(this.bindings.globals);
        for (const [name, child] of this.aliases) fork.aliases.set(name, child.forkForPreview(output));
        for (const [name, value] of this.variables) {
            const source = isNativeFunction(value) ? this.functions.sourceOf(value) : undefined;
            if (source && isNativeFunction(value)) fork.functions.adoptSource(value, source);
            const definition = isNativeFunction(value) ? this.functions.definitionOf(value) : undefined;
            if (!definition || definition.context) fork.variables.set(name, clonePreviewValue(value));
        }
        // Rebuild top-level user functions so their calls use the fork rather than
        // the original interpreter captured by the function object.
        for (const value of this.variables.values()) {
            const definition = isNativeFunction(value) ? this.functions.definitionOf(value) : undefined;
            if (definition && !definition.context) fork.functions.define(definition.statement);
        }
        return fork;
    }

    /** A notebook can replace declarations without relaxing assignment type checks. */
    forgetBindings(names: Iterable<string>): void {
        this.bindings.forget(names);
    }

    dispose(): void {
        for (const child of this.aliases.values()) child.dispose();
        this.resources.dispose();
    }

    executeProgram(
        program: Program,
        args: readonly string[] = [],
        assertBooleanExpressions = false,
    ): RankValue | undefined {
        validateFunctionPlacement(program.statements, 'top');
        this.checkBuiltinBindings(program);
        this.declareFunctions(program.statements);
        this.prepareInputs(program, args);
        return this.executeStatements(program.statements, assertBooleanExpressions);
    }

    private declareFunctions(statements: readonly Statement[]): void {
        for (const statement of statements) {
            if (isFunctionStatement(statement)) this.functions.define(statement);
        }
    }

    private checkBuiltinBindings(program: Program, modules = this.modules): void {
        const existing: (string | FunctionStatement)[] = [...this.bindings.sourceBindings, ...this.aliases.keys()];
        for (const value of this.variables.values()) {
            const statement = isNativeFunction(value) ? this.functions.sourceOf(value) : undefined;
            if (statement) existing.push(statement);
        }
        const diagnostic = builtinBindingDiagnostics(program, modules, existing)[0];
        if (diagnostic) throw this.locateError(new RankError(diagnostic.message, diagnostic.kind),
            diagnostic.node as Statement);
    }

    private prepareModule(program: Program): void {
        validateFunctionPlacement(program.statements, 'top');
        this.checkBuiltinBindings(program);
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
        loopControl?: LoopControl,
    ): Evaluation<RankValue | undefined> {
        // Ordinary blocks keep their compact context; only protected blocks
        // need to carry the additional tail-call flag.
        const context: ExecutionContext = tailCallsAllowed
            ? { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator, loopControl }
            : { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator, loopControl, tailCallsAllowed: false };
        const block = this.compiledBlock(statements);
        if (block) return block(context);
        let result: RankValue | undefined;
        let index = 0;
        try {
            for (; index < statements.length; index += 1) {
                checkpoint();
                const prepared = this.preparedStatement(statements, index);
                if (prepared.tensor && !context.insideFinally && !context.insideGenerator) {
                    const value = prepared.tensor.run();
                    if (value !== undefined) {
                        result = value;
                        index += prepared.tensor.count - 1;
                        continue;
                    }
                }
                if ('run' in prepared) {
                    result = prepared.run(context);
                } else {
                    const task = prepared.stream(context);
                    if ('done' in task) result = task.value;
                    else return this.continueStatementStream(statements, index, context, task);
                }
                if (loopControl?.signal) return completed(result);
            }
        } catch (error) {
            throw this.locateError(error, statements[index]);
        }
        return completed(result);
    }

    private compiledBlock(statements: Statement[]): CompiledBlock<ExecutionContext> | undefined {
        if (this.options.blockCompilation !== false && statements.length >= 2 && statements.length <= 64) {
            let block = this.blocks.get(statements);
            if (block === undefined) {
                block = compileBlock<ExecutionContext>(statements.length, {
                    prepare: index => this.preparedStatement(statements, index),
                    locate: (error, index) => this.locateError(error, statements[index]),
                    pause: (index, task, context, compiled) => this.continueCompiledBlock(
                        statements, index, task, context, compiled),
                    compiled: this.options.onBlockCompiled,
                    executed: this.options.onBlockExecuted,
                }) ?? null;
                this.blocks.set(statements, block);
            }
            return block ?? undefined;
        }
        return undefined;
    }

    private compiledFunctionBody(statement: FunctionStatement, arguments_: RankValue[]): CompiledBlock<ExecutionContext> | undefined {
        if (this.options.functionBodyCompilation === false) return undefined;
        let instances = this.functionBodies.get(statement);
        if (!instances) this.functionBodies.set(statement, instances = new Map());
        const signature = argumentSignature(arguments_);
        let body = instances.get(signature);
        if (body === undefined) {
            const commands = statement.statements;
            const last = commands.at(-1);
            body = last && isReturnStatement(last) && last.value ? compileBlock<ExecutionContext>(commands.length, {
                prepare: index => {
                    if (index !== commands.length - 1) return this.preparedStatement(commands, index);
                    const tensor = this.preparedStatement(commands, index).tensor;
                    const direct = this.compileDirectExpression(last.value!);
                    if (direct) return { run: direct, tensor };
                    let candidate = last.value!;
                    while (isParenthesizedExpression(candidate)) candidate = candidate.value;
                    const value = isApplicationExpression(candidate)
                        ? this.compileExpression(last.value!, undefined, true)
                        : () => this.evaluateTask(last.value!);
                    return { stream: value, tensor };
                },
                locate: (error, index) => this.locateError(error, commands[index]),
                pause: (index, task, context, compiled) => this.continueCompiledBlock(commands, index, task, context, compiled),
                compiled: this.options.onFunctionBodyCompiled,
                executed: this.options.onFunctionBodyExecuted,
            }) ?? null : null;
            instances.set(signature, body);
        }
        return body ?? undefined;
    }

    private prepareLoopBody(
        statements: Statement[], context: ExecutionContext, iterable: boolean, loopControl?: LoopControl,
    ): () => Evaluation<RankValue | undefined> {
        const block = this.compiledBlock(statements);
        const tailCallsAllowed = iterable ? false : context.tailCallsAllowed !== false;
        if (block) {
            const bodyContext: ExecutionContext = tailCallsAllowed
                ? { ...context, insideLoop: true, loopControl }
                : { ...context, insideLoop: true, loopControl, tailCallsAllowed: false };
            return () => block(bodyContext);
        }
        return () => this.executeStatementStream(statements, context.assertBooleanExpressions,
            true, context.insideFinally, context.insideGenerator, tailCallsAllowed, loopControl);
    }

    private *continueCompiledBlock(
        statements: Statement[], index: number, task: Execution<RankValue | undefined>,
        context: ExecutionContext, block: CompiledBlock<ExecutionContext>,
    ): Execution<RankValue | undefined> {
        try {
            const value = (yield { task }) as RankValue | undefined;
            if (context.loopControl?.signal) return value;
            const next = block(context, index + 1, value);
            return 'done' in next ? next.value : (yield { task: next }) as RankValue | undefined;
        } catch (error) { throw this.locateError(error, statements[index]); }
    }

    private preparedStatement(statements: Statement[], index: number): PreparedStatement {
        const statement = statements[index];
        this.inspection.point(statement);
        const cache = inspectionEnabled() ? this.debugStatements : this.statements;
        let prepared = cache.get(statement);
        if (!prepared) {
            prepared = this.prepareStatement(statement);
            if ((isForStatement(statement) || isIfStatement(statement) || isTryStatement(statement))
                && !insideLoop(statement)) {
                const names = blockNames(statement, this.syntheticNames);
                const known = alwaysFresh(statement, names);
                prepared = this.scopeBlock(prepared, [...names.filter(name => known.has(name)),
                    ...names.filter(name => !known.has(name))], known.size);
            }
            if (this.options.tensorFusion !== false
                && (isAssignmentStatement(statement) || isReturnStatement(statement))) {
                const tensor = this.prepareTensorGroup(statements, index);
                if (tensor) prepared = { ...prepared, tensor };
            }
            cache.set(statement, prepared);
        }
        return prepared;
    }

    // A name a block introduces ends with the block, together with its type.
    // Blocks inside a loop keep theirs until the outermost block ends: every
    // iteration then binds a name with the same type, and the block-scope check
    // has already rejected every read that could see a value kept that long.
    // The first `known` names are provably unbound on entry and skip the lookup.
    private scopeBlock(prepared: PreparedStatement, names: readonly string[], known: number): PreparedStatement {
        if (names.length === 0 || !('stream' in prepared)) return prepared;
        // A bit per name marks the ones this run introduces, without allocating;
        // a block with more names than bits groups them into words.
        if (names.length > 30) {
            let wrapped: PreparedStatement = prepared;
            for (let index = 0; index < names.length; index += 30) {
                wrapped = this.scopeBlock(wrapped, names.slice(index, index + 30),
                    Math.min(30, Math.max(0, known - index)));
            }
            return wrapped;
        }
        const interpreter = this;
        const inner = prepared.stream;
        const release = (fresh: number) => {
            for (let index = 0; fresh !== 0; index += 1, fresh >>>= 1) {
                if (fresh & 1) interpreter.bindings.unbind(names[index]);
            }
        };
        const proven = known === 0 ? 0 : (1 << known) - 1;
        return { ...prepared, stream: context => {
            let fresh = proven;
            for (let index = known; index < names.length; index += 1) {
                if (interpreter.findVariable(names[index]) === undefined) fresh |= 1 << index;
            }
            if (fresh === 0) return inner(context);
            let task: Evaluation<RankValue | undefined>;
            try { task = inner(context); } catch (error) { release(fresh); throw error; }
            if ('done' in task) { release(fresh); return task; }
            return (function* (): Execution<RankValue | undefined> {
                try { return yield* resume(task); } finally { release(fresh); }
            })();
        } };
    }

    // Eligibility is prepared with the statement itself. Ordinary scalar
    // statements incur no additional name lookup or optimizer-cache lookup.
    private prepareTensorGroup(statements: Statement[], index: number): TensorGroup | undefined {
        const kernel = compileTensorKernel(statements.slice(index), {
            textDigits: this.options.tensorTextDigits !== false,
            lookup: name => this.findVariable(name),
            compiled: this.options.onTensorKernelCompiled,
            builtin: name => {
                const module = ['text', 'integer', 'len', 'sum', 'min', 'max'].includes(name)
                    ? 'core' : name === 'mean' ? 'stats' : 'sequences';
                if (!this.modules.has(module)) return false;
                return this.builtins.is(module, name, this.resolve(name));
            },
        });
        if (!kernel) return recordFallback('tensor:unsupported');
        const last = statements[index + kernel.count - 1];
        if (!isAssignmentStatement(last) && !isReturnStatement(last)) return undefined;
        const assign = isAssignmentStatement(last) ? this.compileAssign(last.name) : undefined;
        return { count: kernel.count, run: () => {
            if (!assign && this.bindings.current === undefined) return undefined;
            const value = kernel.run();
            if (value === undefined) return recordFallback('tensor:entry-guard');
            try { assign?.(value); }
            catch (error) { throw this.locateError(error, last); }
            this.options.onTensorKernelExecuted?.();
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.compiledTensors++;
            if (!assign) throw new ReturnSignal(value);
            return value;
        } };
    }

    private *continueStatementStream(
        statements: Statement[],
        index: number,
        context: ExecutionContext,
        first: Execution<RankValue | undefined>,
    ): Execution<RankValue | undefined> {
        try {
            let result = yield* resume(first);
            if (context.loopControl?.signal) return result;
            for (index += 1; index < statements.length; index += 1) {
                checkpoint();
                const prepared = this.preparedStatement(statements, index);
                if (prepared.tensor && !context.insideFinally && !context.insideGenerator) {
                    const value = prepared.tensor.run();
                    if (value !== undefined) {
                        result = value;
                        index += prepared.tensor.count - 1;
                        continue;
                    }
                }
                result = 'run' in prepared
                    ? prepared.run(context)
                    : yield* resume(prepared.stream(context));
                if (context.loopControl?.signal) return result;
            }
            return result;
        } catch (error) {
            throw this.locateError(error, statements[index]);
        }
    }

    private locateError(error: unknown, node: AstNode): unknown {
        return locateError(error, node, this.options.sourceId ?? '<input>');
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
                interpreter.requireModule('cli', 'args');
                interpreter.pendingArgs = (yield* resume(mapExecution(statement.values, value => interpreter.evaluateTask(value)))).map(formatValue);
                return undefined;
            } };
        }
        if (isOptionStatement(statement)
            || isArgumentStatement(statement)
            || isFlagStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                interpreter.requireModule('cli', inputDeclarationName(statement));
                return undefined;
            } };
        }
        if (isTestStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> {
                interpreter.executeTest(statement.description, statement.statements);
                return undefined;
            } };
        }
        if (isFunctionStatement(statement)) {
            return { stream: function* (): Execution<RankValue | undefined> { return interpreter.functions.define(statement); } };
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
                if (interpreter.bindings.current === undefined) {
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
            const signal = operation === 'break' ? BREAK_SIGNAL : CONTINUE_SIGNAL;
            // Leaving an iteration never suspends, so it needs no task at all.
            return { run: (context): RankValue | undefined => {
                if (context.insideFinally) {
                    throw new RankError(`${operation} is not valid inside finally`);
                }
                if (!context.insideLoop) {
                    throw new RankError(`${operation} is only valid inside a for loop`);
                }
                if (context.loopControl) {
                    context.loopControl.signal = operation;
                    return undefined;
                }
                throw signal;
            } };
        }
        if (isTryStatement(statement) || isIfStatement(statement)) {
            const control = {
                evaluate: (expression: Expression) => this.evaluateTask(expression),
                execute: (statements: Statement[], context: ExecutionContext) => this.executeStatementStream(
                    statements, context.assertBooleanExpressions, context.insideLoop,
                    context.insideFinally, context.insideGenerator, context.tailCallsAllowed, context.loopControl,
                ),
                compileDirect: (expression: Expression) => this.compileDirectExpression(expression),
                assign: (name: string, value: RankValue) => this.assign(name, value),
            };
            return isTryStatement(statement)
                ? prepareTryStatement(statement, control) : prepareIfStatement(statement, control);
        }
        if (isForStatement(statement)) {
            const binding = forIteration(statement.condition);
            const condition = !binding && statement.condition
                ? this.compileDirectExpression(statement.condition) : undefined;
            const interpreter = this;
            // The names a binding writes never change, so each gets its write
            // site once here rather than a name lookup on every iteration.
            const bindValue = binding && binding.names[0] !== '#'
                ? this.compileAssign(binding.names[0]) : undefined;
            const bindIndex = binding
                ? binding.names.slice(1).map(name =>
                    name === '#' ? undefined : this.compileAssign(name))
                : [];
            const reference: PreparedStatement = { stream: function* (context) {
                const { assertBooleanExpressions, insideFinally, insideGenerator } = context;
                // Each loop owns its jumps. Branches share this carrier, while
                // protected try/catch/finally blocks retain exception unwinding.
                const loopControl: LoopControl | undefined = interpreter.options.directLoopControl !== false ? {} : undefined;
                let result: RankValue | undefined;
                let preparedBody: (() => Evaluation<RankValue | undefined>) | undefined;
                if (binding) {
                    const spec = tensorIterationSpec(binding.iterable);
                    const iterable = (yield* resume(interpreter.evaluateTask(spec?.source ?? binding.iterable)));
                    const flat = interpreter.options.directIteration !== false && !spec
                        && !isRankObject(iterable) && !(isRankArray(iterable) && iterable.shape.length > 1);
                    const entries = flat ? interpreter.iterationAtoms(binding, iterable)
                        : interpreter.forEntries(binding, iterable);
                    let ordinal = 0n;
                    for (const entry of entries) {
                        checkpoint();
                        if (flat) {
                            if (bindValue) bindValue(entry as RankValue);
                            if (bindIndex[0]) bindIndex[0](ordinal++);
                        } else {
                            const cell = entry as ForEntry;
                            if (bindValue) bindValue(cell.value);
                            for (let position = 0; position < bindIndex.length; position += 1) {
                                bindIndex[position]?.(cell.indices[position]);
                            }
                        }
                        interpreter.inspection.point(statement, true);
                        try {
                            // A body that finishes on its own needs no task; only
                            // one that suspends goes back to the driver.
                            const body = interpreter.options.loopPreparation !== false
                                ? (preparedBody ??= interpreter.prepareLoopBody(statement.statements, context, true, loopControl))()
                                : interpreter.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                true,
                                insideFinally,
                                insideGenerator,
                                false, // Returning must close this iterator after the callee finishes.
                                loopControl,
                            );
                            const value = 'done' in body
                                ? body.value : (yield { task: body }) as RankValue | undefined;
                            if (loopControl?.signal) {
                                const signal = loopControl.signal;
                                loopControl.signal = undefined;
                                if (signal === 'break') break;
                                continue;
                            }
                            result = value;
                        } catch (error) {
                            if (error instanceof BreakSignal) break;
                            if (error instanceof ContinueSignal) continue;
                            throw error;
                        }
                    }
                } else {
                    for (;;) {
                        checkpoint();
                        interpreter.inspection.point(statement, true);
                        if (statement.condition) {
                            let test: RankValue;
                            if (condition) {
                                test = condition();
                            } else {
                                const task = interpreter.evaluateTask(statement.condition);
                                test = 'done' in task ? task.value : (yield { task }) as RankValue;
                            }
                            if (!expectBoolean(test)) break;
                        }
                        try {
                            const body = interpreter.options.loopPreparation !== false
                                ? (preparedBody ??= interpreter.prepareLoopBody(statement.statements, context, false, loopControl))()
                                : interpreter.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                true,
                                insideFinally,
                                insideGenerator,
                                context.tailCallsAllowed,
                                loopControl,
                            );
                            const value = 'done' in body
                                ? body.value : (yield { task: body }) as RankValue | undefined;
                            if (loopControl?.signal) {
                                const signal = loopControl.signal;
                                loopControl.signal = undefined;
                                if (signal === 'break') break;
                                continue;
                            }
                            result = value;
                        } catch (error) {
                            if (error instanceof BreakSignal) break;
                            if (error instanceof ContinueSignal) continue;
                            throw error;
                        }
                    }
                }
                return result;
            } };
            const compiled = this.options.integerLoopCompilation !== false ? compileIntegerLoop(statement, {
                tensorReadHoisting: this.options.tensorReadHoisting !== false,
                read: name => this.findVariable(name),
                writer: name => this.compileAssign(name),
                prepareWriter: this.options.boundIntegerWrites !== false ? (name, checked) => {
                    let direct: ((value: RankValue) => void) | undefined;
                    return value => {
                        if (direct) { direct(value); return; }
                        checked(value);
                        const frame = this.bindings.current?.find(name);
                        direct = frame ? frame.bindStore(name) : next => { this.variables.set(name, next); };
                    };
                } : undefined,
                textLoops: this.options.textLoopCompilation !== false,
                textArrayLoops: this.options.textArrayLoopCompilation !== false,
                nestedLoops: this.options.nestedLoopCompilation !== false,
                arrayRead: atArray,
                textRead: (source, index) => applySelectors([source, index]) as string,
                returns: this.options.loopReturnCompilation !== false,
                canReturn: () => this.bindings.current !== undefined,
                returnValue: value => { throw new ReturnSignal(value); },
                arrayLocals: this.options.arrayLocalCompilation !== false,
                dimension: checkedArrayDimension,
                booleanArrays: this.options.booleanArrayCompilation !== false,
                booleanLocals: this.options.booleanLoopCompilation !== false,
                scalarText: this.options.scalarTextCompilation !== false,
                nativeCalls: this.options.nativeLoopCompilation !== false,
                builtinCall: (module, name, types) => {
                    if (!this.modules.has(module)) return undefined;
                    // Unknown host callbacks may mutate bindings or re-enter Rank.
                    if (module === 'crypto' && name === 'md5' && this.options.md5
                        && !isPureHostFunction(this.options.md5)) return undefined;
                    try {
                        const value = this.resolve(name);
                        return isNativeFunction(value) && this.builtins.is(module, name, value)
                            ? this.options.typedNativeCalls === false ? value.call : typedNativeCall(value, types)
                            : undefined;
                    } catch { return undefined; }
                },
                scalarFunction: (name, arity) => this.functions.scalarCall(name, arity),
                absolute: this.options.absoluteLoopCompilation !== false,
                extrema: this.options.extremaLoopCompilation !== false,
                extremeParts: flattenApplication,
                compoundWrites: this.options.compoundArrayCompilation !== false,
                arrayIteration: this.options.arrayIterationCompilation !== false,
                // The region guards cell types before entry and preserves them.
                iterationValues: (binding, source, elementType = 'integer') => this.iterationAtoms(binding, source,
                    this.options.provenIterationTypes !== false ? elementType : undefined,
                    this.options.directTextIteration !== false),
                arrayWrites: this.options.arrayWriteCompilation !== false,
                inlineWriteOffsets: this.options.scalarAddressCompilation !== false,
                arrayOffset: this.options.scalarAddressCompilation !== false
                    ? scalarArrayWriteOffset
                    : (source, indices) => tensorSelection(source, indices).offsetAt(0),
                arrayReads: this.options.arrayLoopCompilation !== false,
                iteration: forIteration,
                module: name => this.modules.has(name),
                builtin: (module, name) => {
                    if (!this.modules.has(module)) return false;
                    try { return this.builtins.is(module, name, this.resolve(name)); }
                    catch { return false; }
                },
                locate: (error, command) => this.locateError(error, command),
                compiled: this.options.onIntegerLoopCompiled,
                executed: this.options.onIntegerLoopExecuted,
            }, binding) : undefined;
            if (!compiled) recordFallback(this.options.integerLoopCompilation === false ? 'loop:disabled' : 'loop:unsupported');
            return compiled ? { stream: context => compiled.run(context.insideFinally, context.insideGenerator, context.tailCallsAllowed !== false) ?? reference.stream!(context) } : reference;
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
            const writes = statement.names.map(name =>
                name === '#' ? undefined : this.compileAssign(name));
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
                for (let index = 0; index < writes.length; index += 1) {
                    writes[index]?.(unpacked.items[index]);
                }
                return result;
            } };
        }
        if (isArrayAssignmentStatement(statement)) {
            const general = function* (
                target: RankValue, selectors: RankValue[], evaluated?: RankValue,
            ): Execution<RankValue | undefined> {
                if (isRankTable(target)) {
                    // A table is a value: a write makes a new version and rebinds the name.
                    interpreter.requireModule('tables', 'table assignment');
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    rebind(writeTable(target, selectors, value,
                        statement.operator === '=' ? undefined : assignmentOperator(statement.operator),
                        (operator, left, right) => interpreter.operators.evaluateBinary(operator, left, right)));
                    return value;
                }
                if (isRankIndex(target)) {
                    const key = indexKey(selectors);
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    if (statement.operator === '=') target.entries.set(key, value);
                    else {
                        const previous = target.entries.get(key);
                        if (previous === undefined) throw new MissingValueError('index key not found');
                        target.entries.set(key, interpreter.operators.evaluateBinary(
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
                    const result = statement.operator === '=' ? value : interpreter.operators.evaluateBinary(
                        assignmentOperator(statement.operator), target.at(selectors[0]), value,
                    );
                    if (typeof result !== 'bigint') {
                        throw new RankError('fenwick values must be integers');
                    }
                    target.set(selectors[0], result);
                    return result;
                }
                if (isRankSegment(target)) {
                    if (selectors.length === 2
                        && selectors.every(selector => typeof selector === 'bigint')
                        && (target instanceof RankRangeSumSegment
                            || target instanceof RankPersistentSumSegment)) {
                        const value = yield* resume(interpreter.evaluateTask(statement.value));
                        if (statement.operator === '=') {
                            target.setRange(selectors[0], selectors[1], value);
                        } else if (statement.operator === '+=') {
                            target.addRange(selectors[0], selectors[1], value);
                        } else {
                            throw new RankError('segment + range assignment supports = and +=');
                        }
                        return value;
                    }
                    if (selectors.length !== 1 || typeof selectors[0] !== 'bigint') {
                        throw new RankError('segment assignment expects one integer index');
                    }
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    const result = statement.operator === '=' ? value : interpreter.operators.evaluateBinary(
                        assignmentOperator(statement.operator), target.at(selectors[0]), value,
                    );
                    target.set(selectors[0], result);
                    return result;
                }
                if (target instanceof FlatRecords) {
                    if (selectors.length < 1 || selectors.length > 2 || typeof selectors[0] !== 'bigint') {
                        throw new RankError('flat assignment expects an integer index and optional field');
                    }
                    const index = Number(selectors[0]);
                    const previous = target.itemAt(index);
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    if (selectors.length === 2) {
                        const field = selectors[1];
                        if (!isRankLabel(field)) throw new RankError('flat assignment expects a field label');
                        const result = interpreter.assignRecordField(previous, field.name, statement.operator, value);
                        target.set(index, previous);
                        return result;
                    }
                    if (statement.operator !== '=') throw new RankError('flat record assignment supports =');
                    target.set(index, value);
                    return value;
                }
                const field = selectors.at(-1);
                if (field !== undefined && isRankLabel(field) && field.name !== '#') {
                    let receiver: RankValue = target;
                    for (const selector of selectors.slice(0, -1)) {
                        receiver = interpreter.select([receiver, selector]);
                    }
                    if (isRankArray(receiver)) {
                        interpreter.requireModule('tables', 'table column assignment');
                        if (receiver.shape.length !== 1) {
                            throw new RankError(
                                'table column assignment expects a rank-1 table',
                                'DimensionMismatch',
                            );
                        }
                        const result = yield* resume(interpreter.evaluateTask(statement.value));
                        let operands: RankValue[];
                        if (isRankArray(result)) {
                            if (!sameShape(receiver.shape, result.shape)) {
                                throw new RankError(
                                    `assignment shape mismatch: ${receiver.shape} and ${result.shape}`,
                                    'DimensionMismatch',
                                );
                            }
                            operands = Array.from(
                                { length: arraySize(receiver.shape) },
                                (_, index) => arrayItem(result, index),
                            );
                        } else {
                            operands = Array(arraySize(receiver.shape)).fill(result) as RankValue[];
                        }
                        const rows = Array.from(
                            { length: arraySize(receiver.shape) },
                            (_, index) => arrayItem(receiver, index),
                        );
                        if (!rows.every(isRankObject)) {
                            throw new RankError('table assignment expects object rows', 'TypeError');
                        }
                        const operator = statement.operator === '='
                            ? undefined : assignmentOperator(statement.operator);
                        const replacements = operands.map((operand, index) => {
                            if (operator === undefined) return operand;
                            const previous = rows[index].entries.get(field.name);
                            if (previous === undefined) {
                                throw new MissingValueError(`missing object key: ${field.name}`);
                            }
                            return interpreter.operators.evaluateBinary(operator, previous, operand);
                        });
                        for (let index = 0; index < rows.length; index += 1) {
                            rows[index].entries.set(field.name, replacements[index]);
                        }
                        return result;
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
                // The compiled single-cell form hands its value over when the
                // shape rules have to decide what happens to it.
                const result = evaluated
                    ?? (yield* resume(interpreter.evaluateTask(statement.value)));
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
                    : interpreter.operators.evaluateBinary(
                        operator,
                        target.items[selection.offsetAt(index)],
                        operand,
                    ));
                for (let index = 0; index < replacements.length; index += 1) {
                    target.items[selection.offsetAt(index)] = replacements[index];
                }
                return result;
            };
            // A write is where sharing has to be paid for: shared storage
            // becomes this name's own copy, which the name then keeps.
            const rebind = this.compileAssign(statement.name);
            const owned = (target: RankValue): RankValue => {
                const copy = arrayForWrite(target);
                if (copy === undefined) return target;
                rebind(copy);
                return copy;
            };
            const address = statement.indices.length === 1 ? statement.indices[0] : undefined;
            const directIndex = address && !address.all && !address.sign && !address.spread && address.value
                ? this.compileDirectExpression(address.value) : undefined;
            const directValue = this.compileDirectExpression(statement.value);
            if (directIndex && directValue) {
                // One integer index into a stored vector is the shape dynamic
                // programming writes in its inner loop. It needs no suspendable
                // task, no selector list and no tensor selection; anything that
                // does falls through to the general form with the selector it
                // already evaluated.
                const operator = statement.operator === '='
                    ? undefined : assignmentOperator(statement.operator);
                return { stream: (): Evaluation<RankValue | undefined> => {
                    const target = owned(this.resolveVariable(statement.name));
                    const selector = directIndex();
                    if (typeof selector === 'bigint' && typeof target === 'object'
                        && target.kind === 'array' && target.shape.length === 1
                        && target.itemAt === undefined) {
                        const offset = Number(selector);
                        if (offset >= 0 && offset < target.shape[0]) {
                            const value = directValue();
                            if (isRankArray(value)) return general(target, [selector], value);
                            target.items[offset] = operator === undefined ? value
                                : this.operators.evaluateBinary(operator, target.items[offset], value);
                            return completed(value);
                        }
                    }
                    return general(target, [selector]);
                } };
            }
            return { stream: (): Evaluation<RankValue | undefined> => {
                const target = owned(this.resolveVariable(statement.name));
                // Selectors that all complete hand straight over to the general
                // form, so the usual case adds no second generator to drive.
                return flatMapResult(
                    mapExecution(statement.indices, index => this.evaluateAddressParts(index)),
                    selectors => general(target, selectors.flat()),
                );
            } };
        }
        if (isAssignmentStatement(statement)) {
            const operator = statement.operator === '='
                ? undefined : assignmentOperator(statement.operator);
            const direct = this.compileDirectExpression(statement.value);
            const write = this.compileAssign(statement.name);
            const stored = (value: RankValue): RankValue => isRankSequence(value)
                ? this.options.wrapStoredSequence?.(value) ?? value : value;
            if (direct) {
                return { run: () => {
                    const result = stored(operator === undefined ? direct() : this.operators.evaluateBinary(
                        operator, this.resolveVariable(statement.name), direct(),
                    ));
                    write(result);
                    return result;
                } };
            }
            return { stream: () => {
                const previous = operator === undefined ? undefined : this.resolveVariable(statement.name);
                return mapResult(this.evaluateTask(statement.value), value => {
                    const result = stored(operator === undefined ? value : this.operators.evaluateBinary(operator, previous!, value));
                    write(result);
                    return result;
                });
            } };
        }
        if (isExpressionStatement(statement)) {
            const form = applicationForm(statement.value, name => this.applicationOperation(name), true);
            const mutation = form.kind === 'collection-mutation' ? form : undefined;
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
                    // The receiver decides first. Asking for `use algo` before
                    // knowing the value can take the mutation blames a module for
                    // what is really a receiver that is not a collection at all.
                    const receiver = mutation.operation === 'add'
                        ? expectAddCollection(target) : target;
                    interpreter.requireModule('algo', mutation.operation);
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
            if (!direct && requiresDataOperand(expression)) {
                const evaluate = execute;
                execute = () => mapResult(evaluate(), value => this.checkDataOperand(expression, value));
            }
            this.expressions.set(expression, execute);
        }
        return execute;
    }

    // Arithmetic and conditions with direct operands cannot call
    // Rank functions. Keep those syntax trees synchronous to avoid allocating a task
    // for every atom of a counted loop. Bindings and values remain runtime work.
    private compileDirectExpression(expression: Expression): (() => RankValue) | undefined {
        const evaluate = this.compileDirectValue(expression);
        return evaluate && requiresDataOperand(expression)
            ? () => this.checkDataOperand(expression, evaluate()) : evaluate;
    }

    private checkDataOperand(expression: Expression, value: RankValue): RankValue {
        if (isNativeFunction(value)) throw this.locateError(new RankError(
            'This function has no known signature here. Group its input with parentheses or introduce an intermediate variable.',
            'Syntax',
        ), expression);
        return value;
    }

    private compileDirectValue(expression: Expression): (() => RankValue) | undefined {
        if (this.options.scalarCompilation !== false
            && (isBinaryExpression(expression) || isUnaryExpression(expression))) {
            const compiled = compileScalarExpression(expression, {
                leaf: leaf => this.compileDirectExpression(leaf),
                binary: (op, left, right) => this.operators.evaluateBinary(op, left, right),
                unary: (op, value) => this.operators.evaluateUnary(op, value),
                compiled: this.options.onScalarCompiled,
                executed: this.options.onScalarExecuted,
            });
            if (compiled) return compiled;
        }
        if (isNewStructureExpression(expression)) return () => {
            if (expression.structure === 'graph') {
                this.requireModule('graph', 'new graph');
                return graphConstructor();
            }
            if (expression.structure === 'dsu') {
                this.requireModule('graph', 'new dsu');
                return dsuFrom();
            }
            this.requireModule('algo', 'new');
            return newStructure(expression.structure);
        };
        if (isNumberLiteral(expression) || isBooleanLiteral(expression) || isStringLiteral(expression)) {
            return () => expression.value;
        }
        if (isTextBlockExpression(expression)) {
            const value = expression.parts.join(expression.mode === 'lines' ? '\n' : '');
            return () => value;
        }
        if (isLabelLiteral(expression)) {
            if (expression.name === 'NA') return () => MISSING;
            return () => ({ kind: 'label', name: expression.name });
        }
        if (isNameExpression(expression)) {
            if (nameNeedsExecution(expression)) return undefined;
            const name = expression.name;
            let layout: Map<string, number> | undefined;
            let slot: number | undefined;
            return () => {
                const frame = this.bindings.current;
                if (frame) {
                    if (layout !== frame.layout || slot === undefined) {
                        layout = frame.layout;
                        slot = layout.get(name);
                    }
                    if (slot !== undefined) {
                        const value = frame.read(slot, name);
                        if (value !== undefined) {
                            return this.directNameValue(value);
                        }
                    }
                }
                return this.directNameValue(this.resolve(name));
            };
        }
        if (isParenthesizedExpression(expression)) return this.compileDirectExpression(expression.value);
        if (isUnaryExpression(expression)) {
            const operand = this.compileDirectExpression(expression.operand);
            return operand ? () => this.operators.evaluateUnary(expression.operator, operand()) : undefined;
        }
        if (isBinaryExpression(expression) && expression.operator !== 'default'
            && expression.operator !== '**'
            // `Values till not even` tests each item; its right side is no value.
            && !((expression.operator === 'to' || expression.operator === 'till') && isBoundCondition(expression.right))
            && !isNamed(expression.right, 'reduce')
            && !isNamed(expression.right, 'scan')
            && !isNamed(expression.right, 'segment')
            && !isNamed(expression.right, 'outer')) {
            const left = this.compileDirectExpression(expression.left);
            const right = this.compileDirectExpression(expression.right);
            const step = expression.step ? this.compileDirectExpression(expression.step) : undefined;
            if (left && right && (expression.operator === 'and' || expression.operator === 'or')) {
                const operator = expression.operator;
                return () => {
                    const value = left();
                    return this.operators.decidesGuard(operator, value) ? value : this.operators.evaluateGuard(operator, value, right());
                };
            }
            if (left && right && (!expression.step || step)) {
                return () => this.operators.evaluateBinary(expression.operator, left(), right(), step?.());
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
        classify = true,
    ): () => Evaluation<RankValue> {
        const interpreter = this;
        const bound = compileClauseExpression(expression, () => this.clauseContext());
        if (bound && isBinaryExpression(expression)) return bound;
        if (classify && (isApplicationExpression(expression) || isBinaryExpression(expression))) {
            const syntax = isBinaryExpression(expression) ? flattenApplication(expression.right) : flattenApplication(expression);
            const names = syntax.filter(isNameExpression).map(part => part.name);
            let signature: string | undefined;
            let compiled: (() => Evaluation<RankValue>) | undefined;
            return () => {
                const bindings = new Map(names.map(name => [name, this.applicationOperation(name)]));
                const next = names.map(name => {
                    const identity = bindings.get(name);
                    return identity === false ? '\0' : identity?.name ?? name;
                }).join(' ');
                if (!compiled || signature !== next) {
                    const form = applicationForm(expression, name => bindings.has(name)
                        ? bindings.get(name) : this.applicationOperation(name));
                    compiled = this.application.compileForm(expression, form, missing, tail);
                    signature = next;
                }
                return compiled();
            };
        }
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
            return function* (): Execution<RankValue> {
                return expression.name === 'NA' ? MISSING : { kind: 'label', name: expression.name };
            };
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
                return interpreter.singlePassSequence({
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
                        const line = (expression.$cstNode?.range.start.line ?? 0) + 1;
                        for (let index = 0n; index < count; index += 1n) {
                            try {
                                yield interpreter.readStdin(mode);
                            } catch (error) {
                                // The sequence is read where it is used, far from its declaration.
                                if (!(error instanceof RankError) || error.rankKind === 'IO') throw error;
                                throw new RankError(`${error.message} (item ${index + 1n} of ${count}, read by `
                                    + `stdin .${mode} at line ${line})`, error.rankKind, error.value);
                            }
                        }
                    },
                });
            };
        }
        if (isArrayExpression(expression)) {
            return function* (): Execution<RankValue> {
                let items: RankValue[];
                if (expression.range) {
                    const rangeValue = (yield* resume(interpreter.evaluateTask(expression.range)));
                    if (isRankSequence(rangeValue)) {
                        if (rangeValue.plan.size.kind === 'infinite') {
                            throw new RankError('cannot materialize an infinite sequence');
                        }
                        const material = materializeSequence(rangeValue);
                        if (expression.dimensions.length === 0) return material;
                        items = material.items;
                    } else if (isRankArray(rangeValue)) {
                        if (expression.dimensions.length === 0) return rangeValue;
                        items = rangeValue.items;
                    } else {
                        throw new RankError('array range must be a sequence or array');
                    }
                } else {
                    items = yield* resume(mapExecution(expression.rows.length > 0
                        ? expression.rows.flatMap(row => row.items)
                        : expression.items, item => interpreter.evaluateArrayItem(item)));
                }
                if (expression.dimensions.length === 0) return array(items);
                const shape = yield* resume(interpreter.arrayShape(expression.dimensions));
                const size = shape.reduce((product, dimension) => product * BigInt(dimension), 1n);
                if (expression.fill !== undefined) {
                    const fill = (yield* resume(interpreter.evaluateTask(expression.fill)));
                    return ownedArray(Array(Number(size)).fill(fill), shape, typeof fill !== 'object');
                }
                if (BigInt(items.length) !== size) {
                    throw new RankError(
                        `array shape ${shape.join(' ')} expects ${size} elements, got ${items.length}`,
                    );
                }
                return ownedArray(items, shape);
            };
        }
        const tableQuery = compileTableExpression(expression, () => ({
            get localFrame() { return interpreter.bindings.current; },
            set localFrame(frame) { interpreter.bindings.current = frame; },
            requireModule: (module, operation) => interpreter.requireModule(module, operation),
            evaluate: node => interpreter.evaluateTask(node),
            select: values => interpreter.select(values),
            binary: (operator, left, right) => interpreter.operators.evaluateBinary(operator, left, right),
            resolve: name => interpreter.resolve(name),
            findVariable: name => interpreter.findVariable(name),
            isStandardFunction: (module, name, value) => interpreter.builtins.is(module, name, value),
            maskSelection,
        }));
        if (tableQuery) return tableQuery;
        const clause = compileClauseExpression(expression, () => this.clauseContext());
        if (clause) return clause;
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
                recordContract(record);
                return record;
            };
        }
        if (isRecordUpdateExpression(expression)) {
            return function* (): Execution<RankValue> {
                const source = yield* resume(interpreter.evaluateTask(expression.source));
                if (!isRankRecord(source)) throw new RankError('with expects a record', 'TypeError');
                const entries = new ResourceMap<RankValue>(value => value);
                const record: RankRecord = entries.resources.track({
                    kind: 'record',
                    entries,
                    types: new Map(source.types),
                    fieldContracts: new Map(recordContract(source).fields),
                });
                for (const [name, value] of source.entries) entries.set(name, value);
                const changed = new Set<string>();
                for (const field of expression.fields) {
                    if (changed.has(field.name)) throw new RankError(`duplicate record field: .${field.name}`);
                    changed.add(field.name);
                    const value = yield* resume(interpreter.evaluateTask(field.value));
                    interpreter.assignRecordField(record, field.name, field.operator, value);
                }
                return record;
            };
        }
        if (isAliasedTableExpression(expression)) {
            return function* (): Execution<RankValue> {
                interpreter.requireModule('tables', 'alias');
                let source = yield* resume(interpreter.evaluateTask(expression.source));
                if (expression.field) {
                    source = interpreter.select([source, { kind: 'label', name: expression.field.name }]);
                }
                if (isRankSqliteTable(source) && source.scopes) {
                    throw new RankError('alias of a joined SQLite view is not supported yet', 'TypeError');
                }
                if (isRankTable(source)) source = source.toRows();
                if ((!isRankArray(source) || source.shape.length !== 1) && !isRankSqliteTable(source)) {
                    throw new RankError('alias expects a rank-1 table or SQLite view', 'TypeError');
                }
                return { kind: 'table-alias', source, name: expression.name.name };
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
                if (isRankSqliteTable(source) && !indices && expression.fields.length > 0) {
                    return sortSqlite(source, expression.fields.map(field => field.field.name),
                        expression.fields.map(field => sortFieldDescending(field.direction)));
                }
                if (isRankTable(source) && !indices && expression.fields.length > 0) {
                    return sortTable(source, expression.fields.map(field => field.field.name),
                        expression.fields.map(field => sortFieldDescending(field.direction)));
                }
                // A key function reads whole rows, so it works on a snapshot of them.
                const tableSource = isRankTable(source) ? source : undefined;
                const items = sortByItems(tableSource ? tableSource.toRows() : source, operation);
                const resultWithSchema = (result: RankArray): RankValue => {
                    if (tableSource && !indices) return RankArrowTable.fromRows(result.items, tableSource.names);
                    if (!indices && isRankArray(source) && source.columnNames) {
                        Object.defineProperty(result, 'columnNames', { value: source.columnNames });
                    }
                    return result;
                };
                if (expression.fields.length > 0) {
                    const keys = items.map(item => expression.fields.map(field => {
                        if (!isRankRecord(item) && !isRankObject(item)) {
                            throw new RankError(`${operation} fields expects records`, 'TypeError');
                        }
                        return item.entries.get(field.field.name);
                    }));
                    for (const [index, field] of expression.fields.entries()) {
                        if (keys.length > 0 && !keys.some(row => row[index] !== undefined)
                            && (!isRankArray(source)
                                || !source.columnNames?.includes(field.field.name))) {
                            throw new MissingValueError(
                                `${operation} record is missing field .${field.field.name}`,
                            );
                        }
                    }
                    return resultWithSchema(sortByKeys(items, keys, operation, indices,
                        expression.fields.map(field => sortFieldDescending(field.direction))));
                }
                if (!expression.key) throw new RankError(`${operation} requires a key`);
                const key = yield* resume(interpreter.evaluateTask(expression.key));
                if (!isNativeFunction(key) || !key.arities.includes(1)) {
                    throw new RankError(`${operation} key must be a unary function`);
                }
                const keys: RankValue[][] = [];
                for (const item of items) {
                    const value = yield* resume(interpreter.invoke(key, [item]));
                    interpreter.resources.ownFiles(value);
                    keys.push([value]);
                }
                return resultWithSchema(sortByKeys(items, keys, operation, indices, [sortFieldDescending(expression.direction)]));
            };
        }
        if (isKeyedGroupExpression(expression) || isKeyedRollingExpression(expression)
            || isKeyedJoinExpression(expression) || isKeyedReachExpression(expression)) {
            return compileKeyedTableExpression(expression, {
                requireModule: (module, operation) => this.requireModule(module, operation),
                evaluate: value => this.evaluateTask(value),
            })!;
        }
        if (isNameExpression(expression)) {
            return () => {
                const value = interpreter.resolve(expression.name);
                if (!isNativeFunction(value) || !value.arities.includes(0)) return completed(nameMask(value));
                if (tail && interpreter.resources.currentScopeEmpty()) {
                    interpreter.functions.throwTailCall(value, []);
                }
                return mapResult(interpreter.invoke(value, []), result => {
                    interpreter.resources.ownFiles(result);
                    return result;
                });
            };
        }
        if (isParenthesizedExpression(expression)) {
            if (tail) return this.compileExpression(expression.value, missing, true);
            return () => interpreter.evaluateTask(expression.value);
        }
        if (isUnpackExpression(expression)) {
            return function* (): Execution<RankValue> {
                throw new RankError('unpack requires a surrounding application');
            };
        }
        if (isUnaryExpression(expression)) {
            return function* (): Execution<RankValue> {
                return interpreter.operators.evaluateUnary(expression.operator, (yield* resume(interpreter.evaluateTask(expression.operand))));
            };
        }
        if (isBinaryExpression(expression)) {
            if (expression.operator === '**' && isUnaryExpression(expression.left)
                && (expression.left.operator === '+' || expression.left.operator === '-')) {
                const left = expression.left;
                return function* (): Execution<RankValue> {
                    const powered = interpreter.operators.evaluateBinary(
                        '**',
                        (yield* resume(interpreter.evaluateTask(left.operand))),
                        (yield* resume(interpreter.evaluateTask(expression.right))),
                    );
                    return interpreter.operators.evaluateUnary(left.operator, powered);
                };
            }
            if (expression.operator === 'default') {
                // Identity-only marker; never exposed to Rank or passed to functions.
                const absent: RankValue = { kind: 'label', name: '' };
                let left: (() => Evaluation<RankValue>) | undefined;
                return function* (): Execution<RankValue> {
                    try {
                        // Prepare on first use to preserve operand/error ordering.
                        left ??= interpreter.compileExpression(expression.left, () => absent);
                        const value = yield* resume(left());
                        if (isRankArray(value)) {
                            const masked = maskedCells(value);
                            let evaluated: RankValue | undefined;
                            if (masked) {
                                if (allValid(masked.validity, masked.values.length)) return value;
                                const fallback = evaluated = yield* resume(interpreter.evaluateTask(expression.right));
                                if (typeof fallback === 'number') {
                                    const out = masked.values.slice();
                                    for (let index = 0; index < out.length; index += 1) {
                                        if (!isPresentAt(masked.validity, index)) out[index] = fallback;
                                    }
                                    return typedArray(out, value.shape);
                                }
                            }
                            let items: readonly RankValue[];
                            try {
                                items = value.items;
                            } catch (error) {
                                if (!(error instanceof MissingValueError)) throw error;
                                // A missing cell takes the fallback; the other cells keep their values.
                                const size = value.shape.reduce((product, length) => product * length, 1);
                                items = Array.from({ length: size }, (_, index) => {
                                    try {
                                        return readArrayItem(value, index);
                                    } catch (cellError) {
                                        if (!(cellError instanceof MissingValueError)) throw cellError;
                                        return absent;
                                    }
                                });
                            }
                            const unknown = (item: RankValue) => item === absent || item === MISSING;
                            if (!items.some(unknown)) return value;
                            const fallback = evaluated ?? (yield* resume(interpreter.evaluateTask(expression.right)));
                            return createArraySnapshot(
                                items.map(item => unknown(item) ? fallback : item),
                                value.shape,
                            );
                        }
                        if (value !== absent && value !== MISSING) return value;
                    } catch (error) {
                        if (!(error instanceof MissingValueError)) throw error;
                    }
                    return (yield* resume(interpreter.evaluateTask(expression.right)));
                };
            }
            if (expression.operator === 'and' || expression.operator === 'or') {
                const operator = expression.operator;
                const right = () => interpreter.evaluateTask(expression.right);
                return () => flatMapResult(interpreter.evaluateTask(expression.left), left =>
                    interpreter.operators.decidesGuard(operator, left) ? completed(left)
                        : mapResult(right(), value => interpreter.operators.evaluateGuard(operator, left, value)));
            }
            if (!expression.step) {
                const right = () => interpreter.evaluateTask(expression.right);
                const operation = (left: RankValue, right: RankValue) =>
                    interpreter.operators.evaluateBinary(expression.operator, left, right);
                return () => mapPair(interpreter.evaluateTask(expression.left), right, operation);
            }
            return function* (): Execution<RankValue> { return interpreter.operators.evaluateBinary(
                expression.operator,
                (yield* resume(interpreter.evaluateTask(expression.left))),
                (yield* resume(interpreter.evaluateTask(expression.right))),
                (yield* resume(interpreter.evaluateTask(expression.step!))),
            ); };
        }
        if (isMaterializeExpression(expression)) {
            return function* (): Execution<RankValue> {
                const source = (yield* resume(interpreter.evaluateTask(expression.source)));
                if (isRankTableAlias(source) && isRankSqliteTable(source.source)) {
                    return materializeSqlite(source.source);
                }
                if (isRankSqliteTable(source)) return materializeSqlite(source);
                if (isRankTable(source)) return source.toRows();
                if (isRankSqliteExpression(source)) return materializeSqliteExpression(source);
                if (!isRankSequence(source)) throw new RankError('postfix array expects a sequence, table or SQLite table');
                return materializeSequence(source);
            };
        }
        if (isAllAxisExpression(expression)) {
            return function* (): Execution<RankValue> { throw new RankError('# is only valid inside tensor addressing'); };
        }
        return function* (): Execution<RankValue> { throw new RankError(`cannot evaluate ${expression.$type}`); };
    }

    /** Binding identity, including aliases; no user function is executed by classification. */
    private applicationOperation(name: string): ReturnType<typeof findOperation> | false {
        const value = this.findVariable(name);
        if (value === undefined) return findOperation(name);
        return isNativeFunction(value) ? BuiltinRegistry.operationOf(value) ?? false : false;
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
        return this.operators.evaluateUnary(item.sign, value);
    }

    private evaluateAddressItem(item: AddressItem): Evaluation<RankValue> {
        if (item.all) return completed(ALL_AXIS);
        if (!item.value) throw new RankError('missing array selector');
        const result = this.evaluateTask(item.value);
        const sign = item.sign;
        return sign ? mapResult(result, value => this.operators.evaluateUnary(sign, value)) : result;
    }

    private evaluateAddressParts(item: AddressItem): Evaluation<RankValue[]> {
        if (!item.spread) return mapResult(this.evaluateAddressItem(item), value => [value]);
        if (!item.value) throw new RankError('missing unpack expression');
        return mapResult(this.evaluateTask(item.value), unpackApplicationItems);
    }

    private *arrayDimension(item: ArrayItem): Execution<number> {
        const dimension = expectInteger((yield* resume(this.evaluateArrayItem(item))));
        return checkedArrayDimension(dimension);
    }

    /** `array shape N M` takes one integer per dimension; `array shape Shape` takes one vector. */
    private *arrayShape(items: readonly ArrayItem[]): Execution<number[]> {
        if (items.length === 1) {
            const value = yield* resume(this.evaluateArrayItem(items[0]!));
            if (!isRankArray(value)) return [checkedArrayDimension(expectInteger(value))];
            if (value.shape.length !== 1) throw new RankError('array shape expects a vector of dimensions');
            return Array.from({ length: value.shape[0]! },
                (_, index) => checkedArrayDimension(expectInteger(value.itemAt?.(index) ?? value.items[index]!)));
        }
        return yield* resume(mapExecution(items, item => this.arrayDimension(item)));
    }

    private useStandard(module: string): void {
        if (!(module in standardModules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        const modules = new Set([...this.modules, module]);
        this.checkBuiltinBindings({ $type: 'Program', statements: [] }, modules);
        this.modules.add(module);
    }

    private singlePassSequence(plan: RankSequence['plan']): RankSequence {
        const source = sequence({ ...plan, singlePass: true });
        return this.options.wrapSinglePassSequence?.(source) ?? source;
    }

    private localIndex(): RankIndex {
        this.requireModule('algo', 'index');
        return this.bindings.structure('index', isRankIndex, () => newStructure('index') as RankIndex);
    }

    private localQueue(): RankQueue {
        this.requireModule('algo', 'queue');
        return this.bindings.structure('queue', isRankQueue, () => new RankDeque());
    }

    private localSet(): RankSet {
        this.requireModule('algo', 'set');
        return this.bindings.structure('set', isRankSet, () => newStructure('set') as RankSet);
    }

    private localCounter(): RankCounter {
        this.requireModule('algo', 'counter');
        return this.bindings.structure('counter', isRankCounter, () => newStructure('counter') as RankCounter);
    }

    private useFile(specifier: string, alias?: string): LoadedProgram {
        const loaded = this.load(specifier);
        const child = new Interpreter(this.output, {
            md5: this.options.md5,
            wrapSinglePassSequence: this.options.wrapSinglePassSequence,
            wrapStoredSequence: this.options.wrapStoredSequence,
            input: this.options.input,
            scalarEntryCompilation: this.options.scalarEntryCompilation,
            compiledScalarTailCalls: this.options.compiledScalarTailCalls,
            scalarFunctionCompilation: this.options.scalarFunctionCompilation,
            onScalarFunctionExecuted: this.options.onScalarFunctionExecuted,
            scalarBlockCalls: this.options.scalarBlockCalls,
            scalarCallCompilation: this.options.scalarCallCompilation,
            tensorTextDigits: this.options.tensorTextDigits,
            scalarTextCompilation: this.options.scalarTextCompilation,
            directTextIteration: this.options.directTextIteration,
            textArrayLoopCompilation: this.options.textArrayLoopCompilation,
            textLoopCompilation: this.options.textLoopCompilation,
            absoluteLoopCompilation: this.options.absoluteLoopCompilation,
            provenIterationTypes: this.options.provenIterationTypes,
            loopReturnCompilation: this.options.loopReturnCompilation,
            arrayLocalCompilation: this.options.arrayLocalCompilation,
            booleanArrayCompilation: this.options.booleanArrayCompilation,
            booleanLoopCompilation: this.options.booleanLoopCompilation,
            boundIntegerWrites: this.options.boundIntegerWrites,
            scalarAddressCompilation: this.options.scalarAddressCompilation,
            extremaLoopCompilation: this.options.extremaLoopCompilation,
            compoundArrayCompilation: this.options.compoundArrayCompilation,
            arrayIterationCompilation: this.options.arrayIterationCompilation,
            arrayWriteCompilation: this.options.arrayWriteCompilation,
            arrayLoopCompilation: this.options.arrayLoopCompilation,
            nestedLoopCompilation: this.options.nestedLoopCompilation,
            tensorCellCompilation: this.options.tensorCellCompilation,
            directIteration: this.options.directIteration,
            directLoopControl: this.options.directLoopControl,
            nativeLoopCompilation: this.options.nativeLoopCompilation,
            typedNativeCalls: this.options.typedNativeCalls,
            functionBodyCompilation: this.options.functionBodyCompilation,
            onFunctionBodyCompiled: this.options.onFunctionBodyCompiled,
            onFunctionBodyExecuted: this.options.onFunctionBodyExecuted,
            integerLoopCompilation: this.options.integerLoopCompilation,
            onIntegerLoopCompiled: this.options.onIntegerLoopCompiled,
            onIntegerLoopExecuted: this.options.onIntegerLoopExecuted,
            loopPreparation: this.options.loopPreparation,
            blockCompilation: this.options.blockCompilation,
            onBlockCompiled: this.options.onBlockCompiled,
            onBlockExecuted: this.options.onBlockExecuted,
            scalarCompilation: this.options.scalarCompilation,
            onScalarCompiled: this.options.onScalarCompiled,
            onScalarExecuted: this.options.onScalarExecuted,
            tensorReadHoisting: this.options.tensorReadHoisting,
            tensorFusion: this.options.tensorFusion,
            onTensorKernelCompiled: this.options.onTensorKernelCompiled,
            onTensorKernelExecuted: this.options.onTensorKernelExecuted,
            io: this.options.io,
            random: this.random,
            maxCallDepth: this.functions.maxDepth,
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
                if (isFunctionStatement(statement) && availableBuiltin(statement.name, this.modules)) {
                    throw new RankError(builtinBindingMessage(statement.name), 'TypeError');
                }
            }
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
        registerSource(loaded.program, source.id);
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
            return this.resources.withResourceScope(() => this.executeProgram(target.program, args));
        } finally {
            this.currentRunTarget = previous;
        }
    }

    private runAlias(alias: string): RankValue | undefined {
        const child = this.aliases.get(alias);
        if (!child?.loadedProgram) {
            throw new RankError(`unknown module alias: ${alias}`);
        }
        const result = child.resources.withResourceScope(() => child.executeProgram(child.loadedProgram!.program));
        this.resources.ownFiles(result);
        return result;
    }

    private executeTest(name: string, statements: Statement[]): void {
        if (!this.options.testing && !this.modules.has('testing')) {
            throw new RankError('test requires: use testing');
        }
        const output: string[] = [];
        const test = new Interpreter(line => output.push(line), {
            md5: this.options.md5,
            input: this.options.input,
            scalarEntryCompilation: this.options.scalarEntryCompilation,
            compiledScalarTailCalls: this.options.compiledScalarTailCalls,
            scalarFunctionCompilation: this.options.scalarFunctionCompilation,
            onScalarFunctionExecuted: this.options.onScalarFunctionExecuted,
            scalarBlockCalls: this.options.scalarBlockCalls,
            scalarCallCompilation: this.options.scalarCallCompilation,
            tensorTextDigits: this.options.tensorTextDigits,
            scalarTextCompilation: this.options.scalarTextCompilation,
            directTextIteration: this.options.directTextIteration,
            textArrayLoopCompilation: this.options.textArrayLoopCompilation,
            textLoopCompilation: this.options.textLoopCompilation,
            absoluteLoopCompilation: this.options.absoluteLoopCompilation,
            provenIterationTypes: this.options.provenIterationTypes,
            loopReturnCompilation: this.options.loopReturnCompilation,
            arrayLocalCompilation: this.options.arrayLocalCompilation,
            booleanArrayCompilation: this.options.booleanArrayCompilation,
            booleanLoopCompilation: this.options.booleanLoopCompilation,
            boundIntegerWrites: this.options.boundIntegerWrites,
            scalarAddressCompilation: this.options.scalarAddressCompilation,
            extremaLoopCompilation: this.options.extremaLoopCompilation,
            compoundArrayCompilation: this.options.compoundArrayCompilation,
            arrayIterationCompilation: this.options.arrayIterationCompilation,
            arrayWriteCompilation: this.options.arrayWriteCompilation,
            arrayLoopCompilation: this.options.arrayLoopCompilation,
            nestedLoopCompilation: this.options.nestedLoopCompilation,
            tensorCellCompilation: this.options.tensorCellCompilation,
            directIteration: this.options.directIteration,
            directLoopControl: this.options.directLoopControl,
            nativeLoopCompilation: this.options.nativeLoopCompilation,
            typedNativeCalls: this.options.typedNativeCalls,
            functionBodyCompilation: this.options.functionBodyCompilation,
            onFunctionBodyCompiled: this.options.onFunctionBodyCompiled,
            onFunctionBodyExecuted: this.options.onFunctionBodyExecuted,
            integerLoopCompilation: this.options.integerLoopCompilation,
            onIntegerLoopCompiled: this.options.onIntegerLoopCompiled,
            onIntegerLoopExecuted: this.options.onIntegerLoopExecuted,
            loopPreparation: this.options.loopPreparation,
            blockCompilation: this.options.blockCompilation,
            onBlockCompiled: this.options.onBlockCompiled,
            onBlockExecuted: this.options.onBlockExecuted,
            scalarCompilation: this.options.scalarCompilation,
            onScalarCompiled: this.options.onScalarCompiled,
            onScalarExecuted: this.options.onScalarExecuted,
            tensorReadHoisting: this.options.tensorReadHoisting,
            tensorFusion: this.options.tensorFusion,
            onTensorKernelCompiled: this.options.onTensorKernelCompiled,
            onTensorKernelExecuted: this.options.onTensorKernelExecuted,
            io: this.options.io,
            random: this.random,
            loadModule: this.options.loadModule,
            sourceId: this.options.sourceId,
            testing: true,
        });
        test.modules.add('testing');
        const program = { $type: 'Program' as const, statements } as Program;
        const startedAt = performance.now();
        try {
            test.resources.withResourceScope(() => test.executeProgram(program, [], true), false);
            const durationMs = performance.now() - startedAt;
            const result: RankTestResult = { name, passed: true, output, durationMs };
            this.testResults.push(result);
            this.options.onTestResult?.(result);
        } catch (error) {
            if (error instanceof InterruptedError) throw error;
            const durationMs = performance.now() - startedAt;
            const result: RankTestResult = {
                name,
                passed: false,
                output,
                error: error instanceof RankError ? error.format() : String(error),
                durationMs,
            };
            this.testResults.push(result);
            this.options.onTestResult?.(result);
        }
    }

    private prepareInputs(program: Program, args: readonly string[]): void {
        const declarations = program.statements.filter(statement =>
            isOptionStatement(statement) || isArgumentStatement(statement) || isFlagStatement(statement));
        if (declarations.length === 0) {
            if (args.length > 0) throw new RankError(`unexpected arguments: ${args.join(' ')}`);
            return;
        }

        if (!this.modules.has('cli') && !program.statements.some(statement =>
            isUseStatement(statement) && statement.module === 'cli')) {
            throw this.locateError(new RankError(`${inputDeclarationName(declarations[0])} requires: use cli`), declarations[0]);
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

    // Rank source cannot pass a nullary function by name: the name calls it.
    // A host callback can still supply one through a parameter or public binding.
    private clauseContext(): ClauseExpressionContext {
        const interpreter = this;
        return {
            get localFrame() { return interpreter.bindings.current; },
            set localFrame(frame) { interpreter.bindings.current = frame; },
            evaluate: node => interpreter.evaluateTask(node),
            binary: (operator, left, right) => interpreter.operators.evaluateBinary(operator, left, right),
            findVariable: name => interpreter.findVariable(name),
        };
    }

    private directNameValue(value: RankValue): RankValue {
        if (!isNativeFunction(value) || !value.arities.includes(0)) return nameMask(value);
        const result = value.call([]);
        this.resources.ownFiles(result);
        return result;
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
        const dot = name.indexOf('.');
        if (dot >= 0) {
            const alias = name.slice(0, dot);
            const member = name.slice(dot + 1);
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

        const builtin = this.builtins.lookup(name);
        if (builtin !== undefined) return builtin;
        throw this.builtins.unknown(name);
    }

    private resolveVariable(name: string): RankValue {
        // Most names are plain, and scanning for the dot here keeps the common
        // read from calling out and building a pair it throws away.
        const dot = name.indexOf('.');
        if (dot >= 0) {
            const child = this.aliases.get(name.slice(0, dot));
            if (!child) throw new RankError(`unknown module alias: ${name.slice(0, dot)}`);
            return child.resolveVariable(name.slice(dot + 1));
        }
        const value = this.findVariable(name);
        if (value === undefined) {
            throw new RankError(`unknown variable: ${name}`);
        }
        return value;
    }

    private compileAssign(name: string): (value: RankValue) => void {
        return name.includes('.') ? value => this.assign(name, value) : this.bindings.compileAssign(name);
    }

    private assign(name: string, value: RankValue): void {
        const dot = name.indexOf('.');
        if (dot >= 0) {
            const alias = name.slice(0, dot);
            const child = this.aliases.get(alias);
            if (!child) throw new RankError(`unknown module alias: ${alias}`);
            child.assign(name.slice(dot + 1), value);
            return;
        }
        this.bindings.assign(name, value);
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
            : this.operators.evaluateBinary(assignmentOperator(operator), previous, value);
        const expected = record.types.get(field)!;
        const received = typeName(result);
        if (expected !== received) {
            throw new RankError(bindingTypeMessage(`record field .${field}`, [expected], [received]));
        }
        checkRecordField(record, field, result);
        noteArrayBinding(result);
        record.entries.set(field, result);
        return result;
    }

    private findVariable(name: string): RankValue | undefined {
        return this.bindings.find(name);
    }

    private invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue> {
        return this.functions.invoke(fn, arguments_);
    }

    private select(values: RankValue[], missing?: () => RankValue): RankValue {
        return selectValues(this.modules, values, missing);
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
            yield* tensorEntries(value, frameAxes, this.options.tensorCellCompilation !== false);
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
            yield* tensorEntries(value, [0], this.options.tensorCellCompilation !== false);
            return;
        }

        const values = this.iterationAtoms(binding, value);
        // A binding without an index name has nowhere to put one, so the walk
        // neither counts nor carries it.
        if (binding.names.length === 1) {
            for (const item of values) yield { value: item, indices: NO_INDICES };
            return;
        }
        let index = 0n;
        for (const item of values) {
            yield { value: item, indices: [index] };
            index += 1n;
        }
    }

    private iterationAtoms(binding: ForBinding, value: RankValue, provenType?: 'integer' | 'text', directText = false): Iterable<RankValue> {
        validateForBindings(binding.names, 1);
        if (isRankArray(value)) {
            const types = provenType
                ? new Set(value.items.length ? [provenType] : []) : typesOf(value.items);
            this.declareLoopTypes(binding.names, [types, new Set(['integer'])]);
        } else if (isRankQueue(value)) {
            const types = value instanceof RankDeque ? value.iterationTypes(typeName) : typesOf(value.items);
            this.declareLoopTypes(binding.names, [types, new Set(['integer'])]);
        } else if (isRankSet(value)) {
            this.declareLoopTypes(binding.names, [
                typesOf(value.entries.values()),
                new Set(['integer']),
            ]);
        } else if (isRankCounter(value)) {
            this.declareLoopTypes(binding.names, [
                typesOf(Array.from(value.entries.values(), entry => entry.value)),
                new Set(['integer']),
            ]);
        } else if (typeof value === 'string') {
            this.declareLoopTypes(binding.names, [new Set(['text']), new Set(['integer'])]);
        }
        if (directText && typeof value === 'string') return value;
        return iterationValues(value);
    }

    private declareLoopTypes(
        names: readonly string[],
        candidates: readonly ReadonlySet<string>[],
    ): void {
        this.bindings.declareTypes(names, candidates);
    }

    private requireModule(module: string, operation: string): void {
        if (!this.modules.has(module)) {
            throw new RankError(`${operation} requires: use ${module}`);
        }
    }
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

/**
 * Block names no binding outside the block can have set. An assignment inside
 * a top-level function never reaches globals, so a name that is neither a
 * parameter nor bound elsewhere in that function is unbound whenever the block
 * starts. Nested functions and programs share names at runtime and stay checked.
 */
function alwaysFresh(statement: Statement, names: readonly string[]): Set<string> {
    let owner: import('langium').AstNode | undefined = statement.$container;
    while (owner && !isFunctionStatement(owner)) owner = owner.$container;
    if (!owner || !isFunctionStatement(owner)) return new Set();
    for (let node: import('langium').AstNode | undefined = owner.$container; node; node = node.$container) {
        if (isFunctionStatement(node)) return new Set();
    }
    const outside = new Set<string>(owner.parameters);
    const visit = (node: import('langium').AstNode): void => {
        if (node === statement || isFunctionStatement(node)) return;
        if (isAssignmentStatement(node)) outside.add(node.name);
        else if (isUnpackStatement(node)) node.names.forEach(name => outside.add(name));
        else if (isForStatement(node)) forIteration(node.condition)?.names.forEach(name => outside.add(name));
        else if (isTryStatement(node)) node.catches.forEach(clause => outside.add(clause.errorName));
        for (const child of AstUtils.streamContents(node)) visit(child);
    };
    for (const child of AstUtils.streamContents(owner)) visit(child);
    return new Set(names.filter(name => !outside.has(name)));
}

/** Whether a loop of the same function or program encloses the statement. */
function insideLoop(statement: Statement): boolean {
    for (let node = statement.$container; node && !isFunctionStatement(node); node = node.$container) {
        if (isForStatement(node)) return true;
    }
    return false;
}

/** Names a block may introduce: loop bindings, assignments, unpacking and caught errors. */
function blockNames(statement: Statement, syntheticNames: ReadonlySet<string>): string[] {
    const names = new Set<string>();
    const visit = (node: Statement): void => {
        if (isFunctionStatement(node)) return;
        if (isAssignmentStatement(node) && node.operator === '=' && !node.name.includes('.')) names.add(node.name);
        else if (isUnpackStatement(node)) for (const name of node.names) names.add(name);
        else if (isForStatement(node)) {
            for (const name of forIteration(node.condition)?.names ?? []) if (name !== '#') names.add(name);
            node.statements.forEach(visit);
        } else if (isIfStatement(node)) {
            [node.thenStatements, ...node.elifClauses.map(clause => clause.statements), node.elseStatements]
                .forEach(branch => branch.forEach(visit));
        } else if (isTryStatement(node)) {
            node.statements.forEach(visit);
            for (const clause of node.catches) {
                names.add(clause.errorName);
                clause.statements.forEach(visit);
            }
            node.finallyStatements.forEach(visit);
        }
    };
    visit(statement);
    return [...names].filter(name => !syntheticNames.has(name));
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

function validateForBindings(names: readonly string[], frameRank: number): void {
    if (names.length !== 1 && names.length !== frameRank + 1) {
        throw new RankError(
            `for expects one value name or ${frameRank + 1} value/index names, got ${names.length}`,
        );
    }
}

function* tensorEntries(source: RankArray, frameAxes: readonly number[], compiled: boolean): IterableIterator<ForEntry> {
    const frameShape = frameAxes.map(axis => source.shape[axis]);
    const frameSet = new Set(frameAxes);
    const cellAxes = source.shape.map((_, axis) => axis).filter(axis => !frameSet.has(axis));
    const cellShape = cellAxes.map(axis => source.shape[axis]);
    const copy = compiled && cellAxes.length > 0
        ? compileTensorCellCopy(frameAxes.length + cellAxes.length, cellAxes) : undefined;

    for (const frameCoordinates of coordinates(frameShape)) {
        const fullCoordinates = Array(source.shape.length).fill(0) as number[];
        frameAxes.forEach((axis, position) => {
            fullCoordinates[axis] = frameCoordinates[position];
        });
        const copied = copy?.(source, fullCoordinates, cellShape);
        const items: RankValue[] = copied ?? [];
        const cellSize = copied === undefined ? cellShape.reduce((product, dimension) => product * dimension, 1) : 0;
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
                : ownedArray(items, cellShape),
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

function array(items: RankValue[]): RankArray {
    return ownedArray(items);
}

function arrayItem(source: RankArray, index: number): RankValue {
    return readArrayItem(source, index);
}

function iterationValues(value: RankValue): Iterable<RankValue> {
    if (value instanceof RankDeque || value instanceof RankHeap) return value.values();
    if (isRankSequence(value)) return sequenceValues(value, 'for');
    if (isRankArray(value)) return value.items;
    if (isRankQueue(value)) return value.items;
    if (isRankSet(value)) return value.entries.values();
    if (isRankCounter(value)) return Array.from(value.entries.values(), entry => entry.value);
    if (isRankMultiset(value)) return value.values();
    if (typeof value === 'string') return [...value];
    throw new RankError(`for expects text or a sequence, got ${typeName(value)}`);
}

function checkedArrayDimension(dimension: bigint): number {
    if (dimension < 0n) throw new RankError(`array dimension must be nonnegative: ${dimension}`);
    if (dimension > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`array dimension is too large: ${dimension}`);
    }
    return Number(dimension);
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

function assertTestExpression(value: RankValue): void {
    const failed = typeof value === 'boolean'
        ? !value
        : isRankArray(value)
            && value.items.every(item => typeof item === 'boolean')
            && value.items.some(item => item === false);
    if (failed) throw new RankError('boolean test expression evaluated to false');
}

export { typeName } from './value.js';
export type { InterpreterOptions, LoadedModule, RankTestResult } from './interpreter-options.js';

function typesOf(values: Iterable<RankValue>): ReadonlySet<string> {
    return new Set([...values].map(typeName));
}

function sortFieldDescending(direction: unknown): boolean {
    const value = typeof direction === 'string' ? direction
        : direction && typeof direction === 'object' && 'name' in direction
            ? (direction as { name?: unknown }).name
            : undefined;
    const name = typeof value === 'string' ? value.replace(/^\./, '') : undefined;
    if (name && name !== 'ascending' && name !== 'descending') {
        throw new RankError('sort direction must be .ascending or .descending', 'TypeError');
    }
    return name === 'descending';
}
