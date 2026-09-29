import { checkpoint, InterruptedError, inspectionEnabled, inspectExecution, debugExecutionPoint } from './interrupt.js';
import { AstUtils } from 'langium';
import { registerFlatCombine } from './flat-combine.js';
import { arrayMaskSource, markArrayMask, nameMask } from './array-mask.js';
import { FlatRecords } from './flat.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { compileScalarFunction } from './scalar-function-kernel.js';
import { createArraySnapshot, ownedArray, derivedArray, readArrayItem, arrayForWrite, noteArrayBinding, isFlatScalarArray, isSharedArray, enterRuntime, leaveRuntime } from './array-storage.js';
import { ByteArray } from './bytes.js';
import { isPureHostFunction } from './host-effects.js';
import { typedNativeCall } from './typed-native.js';
import { scalarFunctionResult } from './scalar-function-proof.js';
import { compileTensorCellCopy } from './tensor-cell-compiler.js';
import { compileIntegerLoop } from './integer-loop.js';
import { compileBlock, type CompiledBlock } from './block-compiler.js';
import { compileScalarExpression } from './scalar-compiler.js';
import { compileTensorKernel } from './tensor-kernel.js';
import {
    ExecutionStack, completed, emit, flatMapResult, mapExecution, mapPair, mapResult, normalizeStackError,
    resume, runExecution, type Evaluation, type Execution,
} from './execution.js';
import { LocalFrame } from './frame.js';
import { compileKeyedTableExpression } from './keyed-table-expression.js';
import { compileTableExpression } from './table-query-expression.js';
import { compileClauseExpression } from './clause-expression.js';
import { prepareIfStatement, prepareTryStatement,
    type ExecutionContext, type LoopControl } from './statement-control.js';
import { addToCollection, expectAddCollection, newStructure, removeFromCollection } from './collections.js';
import { RankDeque, RankHeap, pushCollection } from './containers.js';
import { ReturnContract, argumentRankSignature, argumentSignature } from './return-contract.js';
import { checkRecordField, recordContract, retainRecordContract } from './record-contract.js';
import { prepareFunction } from './prepared-function.js';
import { ResourceMap } from './resource-summary.js';
import { ResourceOwnership } from './resource-ownership.js';
import { compareCells, equalValues } from './value-comparison.js';
import { inputDeclarationName, inputValues, kebabCase, parseArguments, validateInputValue } from './cli-args.js';
import { ReductionEvaluator, reductionValues } from './reduction.js';
import { RankApplication, dyadicCells, tensorCells, tensorFrameAxes,
    type OuterCells } from './rank-application.js';
import {
    ALL_AXIS, atArray, isCollectionSelector, isIntegerCollectionSelector,
    isTensorAddress, scalarArrayWriteOffset, selectAxis, tensorSelection,
} from './selectors.js';
import { arrayOffset, coordinatesAt, safeDimension, sameShape } from './tensor-index.js';
import { numericKernel } from './numeric-kernels.js';
import { compileFusedReduction, compileFusedSum } from './fused-reduction.js';
import {
    nameNeedsExecution, requiresDataOperand, flattenApplication, applicationExpression as applicationParts,
    renamedBuiltinCall,
    flatArrayBorrowProofs,
    isAddStatement,
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
    applicationForm, assertNever, type ApplicationForm, findOperation, functionEffects, type ValueFacts,
    availableBuiltin, builtinBindingDiagnostics, builtinBindingMessage,
    RUNTIME_TYPE_NAMES,
    acceptsBindingType,
    bindingTypeMessage,
    possibleBindingTypeConflict,
} from '@arrrank/language';
import { MissingValueError, RankError } from './errors.js';
import { expectFenwick } from './fenwick.js';
import {
    RankMaxSumSegment,
    RankPersistentSumSegment,
    RankRangeSumSegment,
    RankSegment,
} from './segment.js';
import { graphConstructor } from './graph.js';
import { dsuFrom } from './dsu.js';
import { indexKey } from './index-key.js';
import type { RankInput, RankIo } from './io.js';
import { expectMultiset } from './multiset.js';
import { standardModules } from './modules/index.js';
import type { RuntimeModule } from './modules/types.js';
import { mapBroadcastArrays, mapDenseArrays } from './tensor.js';
import { matmulValues } from './modules/linalg.js';
import { formattedText } from './modules/text.js';
import { randomFromSeed, shuffleValue } from './modules/random.js';
import { compareOrderedValues, orderedKind } from './ordered.js';
import {
    argsortAxis,
    argsortValue,
    lengthOfAxis,
    sortByItems,
    sortByKeys,
    sortValue,
    transposeValue,
} from './modules/sequences.js';
import { covarianceValue, correlationValue, errorMetricValue, quantileValue } from './modules/stats.js';
import { projectAliasedField, projectField, projectFields } from './modules/tables.js';
import { applyTable, canApplyTable, writeTable } from './table-access.js';
import { sortTable } from './table-ops.js';
import { RankArrowTable } from './arrow-table.js';
import {
    binarySqlite, filterSqlite, materializeSqlite,
    materializeSqliteExpression, projectSqlite, sliceSqlite, sliceTextSqlite, sortSqlite, sqliteColumn, sqliteScope,
    sqliteScopedColumn, sqliteTable, inSqlite,
} from './modules/sqlite.js';
import { parse } from './parser.js';
import { setValueKey } from './set.js';
import {
    atSequence,
    filterSequence,
    positionalSelection,
    positionalMask,
    isPositionalMask,
    mapSequence,
    materializeSequence,
    sequence,
    sequenceMask,
    sequenceValues,
    shiftValue,
    windowValue,
    zipSequences,
} from './sequence.js';
import {
    formatValue,
    expectBoolean,
    isNativeFunction,
    isRankArray,
    checkBindingRank,
    isRankBytes,
    isRankCounter,
    isRankDate,
    isRankDuration,
    isRankDsu,
    isRankFunctionalGraph,
    isRankErrorValue,
    isRankFenwick,
    isRankGroupedTable,
    isRankGraph,
    isRankIndex,
    isRankLabel,
    isRankMultiset,
    isRankObject,
    isRankSqliteDatabase,
    isRankSqliteExpression,
    isRankSqliteTable,
    isRankTable,
    isRankSqliteScope,
    isRankTableAlias,
    isRankQueue,
    isRankRecord,
    isRankSet,
    isRankSequence,
    isRankSequenceMask,
    valueRank,
    isRankSegment,
    addDateTimeDuration,
    subtractDateTimes,
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
    typeName,
    type SequencePredicate,
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

export interface LoadedModule {
    readonly id: string;
    readonly source: string;
}

export interface InterpreterOptions {
    /** Optional host MD5 implementation; portable hashing is the default.
     * Use pureHostFunction only for implementations that satisfy its contract. */
    readonly md5?: (value: string | Uint8Array) => Uint8Array;
    /** Host-owned buffering for single-pass sources, installed only at creation. */
    readonly wrapSinglePassSequence?: (source: RankSequence) => RankSequence;
    /** Optional host cursors for repeatable sequence values saved by assignment. */
    readonly wrapStoredSequence?: (source: RankSequence) => RankSequence;
    readonly tensorReadHoisting?: boolean;
    readonly scalarEntryCompilation?: boolean;
    readonly compiledScalarTailCalls?: boolean;
    readonly scalarFunctionCompilation?: boolean;
    readonly onScalarFunctionExecuted?: () => void;
    readonly scalarBlockCalls?: boolean;
    readonly scalarCallCompilation?: boolean;
    readonly tensorTextDigits?: boolean;
    readonly scalarTextCompilation?: boolean;
    readonly directTextIteration?: boolean;
    readonly textArrayLoopCompilation?: boolean;
    readonly textLoopCompilation?: boolean;
    readonly absoluteLoopCompilation?: boolean;
    readonly provenIterationTypes?: boolean;
    readonly loopReturnCompilation?: boolean;
    readonly arrayLocalCompilation?: boolean;
    readonly booleanArrayCompilation?: boolean;
    readonly booleanLoopCompilation?: boolean;
    readonly boundIntegerWrites?: boolean;
    readonly scalarAddressCompilation?: boolean;
    readonly extremaLoopCompilation?: boolean;
    readonly compoundArrayCompilation?: boolean;
    readonly arrayIterationCompilation?: boolean;
    readonly arrayWriteCompilation?: boolean;
    readonly arrayLoopCompilation?: boolean;
    readonly nestedLoopCompilation?: boolean;
    readonly tensorCellCompilation?: boolean;
    /** Iterate scalar streams without per-element entry wrappers. */
    readonly directIteration?: boolean;
    /** Carry ordinary loop jumps through blocks without throwing signals. */
    readonly directLoopControl?: boolean;
    /** Compile guarded synchronous text/byte builtin calls inside loops. */
    readonly nativeLoopCompilation?: boolean;
    /** Use checked native wrappers even in typed loops when false. */
    readonly typedNativeCalls?: boolean;
    /** Compile function bodies with a terminal return continuation. */
    readonly functionBodyCompilation?: boolean;
    readonly onFunctionBodyCompiled?: (source: string) => void;
    readonly onFunctionBodyExecuted?: () => void;
    readonly integerLoopCompilation?: boolean;
    readonly onIntegerLoopCompiled?: (source: string) => void;
    readonly onIntegerLoopExecuted?: () => void;
    /** Reuse compiled loop bodies and their execution contexts. */
    readonly loopPreparation?: boolean;
    /** Compiled command blocks; false retains statement dispatch. */
    readonly blockCompilation?: boolean;
    readonly onBlockCompiled?: (source: string) => void;
    readonly onBlockExecuted?: () => void;
    /** Compound scalar expression compilation; false retains prepared operators. */
    readonly scalarCompilation?: boolean;
    readonly onScalarCompiled?: (source: string) => void;
    readonly onScalarExecuted?: () => void;
    /** General tensor fusion; false selects the reference statement path. */
    readonly tensorFusion?: boolean;
    readonly onTensorKernelCompiled?: (source: string) => void;
    readonly onTensorKernelExecuted?: () => void;
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

interface TensorGroup { readonly count: number; run(): RankValue | undefined }
type PreparedStatement = (
    | { readonly run: (context: ExecutionContext) => RankValue | undefined }
    | { readonly stream: (context: ExecutionContext) => Evaluation<RankValue | undefined> }
) & { readonly tensor?: TensorGroup };

const functionExecutions = new WeakMap<NativeFunction, (arguments_: RankValue[]) => Evaluation<RankValue>>();
const sourceIds = new WeakMap<object, string>();
interface FunctionDefinition {
    readonly specialization: (arguments_: RankValue[]) => ReturnContract;
    readonly interpreter: Interpreter;
    readonly statement: FunctionStatement;
    readonly context: LocalFrame | undefined;
    readonly direct: (() => RankValue) | undefined;
}
interface BorrowProof {
    readonly bindings: ReadonlyMap<string, RankValue | undefined>;
    readonly candidates: ReadonlyMap<number, ReadonlyMap<number, 'bigint' | 'boolean' | 'flat-array'>>;
}
const functionDefinitions = new WeakMap<NativeFunction, FunctionDefinition>();
const builtinOperations = new WeakMap<NativeFunction, NonNullable<ReturnType<typeof findOperation>>>();

class TailCallSignal {
    constructor(readonly definition: FunctionDefinition, readonly arguments_: RankValue[],
        readonly compiled?: (arguments_: RankValue[], tail: boolean) => RankValue) {}
}
const SEED_RANDOM = Symbol('seedRandom');

type SeedableRandom = (() => number) & {
    readonly [SEED_RANDOM]: (seed: bigint) => void;
};

class ReturnSignal {
    constructor(readonly value?: RankValue) {}
}

const NO_INDICES: readonly RankValue[] = [];

class BreakSignal {}
class ContinueSignal {}

// The signals carry nothing, so one of each serves every loop.
const BREAK_SIGNAL = new BreakSignal();
const CONTINUE_SIGNAL = new ContinueSignal();

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
    readonly modules = new Set<string>(['core']);
    /** Source bindings, separate from values injected through the host API. */
    private readonly sourceBindings = new Set<string>();
    private readonly sourceFunctions = new WeakMap<NativeFunction, FunctionStatement>();
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
    private readonly functionBodies = new WeakMap<FunctionStatement, Map<string, CompiledBlock<ExecutionContext> | null>>();
    private readonly globalBorrowProofs = new WeakMap<FunctionStatement, BorrowProof>();
    private readonly localBorrowProofs = new WeakMap<LocalFrame, WeakMap<FunctionStatement, BorrowProof>>();
    private readonly blocks = new WeakMap<Statement[], CompiledBlock<ExecutionContext> | null>();
    private readonly expressions = new WeakMap<Expression, () => Evaluation<RankValue>>();
    private readonly standardFunctions = new Map<RuntimeModule[string], NativeFunction>();
    private readonly reductions: ReductionEvaluator;
    private readonly rankApplication: RankApplication;
    private readonly standardSequences = new Map<RuntimeModule[string], RankSequence>();
    private localFrame: LocalFrame | undefined;
    private readonly variableTypes = new Map<string, ReadonlySet<string>>();
    private readonly variableArrayRanks = new Map<string, number>();
    private readonly resources = new ResourceOwnership();
    private debugStatement?: Statement;
    private readonly debugCalls: { name: string; frame: LocalFrame }[] = [];
    private inspectionState(): Pick<import('./interrupt.js').PauseSnapshot, 'state' | 'bindings'> {
        const inspected: NonNullable<import('./interrupt.js').PauseSnapshot['bindings']> = [];
        const reads = new Set<string>();
        const writes = new Map<string, LocalFrame | Map<string, RankValue>>();
        const markWrite = (name: string, mutate: boolean) => {
            if (name.includes('.')) return;
            const frame = this.localFrame?.find(name);
            const target = mutate ? frame ?? (this.variables.has(name) ? this.variables : undefined)
                : frame ?? this.localFrame ?? this.variables;
            if (target && target.get(name) !== undefined)
                writes.set(name, target);
        };
        const statement = this.debugStatement;
        if (statement) {
            const visit = (node: import('langium').AstNode) => {
                if (isNameExpression(node)) reads.add(node.name);
                for (const child of AstUtils.streamContents(node)) {
                    if (!child.$type.endsWith('Statement') && !child.$type.endsWith('Clause')) visit(child);
                }
            };
            visit(statement);
            if ((isAssignmentStatement(statement) && statement.operator !== '=')
                || isArrayAssignmentStatement(statement))
                reads.add(statement.name);
            if (isAssignmentStatement(statement)) markWrite(statement.name, false);
            if (isArrayAssignmentStatement(statement)) markWrite(statement.name, true);
            if (isUnpackStatement(statement))
                for (const name of statement.names) if (name !== '#') markWrite(name, false);
        }
        const node = this.debugStatement?.$cstNode;
        const line = node?.range.start.line;
        const describe = (value: RankValue): string => {
            if (typeof value === 'string') return JSON.stringify(value.slice(0, 200)) + (value.length > 200 ? '…' : '');
            if (value === null || typeof value !== 'object') return String(value);
            if (isRankArray(value)) {
                // A ranked array's shape getter can run a user function. Inspection
                // must not evaluate it, especially while paused inside that function.
                const shape = Object.getOwnPropertyDescriptor(value, 'shape');
                return shape && 'value' in shape ? `<array shape ${shape.value.join(' × ')}>`
                    : '<array shape not evaluated>';
            }
            if (isRankSequence(value)) return `<sequence ${value.plan.name}>`;
            return `<${value.kind}>`;
        };
        const bindings = (scope: LocalFrame | Map<string, RankValue>) => {
            const values = scope instanceof LocalFrame ? scope.values : scope;
            const entries = [...values].filter(([, value]) => !isNativeFunction(value));
            const lines: string[] = [];
            for (const [name, value] of entries) {
                if (lines.length === 100) { lines.push('  …'); break; }
                lines.push(`  ${name} = ${describe(value)}`);
                inspected.push({ name, read: reads.delete(name), write: writes.get(name) === scope });
            }
            return lines.join('\n') || '  (none)';
        };
        const location = node && line !== undefined
            ? `${sourceIds.get(node.root) ?? this.options.sourceId ?? '<input>'}:${line + 1}\n${node.root.fullText.split(/\r?\n/)[line]}` : '<result preview>';
        const current = this.localFrame ?? this.variables;
        const seen = new Set<object>([current]);
        const sections = [`Variables (current scope):\n${bindings(current)}`];
        for (const call of [...this.debugCalls].reverse()) {
            if (seen.has(call.frame)) continue;
            seen.add(call.frame);
            sections.push(`${call.name} locals:\n${bindings(call.frame)}`);
        }
        if (!seen.has(this.variables)) sections.push(`Globals:\n${bindings(this.variables)}`);
        return { state: `${location}\n\nCall stack (outermost first):\n<cell>\n${this.debugCalls.map(call => call.name).join('\n')}\n\n${sections.join('\n\n')}`,
            bindings: inspected };
    }

    private callDepth = 0;
    private readonly maxCallDepth: number;

    constructor(output: Output = console.log, options: InterpreterOptions = {}) {
        this.output = output;
        // Keep Rank locals observable in interactive workers. Other hosts retain
        // all compiler defaults; native sequence algorithms remain unchanged.
        this.options = inspectionEnabled() ? { ...options, integerLoopCompilation: false,
            scalarFunctionCompilation: false, scalarEntryCompilation: false,
            blockCompilation: false, scalarCompilation: false, tensorFusion: false, functionBodyCompilation: false } : options;
        this.random = seedableRandom(options.random);
        this.maxCallDepth = options.maxCallDepth ?? 200_000;
        if (!Number.isSafeInteger(this.maxCallDepth) || this.maxCallDepth < 1) {
            throw new RankError('maxCallDepth must be a positive safe integer');
        }
        this.reductions = new ReductionEvaluator(
            (operator, left, right) => this.evaluateBinary(operator, left, right),
            name => this.resolve(name), this.standardFunctions, this.options.tensorFusion !== false,
        );
        this.rankApplication = new RankApplication(
            (fn, args) => this.invoke(fn, args),
            value => this.resources.ownFiles(value), this.standardFunctions,
        );
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
        if (program.$cstNode) sourceIds.set(program.$cstNode.root, this.options.sourceId ?? '<input>');
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
        if (program.$cstNode) sourceIds.set(program.$cstNode.root, this.options.sourceId ?? '<input>');
        validateFunctionPlacement(program.statements, 'top');
        this.checkBuiltinBindings(program);
        this.declareFunctions(program.statements);
        return program.statements.filter(isFunctionStatement).map(statement => statement.name);
    }

    /** Includes inferred global types whose declaration has not produced a value yet. */
    bindingNames(): ReadonlySet<string> {
        return new Set([...this.variables.keys(), ...this.variableTypes.keys()]);
    }

    /** Assignment contracts for editor diagnostics, copied without exposing runtime state. */
    bindingTypeNames(name: string): readonly string[] | undefined {
        const types = this.variableTypes.get(name);
        return types === undefined ? undefined : [...types];
    }

    bindingArrayRank(name: string): number | undefined {
        return this.variableArrayRanks.get(name);
    }

    /** Copy the current bindings without rerunning the program that produced them. */
    forkForPreview(output: Output = this.output): Interpreter {
        const { wrapSinglePassSequence: _singlePass, wrapStoredSequence: _stored,
            persistentResources: _persistent, ...options } = this.options;
        const fork = new Interpreter(output, options);
        for (const module of this.modules) fork.modules.add(module);
        for (const name of this.sourceBindings) fork.sourceBindings.add(name);
        for (const [name, types] of this.variableTypes) fork.variableTypes.set(name, types);
        for (const [name, rank] of this.variableArrayRanks) fork.variableArrayRanks.set(name, rank);
        for (const [name, child] of this.aliases) fork.aliases.set(name, child.forkForPreview(output));
        for (const [name, value] of this.variables) {
            const source = isNativeFunction(value) ? this.sourceFunctions.get(value) : undefined;
            if (source && isNativeFunction(value)) fork.sourceFunctions.set(value, source);
            const definition = isNativeFunction(value) ? functionDefinitions.get(value) : undefined;
            if (!definition || definition.context) fork.variables.set(name, clonePreviewValue(value));
        }
        // Rebuild top-level user functions so their calls use the fork rather than
        // the original interpreter captured by the function object.
        for (const value of this.variables.values()) {
            const definition = isNativeFunction(value) ? functionDefinitions.get(value) : undefined;
            if (definition && !definition.context) fork.defineFunction(definition.statement);
        }
        return fork;
    }

    /** A notebook can replace declarations without relaxing assignment type checks. */
    forgetBindings(names: Iterable<string>): void {
        for (const name of names) {
            this.variables.delete(name);
            this.sourceBindings.delete(name);
            this.variableTypes.delete(name);
            this.variableArrayRanks.delete(name);
        }
    }

    dispose(): void {
        for (const child of this.aliases.values()) child.dispose();
        this.resources.dispose();
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
        this.resources.pushScope(resources);
        try {
            return this.withLexicalFrame(frame, operation);
        } finally {
            this.resources.popScope();
        }
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
            if (isFunctionStatement(statement)) this.defineFunction(statement);
        }
    }

    private checkBuiltinBindings(program: Program, modules = this.modules): void {
        const existing: (string | FunctionStatement)[] = [...this.sourceBindings, ...this.aliases.keys()];
        for (const value of this.variables.values()) {
            const statement = isNativeFunction(value) ? this.sourceFunctions.get(value) : undefined;
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

    private debugPoint(statement: Statement, iteration = false): void {
        if (!inspectionEnabled()) return;
        this.debugStatement = statement;
        inspectExecution(() => this.inspectionState());
        const node = statement.$cstNode;
        if (!node) return;
        const loops: object[] = [];
        for (let parent = statement as import('langium').AstNode | undefined; parent; parent = parent.$container) {
            if (isForStatement(parent)) loops.unshift(parent);
        }
        debugExecutionPoint({ source: node.root.fullText, line: node.range.start.line + 1,
            loops, depth: this.debugCalls.length, iteration: iteration ? statement : undefined,
            topLevel: statement.$container?.$type === 'Program' });
    }

    private preparedStatement(statements: Statement[], index: number): PreparedStatement {
        const statement = statements[index];
        this.debugPoint(statement);
        let prepared = this.statements.get(statement);
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
            this.statements.set(statement, prepared);
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
                if (fresh & 1) interpreter.unbind(names[index]);
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

    private unbind(name: string): void {
        const frame = this.localFrame;
        if (frame) frame.unset(name);
        else {
            this.variables.delete(name);
            this.variableTypes.delete(name);
            this.variableArrayRanks.delete(name);
        }
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
                return this.resolve(name) === this.standardFunctions.get(standardModules[module][name]);
            },
        });
        if (!kernel) return recordFallback('tensor:unsupported');
        const last = statements[index + kernel.count - 1];
        if (!isAssignmentStatement(last) && !isReturnStatement(last)) return undefined;
        const assign = isAssignmentStatement(last) ? this.compileAssign(last.name) : undefined;
        return { count: kernel.count, run: () => {
            if (!assign && this.localFrame === undefined) return undefined;
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
                        interpreter.debugPoint(statement, true);
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
                        interpreter.debugPoint(statement, true);
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
                        const frame = this.localFrame?.find(name);
                        direct = frame ? frame.bindStore(name) : next => { this.variables.set(name, next); };
                    };
                } : undefined,
                textLoops: this.options.textLoopCompilation !== false,
                textArrayLoops: this.options.textArrayLoopCompilation !== false,
                nestedLoops: this.options.nestedLoopCompilation !== false,
                arrayRead: atArray,
                textRead: (source, index) => applySelectors([source, index]) as string,
                returns: this.options.loopReturnCompilation !== false,
                canReturn: () => this.localFrame !== undefined,
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
                        return isNativeFunction(value) && value === this.standardFunctions.get(standardModules[module][name])
                            ? this.options.typedNativeCalls === false ? value.call : typedNativeCall(value, types)
                            : undefined;
                    } catch { return undefined; }
                },
                scalarFunction: (name, arity) => {
                    if (this.options.scalarCallCompilation === false) return undefined;
                    const value = this.findVariable(name);
                    const definition = value && isNativeFunction(value) ? functionDefinitions.get(value) : undefined;
                    if (!definition || definition.statement.parameters.length !== arity) return undefined;
                    const statement = definition.statement;
                    const proof = scalarFunctionResult(statement, this.options.scalarBlockCalls !== false);
                    if (!proof) return undefined;
                    const captures = definition.context !== undefined;
                    return { type: proof.type, locals: captures ? proof.locals : [], bind: () => {
                        const current = this.findVariable(name);
                        if (!current || !isNativeFunction(current)) return undefined;
                        const active = functionDefinitions.get(current);
                        if (active?.statement !== statement || (active.context !== undefined) !== captures
                            || proof.locals.some(local => active.context?.find(local))) return undefined;
                        const compiled = active.interpreter.prepareScalarFunctionCall(statement);
                        return (arguments_, tail = false) => {
                            if (tail && active.interpreter === this) {
                                throw new TailCallSignal(active, arguments_,
                                    this.options.compiledScalarTailCalls !== false ? compiled : undefined);
                            }
                            return compiled ? compiled(arguments_) : current.call(arguments_);
                        };
                    } };
                },
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
                    try { return this.resolve(name) === this.standardFunctions.get(standardModules[module][name]); }
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
                        (operator, left, right) => interpreter.evaluateBinary(operator, left, right)));
                    return value;
                }
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
                            throw new RankError('+ segment range assignment supports = and +=');
                        }
                        return value;
                    }
                    if (selectors.length !== 1 || typeof selectors[0] !== 'bigint') {
                        throw new RankError('segment assignment expects one integer index');
                    }
                    const value = yield* resume(interpreter.evaluateTask(statement.value));
                    const result = statement.operator === '=' ? value : interpreter.evaluateBinary(
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
                        receiver = interpreter.applySelectors([receiver, selector]);
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
                            return interpreter.evaluateBinary(operator, previous, operand);
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
                    : interpreter.evaluateBinary(
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
                                : this.evaluateBinary(operator, target.items[offset], value);
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
                    const result = stored(operator === undefined ? direct() : this.evaluateBinary(
                        operator, this.resolveVariable(statement.name), direct(),
                    ));
                    write(result);
                    return result;
                } };
            }
            return { stream: () => {
                const previous = operator === undefined ? undefined : this.resolveVariable(statement.name);
                return mapResult(this.evaluateTask(statement.value), value => {
                    const result = stored(operator === undefined ? value : this.evaluateBinary(operator, previous!, value));
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
                binary: (op, left, right) => this.evaluateBinary(op, left, right),
                unary: (op, value) => this.evaluateUnary(op, value),
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
        if (isLabelLiteral(expression)) return () => ({ kind: 'label', name: expression.name });
        if (isNameExpression(expression)) {
            if (nameNeedsExecution(expression)) return undefined;
            const name = expression.name;
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
            return operand ? () => this.evaluateUnary(expression.operator, operand()) : undefined;
        }
        if (isBinaryExpression(expression) && expression.operator !== 'default'
            && expression.operator !== '**'
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
                    return this.decidesGuard(operator, value) ? value : this.evaluateGuard(operator, value, right());
                };
            }
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
        classify = true,
    ): () => Evaluation<RankValue> {
        const interpreter = this;
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
                    compiled = this.compileApplicationForm(expression, form, missing, tail);
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
                        for (let index = 0n; index < count; index += 1n) {
                            yield interpreter.readStdin(mode);
                        }
                    },
                });
            };
        }
        if (isArrayExpression(expression)) {
            return function* (): Execution<RankValue> {
                const items = yield* resume(mapExecution(expression.rows.length > 0
                    ? expression.rows.flatMap(row => row.items)
                    : expression.items, item => interpreter.evaluateArrayItem(item)));
                if (expression.dimensions.length === 0) return array(items);
                const shape = yield* resume(mapExecution(expression.dimensions, item => interpreter.arrayDimension(item)));
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
            get localFrame() { return interpreter.localFrame; },
            set localFrame(frame) { interpreter.localFrame = frame; },
            requireModule: (module, operation) => interpreter.requireModule(module, operation),
            evaluate: node => interpreter.evaluateTask(node),
            select: values => interpreter.applySelectors(values),
            binary: (operator, left, right) => interpreter.evaluateBinary(operator, left, right),
            resolve: name => interpreter.resolve(name),
            findVariable: name => interpreter.findVariable(name),
            isStandardFunction: (module, name, value) => {
                const factory = standardModules[module]?.[name];
                return factory !== undefined && interpreter.standardFunctions.get(factory) === value;
            },
            maskSelection,
        }));
        if (tableQuery) return tableQuery;
        const clause = compileClauseExpression(expression, () => ({
            get localFrame() { return interpreter.localFrame; },
            set localFrame(frame) { interpreter.localFrame = frame; },
            evaluate: node => interpreter.evaluateTask(node),
            binary: (operator, left, right) => interpreter.evaluateBinary(operator, left, right),
            findVariable: name => interpreter.findVariable(name),
        }));
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
                    source = interpreter.applySelectors([source, { kind: 'label', name: expression.field.name }]);
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
                    const definition = functionDefinitions.get(value);
                    if (definition?.interpreter === interpreter) throw new TailCallSignal(definition, []);
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
                return interpreter.evaluateUnary(expression.operator, (yield* resume(interpreter.evaluateTask(expression.operand))));
            };
        }
        if (isBinaryExpression(expression)) {
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
                            const items = value.items;
                            if (!items.includes(absent)) return value;
                            const fallback = yield* resume(interpreter.evaluateTask(expression.right));
                            return createArraySnapshot(
                                items.map(item => item === absent ? fallback : item),
                                value.shape,
                            );
                        }
                        if (value !== absent) return value;
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
                    interpreter.decidesGuard(operator, left) ? completed(left)
                        : mapResult(right(), value => interpreter.evaluateGuard(operator, left, value)));
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
        return isNativeFunction(value) ? builtinOperations.get(value) ?? false : false;
    }

    private compileApplicationForm(
        expression: Expression, form: ApplicationForm, missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const interpreter = this;
        const parts = flattenApplication(expression);
        switch (form.kind) {
            case 'collection-mutation': throw new RankError('collection mutation requires a statement');
            case 'invalid': throw new RankError(form.message);
            case 'comparison-rank': {
                const comparison = form;
                return function* (): Execution<RankValue> {
                    const left = yield* resume(interpreter.evaluateTask(comparison.left));
                    const right = yield* resume(interpreter.evaluateTask(comparison.right));
                    return interpreter.compareAtRank(left, right, comparison);
                };
            }
            case 'outer': {
                const outer = form;
                if (outer.operands.length !== 2) {
                    throw new RankError(`outer expects two operands, got ${outer.operands.length}`);
                }
                return function* (): Execution<RankValue> {
                    return interpreter.evaluateOuter(
                        outer.operator,
                        (yield* resume(interpreter.evaluateTask(outer.operands[0]))),
                        (yield* resume(interpreter.evaluateTask(outer.operands[1]))),
                    );
                };
            }
            case 'segment': {
                const symbolicSegment = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('algo', 'segment');
                    if (!SEGMENT_OPERATORS.has(symbolicSegment.operator)) {
                        throw new RankError('segment requires an associative operation');
                    }
                    const source = yield* resume(interpreter.evaluateTask(symbolicSegment.source));
                    const values = segmentItems(source);
                    if (symbolicSegment.operator === '+'
                        && values.every(value => typeof value === 'bigint'
                            || typeof value === 'number')) {
                        return new RankRangeSumSegment(values);
                    }
                    return new RankSegment(
                        values,
                        (left, right) => interpreter.evaluateBinary(
                            symbolicSegment.operator, left, right,
                        ),
                        symbolicSegment.operator,
                    );
                };
            }
            case 'scan': {
                const scan = form;
                return function* (): Execution<RankValue> {
                    const source = yield* resume(interpreter.evaluateTask(scan.source));
                    const seed = scan.seed === undefined
                        ? undefined
                        : yield* resume(interpreter.evaluateTask(scan.seed));
                    return interpreter.reductions.evaluateScan(
                        scan.operator,
                        source,
                        seed,
                    );
                };
            }
            case 'reduce': {
                const reduction = { ...form, rank: form.rank === undefined ? undefined
                    : safeDimension(integerLiteral(form.rank, 'rank'), 'rank') };
                const fused = reduction.rank === undefined && reduction.seed === undefined ? compileFusedReduction(
                    reduction.source, reduction.operator, {
                        prepareLeaf: source => interpreter.compileDirectExpression(source),
                        binary: (operator, a, b) => interpreter.evaluateBinary(operator, a, b),
                        reduce: value => interpreter.reductions.evaluateReduction(reduction.operator, value),
                    },
                ) : undefined;
                if (fused) return () => completed(fused());
                return function* (): Execution<RankValue> {
                    const source = yield* resume(interpreter.evaluateTask(reduction.source));
                    const seed = reduction.seed === undefined
                        ? undefined
                        : yield* resume(interpreter.evaluateTask(reduction.seed));
                    return interpreter.reductions.evaluateReduction(
                        reduction.operator,
                        source,
                        reduction.rank,
                        seed,
                    );
                };
            }
            case 'sort-direction': {
                const sortDirection = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'sort direction');
                    const direction = sortDirection.direction;
                    const parts = flattenApplication(expression).slice(0, -1);
                    const inner = applicationForm(parts, name => interpreter.applicationOperation(name));
                    if (inner.kind === 'invalid') throw new RankError(inner.message);
                    const axis = inner.kind === 'axis-argsort' ? inner : undefined;
                    const ranked = inner.kind === 'rank' ? inner : undefined;
                    const name = sortDirection.operation.name;
                    if (name !== 'sort' && name !== 'argsort') {
                        throw new RankError('sort direction must follow sort or argsort', 'TypeError');
                    }
                    const fn = interpreter.resolve(name);
                    if (fn !== interpreter.standardFunctions.get(standardModules.sequences[name]) || !isNativeFunction(fn)) {
                        throw new RankError('sort direction requires the standard sort or argsort', 'TypeError');
                    }
                    const descending = sortDescending(yield* resume(interpreter.evaluateTask(direction)));
                    if (axis) return argsortAxis(yield* resume(interpreter.evaluateTask(axis.source)), axis.axis, descending);
                    const source = yield* resume(interpreter.evaluateTask(applicationParts((ranked?.parts ?? parts).slice(0, -1))));
                    const directed: NativeFunction = { ...fn, call: args => name === 'sort'
                        ? sortValue(args[0], descending) : argsortValue(args[0], descending) };
                    return yield* resume(ranked
                        ? interpreter.applyAtRank([source, directed], ranked.rank, ranked.axes)
                        : interpreter.rankApplication.applyIntrinsicRank(directed, [source]));
                };
            }

            case 'unpack': {
                return function* (): Execution<RankValue> {
                    const values: RankValue[] = [];
                    for (const part of parts) {
                        if (isUnpackExpression(part)) {
                            const source = yield* resume(interpreter.evaluateTask(part.value));
                            values.push(...unpackApplicationItems(source));
                        } else {
                            values.push(isAllAxisExpression(part)
                                ? ALL_AXIS
                                : yield* resume(interpreter.evaluateTask(part)));
                        }
                    }
                    return yield* resume(interpreter.apply(values, missing, 0, [], tail));
                };
            }
            case 'new-graph': {
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
            case 'new-dsu': {
                if (parts.length !== 2) throw new RankError('new dsu expects one collection');
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('graph', 'new dsu');
                    return dsuFrom(yield* resume(interpreter.evaluateTask(parts[1])));
                };
            }
            case 'named-outer': {
                const namedOuter = form;
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
            case 'rank': {
                const explicitRank = form;
                return function* (): Execution<RankValue> {
                    if (explicitRank.parts.length === 3) {
                        const left = yield* resume(interpreter.evaluateTask(explicitRank.parts[0]));
                        const right = yield* resume(interpreter.evaluateTask(explicitRank.parts[1]));
                        const operation = yield* resume(interpreter.evaluateTask(explicitRank.parts[2]));
                        if (isNativeFunction(operation) && (operation.dyadicRanks || operation.arities.includes(2))) {
                            return yield* resume(interpreter.rankApplication.applyDyadicAtRank(
                                left, right, operation, Number(explicitRank.rank),
                                explicitRank.rightRank === undefined ? undefined : Number(explicitRank.rightRank),
                            ));
                        }
                    }
                    if (explicitRank.rightRank !== undefined) {
                        throw new RankError('rank L R expects a binary operation');
                    }
                    const source = yield* resume(interpreter.evaluateTask(
                        applicationParts(explicitRank.parts.slice(0, -1)),
                    ));
                    const operation = yield* resume(interpreter.evaluateTask(explicitRank.parts.at(-1)!));
                    return yield* resume(interpreter.applyAtRank([source, operation], explicitRank.rank, explicitRank.axes));
                };
            }
            case 'axis-matmul': {
                const axisMatmul = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('linalg', 'matmul');
                    return matmulValues(
                        (yield* resume(interpreter.evaluateTask(axisMatmul.left))),
                        (yield* resume(interpreter.evaluateTask(axisMatmul.right))),
                        axisMatmul.axes,
                    );
                };
            }
            case 'axis-covariance': {
                const axisCovariance = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('stats', 'covariance');
                    return covarianceValue(
                        (yield* resume(interpreter.evaluateTask(axisCovariance.source))),
                        axisCovariance.axes,
                    );
                };
            }
            case 'axis-correlation': {
                const axisCorrelation = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('stats', axisCorrelation.name);
                    return correlationValue(
                        (yield* resume(interpreter.evaluateTask(axisCorrelation.source))),
                        axisCorrelation.axes,
                    );
                };
            }
            case 'axis-quantile': {
                const axisQuantile = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('stats', axisQuantile.isPercentile ? 'percentile' : 'quantile');
                    return quantileValue(
                        (yield* resume(interpreter.evaluateTask(axisQuantile.source))),
                        (yield* resume(interpreter.evaluateTask(axisQuantile.q))),
                        axisQuantile.axes,
                        axisQuantile.isPercentile,
                    );
                };
            }
            case 'text-format': {
                const textFormat = form.position;
                const format = parts[textFormat + 1];
                if (!isStringLiteral(format)) throw new RankError('expected text format');
                return function* (): Execution<RankValue> {
                    const values = yield* resume(mapExecution(parts.slice(0, textFormat),
                        part => interpreter.evaluateTask(part)));
                    const source = values.length === 1 ? values[0] : yield* resume(interpreter.apply(values));
                    const result = formattedText(source, format.value);
                    const remaining = yield* resume(mapExecution(parts.slice(textFormat + 2),
                        part => interpreter.evaluateTask(part)));
                    return remaining.length ? yield* resume(interpreter.apply([result, ...remaining], missing, 0, [], tail)) : result;
                };
            }
            case 'axis-window': {
                const axisWindow = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'window');
                    return windowValue(
                        (yield* resume(interpreter.evaluateTask(axisWindow.source))),
                        (yield* resume(interpreter.evaluateTask(axisWindow.size))),
                        axisWindow.axes,
                        axisWindow.stride
                            ? (yield* resume(interpreter.evaluateTask(axisWindow.stride)))
                            : undefined,
                        axisWindow.padding
                            ? (yield* resume(interpreter.evaluateTask(axisWindow.padding)))
                            : undefined,
                        axisWindow.fill
                            ? (yield* resume(interpreter.evaluateTask(axisWindow.fill)))
                            : undefined,
                    );
                };
            }
            case 'axis-shift': {
                const axisShift = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'shift');
                    return shiftValue(
                        (yield* resume(interpreter.evaluateTask(axisShift.source))),
                        (yield* resume(interpreter.evaluateTask(axisShift.amount))),
                        axisShift.fill
                            ? (yield* resume(interpreter.evaluateTask(axisShift.fill)))
                            : undefined,
                        axisShift.axis,
                    );
                };
            }
            case 'axis-shuffle': {
                const axisShuffle = form;
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
            case 'axis-length': {
                const axisLength = form;
                return function* (): Execution<RankValue> {
                    return lengthOfAxis((yield* resume(interpreter.evaluateTask(axisLength.source))), axisLength.axis);
                };
            }
            case 'axis-argsort': {
                const axisArgsort = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'argsort');
                    return argsortAxis(
                        (yield* resume(interpreter.evaluateTask(axisArgsort.source))),
                        axisArgsort.axis,
                    );
                };
            }
            case 'axis-metric': {
                const axisMetric = form;
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
            case 'axis-reduction': {
                const axisReduction = form;
                const axes = axisReduction.axes.map(axis =>
                    safeDimension(integerLiteral(axis, `${axisReduction.operation.name} axis`),
                        `${axisReduction.operation.name} axis`));
                return function* (): Execution<RankValue> {
                    interpreter.requireModule(axisReduction.operation.module, axisReduction.operation.name);
                    return interpreter.reductions.evaluateAxisReduction(
                        axisReduction.operation.name,
                        (yield* resume(interpreter.evaluateTask(axisReduction.source))),
                        axes,
                    );
                };
            }
            case 'axis-transpose': {
                const axisTranspose = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('sequences', 'transpose');
                    return transposeValue(
                        (yield* resume(interpreter.evaluateTask(axisTranspose.source))),
                        axisTranspose.axes,
                    );
                };
            }
            case 'named-segment': {
                const namedSegment = form;
                return function* (): Execution<RankValue> {
                    interpreter.requireModule('algo', 'segment');
                    const source = yield* resume(interpreter.evaluateTask(namedSegment.source));
                    const identity = namedSegment.identity
                        ? yield* resume(interpreter.evaluateTask(namedSegment.identity)) : undefined;
                    const operation = yield* resume(interpreter.evaluateTask(namedSegment.operation));
                    if (!isNativeFunction(operation) || !operation.arities.includes(2)) {
                        throw new RankError('segment requires a binary operation');
                    }
                    const values = source instanceof FlatRecords ? source : segmentItems(source);
                    const maxSum = interpreter.standardFunctions.get(standardModules.algo.maxsum);
                    if (operation === maxSum && identity === undefined && !(values instanceof FlatRecords)) return new RankMaxSumSegment(values);
                    return new RankSegment(
                        values,
                        (left, right) => operation.call([left, right]),
                        operation.name,
                        operation,
                        identity,
                    );
                };
            }
            case 'named-scan': {
                const namedScan = form;
                return function* (): Execution<RankValue> {
                    const source = yield* resume(interpreter.evaluateTask(namedScan.source));
                    const seed = namedScan.seed === undefined
                        ? undefined : yield* resume(interpreter.evaluateTask(namedScan.seed));
                    const operation = yield* resume(interpreter.evaluateTask(namedScan.operation));
                    if (!isNativeFunction(operation) || !operation.arities.includes(2)) {
                        throw new RankError('scan requires a binary operation');
                    }
                    return interpreter.reductions.scanValues(source, operation.name, seed,
                        (left, right) => operation.call([left, right]));
                };
            }
            case 'axis-selection': {
                const axisSelection = form;
                return function* (): Execution<RankValue> {
                    return selectAxis(
                        (yield* resume(interpreter.evaluateTask(axisSelection.source))),
                        axisSelection.axis,
                        (yield* resume(interpreter.evaluateTask(axisSelection.selector))),
                    );
                };
            }
            case 'graph-edges': {
                const graphEdges = form;
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
            case 'dsu-method': {
                const dsuMethod = form;
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(interpreter.evaluateTask(dsuMethod.receiver));
                    const arguments_ = yield* resume(mapExecution(
                        dsuMethod.arguments,
                        argument => interpreter.evaluateTask(argument),
                    ));
                    if (isRankDsu(receiver)) {
                        interpreter.requireModule('graph', dsuMethod.operation);
                        if (dsuMethod.operation === 'findroot') return receiver.find(arguments_[0]);
                        if (dsuMethod.operation === 'merge') {
                            return receiver.merge(arguments_[0], arguments_[1]);
                        }
                        return receiver.connected(arguments_[0], arguments_[1]);
                    }
                    const operation = yield* resume(interpreter.evaluateTask(dsuMethod.operationExpression));
                    return yield* resume(interpreter.apply(
                        [receiver, ...arguments_, operation], missing, 0, [], tail,
                    ));
                };
            }
            case 'functional-method': {
                const functionalMethod = form;
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(interpreter.evaluateTask(
                        functionalMethod.receiver,
                    ));
                    const arguments_ = yield* resume(mapExecution(
                        functionalMethod.arguments,
                        argument => interpreter.evaluateTask(argument),
                    ));
                    if (isRankFunctionalGraph(receiver)) {
                        interpreter.requireModule('graph', functionalMethod.operation);
                        return functionalMethod.operation === 'jump'
                            ? receiver.jump(arguments_[0], arguments_[1])
                            : receiver.distance(arguments_[0], arguments_[1]);
                    }
                    const operation = yield* resume(interpreter.evaluateTask(
                        functionalMethod.operationExpression,
                    ));
                    return yield* resume(interpreter.apply(
                        [receiver, ...arguments_, operation], missing, 0, [], tail,
                    ));
                };
            }
            case 'multiset-method': {
                const multisetMethod = form;
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
            case 'materialize-pipeline': {
                const materializePipeline = form;
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
            case 'plain': {
                if (!isApplicationExpression(expression)) return this.compileExpression(expression, missing, tail, false);
                if (parts.length === 2 && isNamed(parts[1], 'sum')) {
                    const fused = compileFusedSum(parts[0], {
                        prepareLeaf: source => interpreter.compileDirectExpression(source),
                        binary: (operator, a, b) => interpreter.evaluateBinary(operator, a, b),
                    }, (value, sum) => {
                        const fn = interpreter.resolve('sum');
                        if (isNativeFunction(fn) && fn === interpreter.standardFunctions.get(standardModules.core.sum)) {
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
            default: return assertNever(form);
        }
    }

    private compileApplication(
        parts: Expression[], missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const interpreter = this;
        const renamed = renamedBuiltinCall(parts);
        const checkRename = renamed ? (receiver: RankValue): void => {
            if (typeName(receiver) === renamed.receiver
                && interpreter.applicationOperation(renamed.operation.name) !== false) {
                throw new RankError(renamed.message, 'BuiltinRename');
            }
        } : undefined;
        const directParts = parts.map(part => isAllAxisExpression(part)
            ? () => ALL_AXIS : this.compileDirectExpression(part));
        if (directParts.every(part => part !== undefined)) {
            const last = parts.at(-1)!;
            if (!tail && (parts.length === 2 || parts.length === 3) && isNameExpression(last)) {
                const [left, right, operation] = directParts;
                const binary = parts.length === 3;
                return () => {
                    const a = left();
                    checkRename?.(a);
                    const b = binary ? right() : undefined;
                    const arguments_ = binary ? [a, b!] : [a];
                    // `Record .field fn` reads the field first, on the general path.
                    const simple = !isNativeFunction(a) && (b === undefined || !isNativeFunction(b))
                        && !(b !== undefined && isRankLabel(b) && hasField(a, b.name));
                    const fn = (binary ? operation : right)();
                    if (simple && isNativeFunction(fn) && fn.arities.includes(arguments_.length)) {
                        const result = this.rankApplication.applyIntrinsicRank(fn, arguments_);
                        if ('done' in result) {
                            this.resources.ownFiles(result.value);
                            return result;
                        }
                        return this.finishApplication(result);
                    }
                    return this.apply([...arguments_, fn], missing, 0, [], tail);
                };
            }
            return () => this.apply(directParts.map((part, index) => {
                const value = part();
                if (index === 0) checkRename?.(value);
                return value;
            }), missing, 0, [], tail);
        }
        return () => flatMapResult(mapExecution(parts, part => {
            const task = isAllAxisExpression(part) ? completed(ALL_AXIS) : interpreter.evaluateTask(part);
            return checkRename && part === parts[0] ? mapResult(task, value => {
                checkRename(value);
                return value;
            }) : task;
        }), values => interpreter.apply(values, missing, 0, [], tail));
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

    private evaluateAddressParts(item: AddressItem): Evaluation<RankValue[]> {
        if (!item.spread) return mapResult(this.evaluateAddressItem(item), value => [value]);
        if (!item.value) throw new RankError('missing unpack expression');
        return mapResult(this.evaluateTask(item.value), unpackApplicationItems);
    }

    private *arrayDimension(item: ArrayItem): Execution<number> {
        const dimension = expectInteger((yield* resume(this.evaluateArrayItem(item))));
        return checkedArrayDimension(dimension);
    }

    private useStandard(module: string): void {
        if (!(module in standardModules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        const modules = new Set([...this.modules, module]);
        this.checkBuiltinBindings({ $type: 'Program', statements: [] }, modules);
        this.modules.add(module);
    }

    private defineFunction(statement: FunctionStatement): RankValue {
        if (availableBuiltin(statement.name, this.modules)) {
            throw new RankError(builtinBindingMessage(statement.name), 'TypeError');
        }
        const { generator } = prepareFunction(statement);
        if (statement.memo && generator) throw new RankError('memo functions cannot yield');
        const context = this.localFrame;
        const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
        const compiled = !inspectionEnabled() && only && isReturnStatement(only) && only.value
            ? this.compileDirectExpression(only.value) : undefined;
        const direct = compiled ? () => {
            try { return compiled(); }
            catch (error) { throw this.locateError(error, only!); }
        } : undefined;
        const proof = this.options.scalarEntryCompilation !== false && !generator
            ? scalarFunctionResult(statement, true) : undefined;
        const scalar = proof ? this.prepareScalarFunctionCall(statement) : undefined;
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
                    throw this.locateError(error, statement);
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
        const fn: NativeFunction = {
            kind: 'function',
            name: statement.name,
            arities: [statement.parameters.length],
            monadicRank: 'all',
            monadicResultShape: generator ? undefined
                : cellShape => this.userResultCellShape(statement, context, returnRanks, cellShape),
            dyadicRanks: statement.parameters.length === 2 ? ['all', 'all'] : undefined,
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
        this.sourceFunctions.set(fn, statement);
        if (!generator) {
            functionExecutions.set(fn, execute);
            // A memo call must return through its cache writer. Do not bypass it
            // via the tail-call path that enters an ordinary function body.
            if (!statement.memo) functionDefinitions.set(fn, { interpreter: this, statement, context, direct, specialization });
        }
        if (!generator && !statement.memo && this.options.scalarFunctionCompilation !== false) {
            registerFlatCombine(fn, statement, builtins => {
                if (this.callDepth >= this.maxCallDepth) return false;
                for (const name of builtins) {
                    // Rank locals cannot hide core names; only host-injected globals need a guard.
                    const bound = this.variables.get(name);
                    if (bound !== undefined) {
                        if (bound !== this.standardFunctions.get(standardModules.core[name])) return false;
                    }
                }
                return true;
            });
        }
        this.assign(statement.name, fn);
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
        const valueOf = (name: string) => context?.lookup(name) ?? this.variables.get(name);
        const functionValue = (name: string) => {
            const value = valueOf(name);
            return value !== undefined && isNativeFunction(value) ? value : undefined;
        };
        const cell: ValueFacts = cellShape.length === 0
            ? { types: ['integer'], rank: 0, shape: [] }
            : { types: ['array'], rank: cellShape.length, shape: cellShape,
                elements: ['integer'], eagerScalarCells: true };
        const result = functionEffects(
            name => name === statement.name ? statement : this.sourceFunctions.get(functionValue(name)!),
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

    private prepareScalarFunctionCall(statement: FunctionStatement): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined {
        if (this.options.scalarFunctionCompilation === false) return undefined;
        const kernel = compileScalarFunction(statement);
        if (!kernel) return undefined;
        const locate = (error: unknown, index: number) => this.locateError(error, kernel.locations[index] ?? statement);
        return (arguments_, tail = false) => {
            if (!tail && this.callDepth >= this.maxCallDepth) {
                throw new RankError(`function call depth exceeds ${this.maxCallDepth}`, 'RecursionLimit');
            }
            if (!tail) this.callDepth += 1;
            try {
                this.options.onScalarFunctionExecuted?.();
                return kernel.run(arguments_, locate);
            } catch (error) {
                if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                throw error;
            } finally { if (!tail) this.callDepth -= 1; }
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
        const lookup = (name: string) => parent?.lookup(name) ?? this.variables.get(name);
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
            return helper?.interpreter === this && helper.context === parent ? helper.statement : undefined;
        }, name => {
            const bound = lookup(name);
            bindings.set(name, bound);
            const expected = standardModules.core[name];
            const actual = bound ?? this.resolve(name);
            return actual === this.standardFunctions.get(expected);
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
        if (this.callDepth >= this.maxCallDepth) {
            throw new RankError(`function call depth exceeds ${this.maxCallDepth}`, 'RecursionLimit');
        }
        const frame = this.functionFrame(statement, arguments_, context);
        this.callDepth += 1;
        return this.resources.withResourceScope(() => {
            try {
                return this.withLexicalFrame(frame, direct);
            } catch (error) {
                if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                throw error;
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
        const callerStatement = this.debugStatement;
        const caller = this.localFrame;
        const scope = new Set<RankFile>();
        this.resources.pushScope(scope);
        this.localFrame = frame;
        this.callDepth += 1;
        if (inspectionEnabled()) this.debugCalls.push({ name: statement.name, frame });
        let result: RankValue | undefined;
        let pending: unknown;
        let compiledTail = false;
        const tailContracts = new Set<ReturnContract>();
        try {
            while (true) {
                checkpoint();
                try {
                    this.localFrame = frame;
                    if (inspectionEnabled()) this.debugCalls[this.debugCalls.length - 1] = { name: statement.name, frame };
                    for (const local of prepareFunction(statement, argumentSignature(arguments_)).locals) this.defineFunction(local);
                    const body = this.compiledFunctionBody(statement, arguments_);
                    if (body) {
                        result = yield* resume(body({ assertBooleanExpressions: false, insideLoop: false,
                            insideFinally: false, insideGenerator: false }));
                        break;
                    }
                    yield* resume(this.executeStatementStream(statement.statements));
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
            if (inspectionEnabled()) {
                this.debugCalls.pop();
                this.debugStatement = callerStatement;
                inspectExecution(() => this.inspectionState());
            }
            if (pending instanceof RankError && !compiledTail) pending.addCall(statement.name, statement.parameters, arguments_);
            if (pending === undefined && result !== undefined) {
                try { for (const contract of tailContracts) result = contract.check(result); }
                catch (error) { pending = error; }
            }
            this.resources.finishResourceScope(scope, result, pending);
        }
        return result!;
    }

    private singlePassSequence(plan: RankSequence['plan']): RankSequence {
        const source = sequence({ ...plan, singlePass: true });
        return this.options.wrapSinglePassSequence?.(source) ?? source;
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
            for (const local of prepareFunction(statement, argumentSignature(arguments_)).locals) this.defineFunction(local);
        });

        return this.singlePassSequence({
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
                interpreter.resources.addGeneratorScope(resources);
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
                                () => {
                                    if (!inspectionEnabled()) return execution.next();
                                    const callerStatement = interpreter.debugStatement;
                                    interpreter.debugCalls.push({ name: statement.name, frame });
                                    try { return execution.next(); }
                                    finally {
                                        interpreter.debugCalls.pop();
                                        interpreter.debugStatement = callerStatement;
                                        inspectExecution(() => interpreter.inspectionState());
                                    }
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
                        interpreter.withGeneratorFrame(
                            frame,
                            resources,
                            () => {
                                let result = execution.return(undefined);
                                while (!result.done) result = execution.next();
                            },
                        );
                    } finally {
                        interpreter.resources.deleteGeneratorScope(resources);
                        interpreter.resources.closeResources(resources, new Set());
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
        try {
            test.resources.withResourceScope(() => test.executeProgram(program, [], true), false);
            this.testResults.push({ name, passed: true, output });
        } catch (error) {
            if (error instanceof InterruptedError) throw error;
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

        if (name === 'raise') return raiseFunction;
        if (name === 'type') return typeFunction;

        for (const module of this.modules) {
            const fn = standardModules[module]?.[name];
            if (fn) {
                const cached = this.standardFunctions.get(fn) ?? this.standardSequences.get(fn);
                if (cached !== undefined) return cached;
                const value = fn({
                    output: this.output,
                    io: this.options.io,
                    md5: this.options.md5,
                    random: this.random,
                    seedRandom: seed => this.random[SEED_RANDOM](seed),
                    ownFile: file => this.resources.ownFile(file),
                });
                if (isNativeFunction(value)) {
                    this.standardFunctions.set(fn, value);
                    const operation = findOperation(name);
                    if (operation) builtinOperations.set(value, operation);
                }
                if (isRankSequence(value)) this.standardSequences.set(fn, value);
                return value;
            }
        }

        const providers = Object.entries(standardModules)
            .filter(([module, exports]) => !this.modules.has(module) && Object.prototype.hasOwnProperty.call(exports, name))
            .map(([module]) => `use ${module}`);
        const hint = providers.length > 0
            ? `; did you forget ${providers.map(provider => `\`${provider}\``).join(' or ')}?`
            : '';
        throw new RankError(name === 'scan' && !hint
            ? 'scan needs an operator, e.g. Range + scan with 0'
            : `unknown name: ${name}${hint}`);
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

    // Repeated writes to one name settle on one frame slot, so the site that
    // makes them resolves it once and then stores without hashing the name
    // again. A name that moves scope, changes type or has yet to be defined
    // reports back from store() and takes the full path below.
    private compileAssign(name: string): (value: RankValue) => void {
        if (name.includes('.')) return value => this.assign(name, value);
        let layout: Map<string, number> | undefined;
        let slot = -1;
        let global: ReadonlySet<string> | undefined;
        return (value: RankValue): void => {
            const received = typeName(value);
            const frame = this.localFrame;
            if (frame === undefined) {
                // A global keeps the types it first settled on, so the site
                // remembers them and the write costs one store rather than a
                // lookup for the types and a second for the value.
                if (global !== undefined && global.has(received)) {
                    const previousValue = this.variables.get(name);
                    this.variables.set(name, value);
                    try {
                        this.checkGlobalRank(name, value);
                    } catch (error) {
                        if (previousValue === undefined) this.variables.delete(name);
                        else this.variables.set(name, previousValue);
                        throw error;
                    }
                    noteArrayBinding(value);
                    return;
                }
                this.assign(name, value);
                global = this.variableTypes.get(name);
                return;
            }
            if (layout !== frame.layout) {
                layout = frame.layout;
                slot = layout.get(name) ?? -1;
            }
            if (slot >= 0 && frame.store(slot, value, received)) return;
            this.assign(name, value);
        };
    }

    private assign(name: string, value: RankValue): void {
        if (availableBuiltin(name, this.modules)) throw new RankError(builtinBindingMessage(name), 'TypeError');
        const dot = name.indexOf('.');
        if (dot >= 0) {
            const alias = name.slice(0, dot);
            const child = this.aliases.get(alias);
            if (!child) throw new RankError(`unknown module alias: ${alias}`);
            child.assign(name.slice(dot + 1), value);
            return;
        }
        const frame = this.localFrame?.find(name) ?? this.localFrame;
        if (!frame) this.sourceBindings.add(name);
        const received = typeName(value);
        // A variable that already carries a recorded type needs neither its
        // previous value nor a rewrite of the type it keeps.
        const recorded = frame ? frame.typeOf(name) : this.variableTypes.get(name);
        if (recorded !== undefined) {
            if (!acceptsBindingType(recorded, received)) {
                throw new RankError(bindingTypeMessage(name, recorded, [received], true));
            }
            if (frame) frame.set(name, value);
            else {
                const previousValue = this.variables.get(name);
                this.variables.set(name, value);
                try {
                    this.checkGlobalRank(name, value);
                } catch (error) {
                    if (previousValue === undefined) this.variables.delete(name);
                    else this.variables.set(name, previousValue);
                    throw error;
                }
                noteArrayBinding(value);
            }
            return;
        }
        const previous = frame ? frame.get(name) : this.variables.get(name);
        const expected = previous === undefined ? undefined : new Set([typeName(previous)]);
        if (expected !== undefined && !acceptsBindingType(expected, received)) {
            throw new RankError(bindingTypeMessage(name, expected, [received], true));
        }
        const settled = expected ?? new Set([received]);
        if (frame) {
            frame.define(name, value, settled);
            return;
        }
        const previousValue = this.variables.get(name);
        this.variables.set(name, value);
        try {
            this.checkGlobalRank(name, value);
        } catch (error) {
            if (previousValue === undefined) this.variables.delete(name);
            else this.variables.set(name, previousValue);
            throw error;
        }
        noteArrayBinding(value);
        this.variableTypes.set(name, settled);
    }

    private checkGlobalRank(name: string, value: RankValue): void {
        if (!isRankArray(value)) return;
        const previous = this.variableArrayRanks.get(name);
        const current = previous === undefined ? this.variables.get(name) : undefined;
        const expected = previous ?? (current !== undefined && isRankArray(current) ? current.shape.length : undefined);
        const rank = checkBindingRank(name, expected, value)!;
        if (previous === undefined) this.variableArrayRanks.set(name, rank);
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
            throw new RankError(bindingTypeMessage(`record field .${field}`, [expected], [received]));
        }
        checkRecordField(record, field, result);
        noteArrayBinding(result);
        record.entries.set(field, result);
        return result;
    }

    private findVariable(name: string): RankValue | undefined {
        return this.localFrame?.lookup(name) ?? this.variables.get(name);
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
            if (tail && index === values.length - 1 && this.resources.currentScopeEmpty()) {
                const definition = functionDefinitions.get(value);
                if (definition?.interpreter === this) throw new TailCallSignal(definition, arguments_);
            }
            const task = this.rankApplication.applyIntrinsicRank(value, arguments_);
            if (!('done' in task)) return this.continueApplication(values, missing, index + 1, task, tail);
            this.resources.ownFiles(task.value);
            pending = [task.value];
        }
        return completed(pending.length === 1 ? pending[0] : this.applySelectors(pending));
    }

    private *finishApplication(task: Execution<RankValue>): Execution<RankValue> {
        const result = yield* resume(task);
        this.resources.ownFiles(result);
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
        this.resources.ownFiles(result);
        return yield* resume(this.apply(values, missing, start, [result], tail));
    }

    private invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue> {
        const execution = functionExecutions.get(fn);
        return execution ? execution(arguments_) : completed(fn.call(arguments_));
    }

    private applySelectors(values: RankValue[], missing?: () => RankValue): RankValue {
        if (isScopedSelectorChain(values)) {
            if (values.length === 3 && isRankArray(values[0])) {
                const scope = isRankLabel(values[1]) ? values[1].name : values[1] as string;
                const field = isRankLabel(values[2]) ? values[2].name : values[2] as string;
                return projectAliasedField(values[0], scope, field, missing);
            }
            let selected = values[0];
            for (const selector of values.slice(1)) {
                selected = this.applySelectors([selected, selector], missing);
            }
            return selected;
        }
        if (values.length === 2 && isRankTableAlias(values[0])) {
            return this.applySelectors([values[0].source, values[1]], missing);
        }
        if (isRankTable(values[0]) && canApplyTable(values)) {
            this.requireModule('tables', 'table addressing');
            return applyTable(values[0], values, missing, rest => this.applySelectors(rest, missing));
        }
        if (values.length === 2 && isRankSqliteDatabase(values[0]) && isRankLabel(values[1])) {
            this.requireModule('tables', 'SQLite table selection');
            return sqliteTable(values[0], values[1].name);
        }
        if (values.length === 2 && isRankSqliteTable(values[0])) {
            this.requireModule('tables', 'SQLite table operation');
            const table = values[0];
            const selector = values[1];
            if (isRankLabel(selector) || typeof selector === 'string') {
                if (table.scopes?.has(isRankLabel(selector) ? selector.name : selector)) {
                    return sqliteScope(table, isRankLabel(selector) ? selector.name : selector);
                }
                return sqliteColumn(table, isRankLabel(selector) ? selector.name : selector);
            }
            if (isRankArray(selector) && isTableFieldList(selector, true)) {
                return projectSqlite(table, selector.items.map(item =>
                    isRankLabel(item) ? item.name : item as string));
            }
            if (isRankSqliteExpression(selector)) return filterSqlite(table, selector);
        }
        if (values.length === 2 && isRankSqliteScope(values[0])
            && (isRankLabel(values[1]) || typeof values[1] === 'string')) {
            return sqliteScopedColumn(values[0], isRankLabel(values[1]) ? values[1].name : values[1]);
        }
        if (values.length === 2 && isRankArray(values[0]) && isRankArray(values[1])
            && isTableFieldList(values[1], this.modules.has('tables'))) {
            this.requireModule('tables', 'table column selection');
            return projectFields(values[0], values[1]);
        }
        if (values.length === 2 && isRankArray(values[0])
            && (typeof values[1] === 'string' || isRankLabel(values[1]))) {
            this.requireModule('tables', 'table projection');
            const field = typeof values[1] === 'string' ? values[1] : values[1].name;
            return projectField(values[0], field, missing);
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
        return yield* resume(this.rankApplication.applyUnaryAtRank(receivers[0], fn, Number(rank), axes));
    }

    private compareAtRank(left: RankValue, right: RankValue, spec: Extract<ApplicationForm, { kind: 'comparison-rank' }>): RankValue {
        if (isRankSqliteExpression(left) || isRankSqliteExpression(right)) {
            if (spec.rank !== 0 || spec.axes !== undefined) {
                throw new RankError('SQLite comparisons support rank 0 without axis', 'TypeError');
            }
            return this.evaluateBinary(spec.operator, left, right);
        }
        if (spec.axes === undefined && spec.rank === 0
            && (isRankSequence(left) || isRankSequence(right))) {
            if (isRankSequence(left) && isRankSequence(right)) {
                return mapBinary(left, right, spec.operator,
                    (a, b) => compareCells(spec.operator, a, b));
            }
            return this.sequenceComparison(spec.operator, left, right);
        }
        const cells = (value: RankValue): OuterCells => {
            if (isRankSequence(value)) {
                if (value.plan.size.kind === 'infinite') {
                    throw new RankError('rank comparison requires a bounded sequence');
                }
                const items: RankValue[] = [];
                for (const item of value.plan.iterate()) {
                    checkpoint('comparing sequence cells');
                    items.push(item);
                }
                value = ownedArray(items, [items.length]);
            }
            if (isRankQueue(value)) value = asRankArray(value)!;
            if (spec.axes !== undefined) {
                if (!isRankArray(value)) throw new RankError('axis rank expects arrays');
                return tensorCells(value, tensorFrameAxes(value.shape, spec.axes, spec.rank));
            }
            return dyadicCells(value, spec.rank);
        };
        const a = cells(left), b = cells(right);
        if (a.frameShape.length === 0 && b.frameShape.length === 0) {
            return compareCells(spec.operator, a.cellAt(0), b.cellAt(0));
        }
        return mapBroadcastArrays(
            derivedArray(a.frameShape, [left].filter(isRankArray), a.cellAt),
            derivedArray(b.frameShape, [right].filter(isRankArray), b.cellAt),
            (x, y) => compareCells(spec.operator, x, y),
        );
    }

    private evaluateOuter(operator: string, left: RankValue, right: RankValue): RankValue {
        const a = outerOperand(left, 'left');
        const b = outerOperand(right, 'right');
        const rightSize = arraySize(b.shape);
        return derivedArray([...a.shape, ...b.shape], [a, b], index => {
            const leftIndex = Math.floor(index / rightSize);
            const rightIndex = index % rightSize;
            return this.evaluateBinary(
                operator,
                arrayItem(a, leftIndex),
                arrayItem(b, rightIndex),
            );
        }, true);
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
            this.resources.ownFiles(result);
            return result;
        });
    }

    private evaluateUnary(operator: string, value: RankValue): RankValue {
        const source = operator === 'not' ? arrayMaskSource(value) : undefined;
        if (source) return markArrayMask(this.evaluateUnaryValue(operator, value), source);
        return this.evaluateUnaryValue(operator, value);
    }

    private evaluateUnaryValue(operator: string, value: RankValue): RankValue {
        if (operator === 'not' && isPositionalMask(value)) {
            return positionalMask(mapSequence(value, 'not', item => item !== true).plan);
        }
        if (operator === 'not' && isRankSequenceMask(value)) {
            return sequenceMask(value.source, {
                name: `not ${value.predicate.name}`,
                expression: {
                    kind: 'not',
                    operand: value.predicate.expression,
                },
                test: item => !value.predicate.test(item),
            });
        }
        if (isRankArray(value)) {
            return ownedArray(value.items.map(item => this.evaluateUnary(operator, item)), value.shape);
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
        const result = this.evaluateBinaryValue(operator, left, right, rangeStep);
        return isRankArray(result) ? markBinaryMask(operator, left, right, result) : result;
    }

    /** `and` and `or` after a single boolean are guards: the right side runs only
     * when the left does not decide, so it must be a single boolean too. */
    private evaluateGuard(operator: string, left: RankValue, right: RankValue): RankValue {
        if (typeof left === 'boolean'
            && (isRankArray(right) || isRankSequence(right) || isRankQueue(right))) {
            throw new RankError(`${operator} after a single boolean expects a single boolean. `
                + `Write \`Mask ${operator} Flag\` to combine a mask with a flag.`);
        }
        return this.evaluateBinary(operator, left, right);
    }

    private decidesGuard(operator: string, left: RankValue): boolean {
        return left === (operator === 'or');
    }

    private evaluateBinaryValue(
        operator: string,
        left: RankValue,
        right: RankValue,
        rangeStep?: RankValue,
    ): RankValue {
        if ((operator === 'in' || operator === 'notin')
            && isRankSqliteExpression(left) && isRankSqliteTable(right)) {
            return inSqlite(left, right, operator === 'notin');
        }
        if (operator === 'notin') {
            const result = this.evaluateBinary('in', left, right);
            return isRankSequence(result) && !isRankSequenceMask(result)
                ? mapSequence(result, 'not in', item => this.evaluateUnary('not', item))
                : this.evaluateUnary('not', result);
        }
        if (isRankSqliteExpression(left) || isRankSqliteExpression(right)) {
            return binarySqlite(operator, left, right);
        }
        // Integer arithmetic and integer comparison are what programs spend
        // their time on, and every one of them used to walk twenty operator
        // tests, a numeric coercion and a three-way ordering helper to reach
        // an answer the operands already determine.
        if (typeof left === 'bigint' && typeof right === 'bigint') {
            switch (operator) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case 'less': return left < right;
                case 'greater': return left > right;
                case 'atleast': return left >= right;
                case 'atmost': return left <= right;
                case 'equal': return left === right;
                case 'notequal': return left !== right;
                case 'min': return left < right ? left : right;
                case 'max': return left > right ? left : right;
                case '%': {
                    if (right === 0n) throw new RankError('division by zero');
                    const remainder = left % right;
                    return remainder !== 0n && (remainder < 0n) !== (right < 0n)
                        ? remainder + right
                        : remainder;
                }
                case '//': {
                    if (right === 0n) throw new RankError('division by zero');
                    return floorDivide(left, right);
                }
                default: break;
            }
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
                // `to` and `until` make ranges; a sequence is bounded by a clause.
                throw new RankError(`${operator} makes a range of numbers; bound a sequence with till: `
                    + `write \`Values till ${operator === 'to' ? 'Limit' : 'at least Limit'}\``);
            }
            return makeRange(
                expectInteger(left),
                expectInteger(right),
                operator === 'to',
                rangeStep === undefined ? undefined : expectInteger(rangeStep),
            );
        }
        if ((isRankSequenceMask(left) || isRankSequenceMask(right) || isPositionalMask(left) || isPositionalMask(right))
            && ['and', 'or', 'xor'].includes(operator)) {
            return this.combineSequenceMasks(operator, left, right);
        }
        if (operator === 'in') {
            const source = asRankArray(left);
            const contains = membershipTest(right, !!source || isRankSequence(left));
            if (source) {
                const items: RankValue[] = [];
                for (let index = 0; index < arraySize(source.shape); index += 1) {
                    checkpoint('testing membership');
                    items.push(contains(arrayItem(source, index)));
                }
                return ownedArray(items, source.shape, true);
            }
            // A membership test over a sequence is a mask, so it can select from that sequence.
            if (isRankSequence(left)) return sequenceMask(left, { name: 'in', test: item => expectBoolean(contains(item)) });
            return contains(left);
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
            // IEEE: nan is unordered, so every comparison with it is false,
            // as in the compiled scalar and tensor kernels.
            if (Number.isNaN(left) || Number.isNaN(right)) return false;
            const order = compareOrderedValues(left, right, orderedKind(left));
            if (operator === 'less') return order < 0;
            if (operator === 'greater') return order > 0;
            if (operator === 'atleast') return order >= 0;
            return order <= 0;
        }

        if (operator === '+' && (isRankDate(left) || isRankDate(right)
            || isRankDuration(left) || isRankDuration(right))) {
            const moment = isRankDate(left) ? left : isRankDate(right) ? right : undefined;
            const span = isRankDuration(left) ? left : isRankDuration(right) ? right : undefined;
            if (moment?.kind !== 'datetime' || !span) {
                throw new RankError('+ expects a datetime and duration', 'TypeError');
            }
            return addDateTimeDuration(moment, span);
        }
        if (operator === '*' && (isRankDuration(left) || isRankDuration(right))) {
            const span = isRankDuration(left) ? left : right;
            const factor = isRankDuration(left) ? right : left;
            if (!isRankDuration(span) || (typeof factor !== 'bigint' && typeof factor !== 'number')) {
                throw new RankError('* expects a duration and number', 'TypeError');
            }
            if (typeof factor === 'bigint') {
                return { kind: 'duration', seconds: span.seconds * factor };
            }
            const scaled = Number(span.seconds) * factor;
            if (!Number.isSafeInteger(Number(span.seconds)) || !Number.isSafeInteger(scaled)) {
                throw new RankError('* needs exact integer seconds', 'TypeError');
            }
            return { kind: 'duration', seconds: BigInt(scaled) };
        }
        if (operator === '-' && (isRankDate(left) || isRankDate(right))) {
            if (!isRankDate(left) || left.kind !== 'datetime'
                || !isRankDate(right) || right.kind !== 'datetime') {
                throw new RankError('- expects two datetimes', 'TypeError');
            }
            return subtractDateTimes(left, right);
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
            expression: {
                kind: 'comparison',
                operator,
                scalar,
                sourceOnLeft: isRankSequence(left),
            },
            test: item => expectBoolean(isRankSequence(left)
                ? this.evaluateBinary(operator, item, scalar)
                : this.evaluateBinary(operator, scalar, item)),
        };
        return sequenceMask(source, predicate);
    }

    private combineSequenceMasks(operator: string, left: RankValue, right: RankValue): RankValue {
        const combine = (a: boolean, b: boolean) => operator === 'and' ? a && b : operator === 'or' ? a || b : a !== b;
        if (!['and', 'or', 'xor'].includes(operator)) {
            throw new RankError(`operator ${operator} does not accept sequence masks`);
        }
        if (!isRankSequenceMask(left) || !isRankSequenceMask(right) || left.source !== right.source) {
            // Masks of different values combine flag by flag, as positions.
            if (!isRankSequence(left) || !isRankSequence(right)) {
                throw new RankError(`operator ${operator} combines a sequence mask only with another mask`);
            }
            const zipped = zipSequences(left, right, operator, (a, b) => {
                if (typeof a !== 'boolean' || typeof b !== 'boolean') throw new RankError(`${operator} expects boolean masks`);
                return combine(a, b);
            });
            return positionalMask(zipped.plan);
        }
        return sequenceMask(left.source, {
            name: `${left.predicate.name} ${operator} ${right.predicate.name}`,
            expression: {
                kind: 'logical',
                operator: operator as 'and' | 'or' | 'xor',
                left: left.predicate.expression,
                right: right.predicate.expression,
            },
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
        const frame = this.localFrame;
        names.forEach((name, index) => {
            if (name === '#') return;
            const inferred = candidates[index];
            if (!inferred || inferred.size === 0) return;
            const recorded = frame ? frame.typeOf(name) : this.variableTypes.get(name);
            const held = frame ? frame.get(name) : this.variables.get(name);
            const previous = recorded
                ?? (held !== undefined ? new Set([typeName(held)]) : undefined);
            if (previous && possibleBindingTypeConflict(previous, inferred)) {
                throw new RankError(bindingTypeMessage(name, previous, inferred, true));
            }
            if (frame) frame.declareType(name, previous ?? inferred);
            else this.variableTypes.set(name, previous ?? inferred);
        });
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

function integerLiteral(expression: Expression, name: string): bigint {
    if (!isNumberLiteral(expression) || typeof expression.value !== 'bigint') {
        throw new RankError(`${name} expects nonnegative integer literals`);
    }
    return expression.value;
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

function lazyArray(
    shape: readonly number[],
    itemAt: (index: number) => RankValue,
    fileFree = false,
): RankArray {
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            materialized ??= Array.from({ length: arraySize(shape) }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

function arrayItem(source: RankArray, index: number): RankValue {
    return readArrayItem(source, index);
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
            return derivedArray(cellShape, [source], index => arrayItem(source, start + index));
        },
    };
}

/** A range's own bounds, so selecting with it can reach SQL as LIMIT and OFFSET or substr. */
const rangeBounds = new WeakMap<RankSequence, { start: bigint; end: bigint; inclusive: boolean }>();

function makeRange(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
    const range = rangeSequence(start, end, inclusive, stride);
    if (stride === undefined || stride === 1n) rangeBounds.set(range, { start, end, inclusive });
    return range;
}

/** `Rows (0 until 10)` on SQLite: the range slices the query instead of reading its rows. */
function sqliteRangeSelection(values: RankValue[]): RankValue | undefined {
    if (values.length !== 2 || !isRankSequence(values[1])) return undefined;
    const bounds = rangeBounds.get(values[1]);
    if (!bounds) return undefined;
    const { start, end, inclusive } = bounds;
    if (isRankSqliteExpression(values[0])) return sliceTextSqlite(values[0], start, end, inclusive);
    if (isRankSqliteTable(values[0])) return sliceSqlite(values[0], start, inclusive ? end + 1n : end);
    return undefined;
}

function rangeSequence(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
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

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function applySelectors(values: RankValue[], missing?: () => RankValue): RankValue {
    if (isRankTable(values[0]) && canApplyTable(values)) {
        return applyTable(values[0], values, missing, rest => applySelectors(rest, missing));
    }
    const sqlite = sqliteRangeSelection(values);
    if (sqlite !== undefined) return sqlite;
    // `Walk .order i`: read the field, then address what it holds.
    if (values.length > 2 && isRankLabel(values[1]) && hasField(values[0], values[1].name)) {
        return applySelectors([applySelectors(values.slice(0, 2)), ...values.slice(2)], missing);
    }
    if (values.length === 2 && isRankGroupedTable(values[0]) && isRankLabel(values[1])) {
        throw new RankError('grouped tables require a select block', 'TypeError');
    }
    // Reading one cell out of an array is the most common application in the
    // language. The branch that serves it sits seventeen type guards down, and
    // every guard reloads `kind` from a receiver whose shape varies, so the
    // whole chain runs uncached. Answer that one case up front.
    if (values.length === 2 && typeof values[1] === 'bigint') {
        const receiver = values[0];
        if (typeof receiver === 'object' && receiver.kind === 'array') {
            const size = receiver.shape.length === 1 ? receiver.shape[0] : -1;
            if (size >= 0) {
                if (values[1] < 0n) throw new MissingValueError('array index out of bounds on axis 0');
                const position = Number(values[1]);
                if (position >= size) {
                    throw new MissingValueError(`array index out of bounds on axis 0: ${values[1]}`);
                }
                return arrayItem(receiver, position);
            }
        }
    }
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
        if (index < 0n) throw new MissingValueError('text index out of bounds');
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
    if (values.length === 2 && (isRankSequence(values[0]) || isRankArray(values[0])) && isPositionalMask(values[1])) {
        return positionalSelection(values[0], values[1]);
    }
    if (values.length === 2 && isRankSequence(values[0]) && isRankSequenceMask(values[1])) {
        const [source, selector] = values;
        // The mask's own source can take its test; any other value reads it by position.
        if (selector.source === source) return filterSequence(source, selector.predicate);
        return positionalSelection(source, selector);
    }
    if (values.length === 2 && isRankSequence(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankIndex(values[0])) {
        const value = values[0].entries.get(indexKey(values.slice(1)));
        if (value === undefined) {
            // Missing keys under default are ordinary sparse reads, not exceptions.
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
    if (isRankSegment(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankMultiset(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankObject(values[0])) {
        // A list of keys reads each one, in the order listed.
        if (values.length === 2 && isRankArray(values[1]) && values[1].shape.length === 1) {
            const object = values[0];
            const keys = values[1];
            return ownedArray(Array.from({ length: keys.shape[0] }, (_, index) => {
                const key = arrayItem(keys, index);
                if (typeof key !== 'string') throw new RankError('object addressing expects text keys');
                const value = object.entries.get(key);
                if (value === undefined) throw new MissingValueError(`missing object key: ${key}`);
                return value;
            }));
        }
        if (values.length !== 2 || (typeof values[1] !== 'string' && !isRankLabel(values[1]))) {
            throw new RankError('object addressing expects one text key or an array of them');
        }
        const key = isRankLabel(values[1]) ? values[1].name : values[1];
        const value = values[0].entries.get(key);
        if (value === undefined) throw new MissingValueError(`missing object key: ${key}`);
        return value;
    }
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') {
        const position = values[1];
        if (position < 0n) throw new MissingValueError('queue index out of bounds');
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
            if (typeof selected === 'bigint' || typeof selected === 'number'
                || typeof selected === 'boolean' || isRankLabel(selected)) {
                throw new RankError(`${indices.length} selectors exceed array rank ${source.shape.length}`, 'DimensionMismatch');
            }
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
        return derivedArray(selection.shape, [source], index => arrayItem(source, selection.offsetAt(index)));
    }
    const last = values.at(-1);
    if (values.length > 2 && last !== undefined && isRankLabel(last) && last.name !== '#') {
        const receiver = applySelectors(values.slice(0, -1), missing);
        return applySelectors([receiver, last], missing);
    }
    // `Rows 0 .attributes Keys`: a field read inside an address addresses what it returns.
    const field = values.findIndex((value, index) => index > 1 && isRankLabel(value) && value.name !== '#');
    if (field > 0 && field < values.length - 1) {
        const receiver = applySelectors(values.slice(0, field + 1), missing);
        return applySelectors([receiver, ...values.slice(field + 1)], missing);
    }
    if (values.length !== 2 || !isRankArray(values[0]) || !isRankArray(values[1])) {
        throw new RankError('value application requires a sequence and one selector');
    }

    return maskSelection(values[0], values[1]);
}

/** The atoms a boolean mask keeps, as a lazy selection even when nothing is kept. */
function maskSelection(source: RankArray, selector: RankArray): RankSequence {
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
    // `Model .weights matmul`: a label naming a field of the value before it
    // reads that field; it is not the function's own argument.
    const fields = readFields(values);
    if (fields.length < values.length && fn.arities.includes(fields.length)) return fields;
    if (fn.arities.includes(values.length)) return values;

    const arities = [...fn.arities].sort((left, right) => right - left);
    for (const arity of arities) {
        if (arity < 1 || values.length <= arity) continue;
        const firstLength = values.length - arity + 1;
        const firstParts = values.slice(0, firstLength);
        if (!canApplySelectors(firstParts)) continue;
        let first: RankValue;
        try {
            first = select(firstParts);
        } catch (error) {
            if (error instanceof RankError) {
                error.message += `\nWhile preparing arguments for ${fn.name}: the first ${firstLength} values were interpreted as a receiver and its selectors.`
                    + '\nTo pass independently computed arguments, group each argument with parentheses.';
            }
            throw error;
        }
        return [first, ...values.slice(firstLength)];
    }

    return values;
}

/** Folds each `Record .field` pair whose record has that field into the field's value. */
function readFields(values: RankValue[]): RankValue[] {
    const result: RankValue[] = [];
    for (const value of values) {
        const receiver = result.at(-1);
        if (isRankLabel(value) && receiver !== undefined && hasField(receiver, value.name)) {
            result[result.length - 1] = applySelectors([receiver, value]);
        } else result.push(value);
    }
    return result;
}

/** A record or object names its fields. Tables are left alone: functions such
 * as `Rows .when datetime` take a table and a column label as two arguments. */
function hasField(value: RankValue, name: string): boolean {
    return (isRankRecord(value) || isRankObject(value)) && value.entries.has(name);
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
    if (values.length === 2 && (isRankSqliteExpression(values[0]) || isRankSqliteTable(values[0]))
        && isRankSequence(values[1]) && rangeBounds.has(values[1])) return true;
    if (isScopedSelectorChain(values)) return true;
    if (isRankTable(values[0])) return canApplyTable(values);
    if (values.length === 2 && isRankTableAlias(values[0])) {
        return canApplySelectors([values[0].source, values[1]]);
    }
    if (values.length === 2 && isRankSqliteScope(values[0])) {
        return isRankLabel(values[1]) || typeof values[1] === 'string';
    }
    if (values.length === 2 && isRankGroupedTable(values[0]) && isRankLabel(values[1])) return true;
    if (values.length === 2 && isRankSqliteTable(values[0])) {
        return isRankLabel(values[1]) || typeof values[1] === 'string'
            || isRankSqliteExpression(values[1])
            || (isRankArray(values[1]) && isTableFieldList(values[1], true));
    }
    if (values.length < 2) return false;
    if (values.length === 2 && isRankGraph(values[0])) return true;
    if (values.length === 2 && typeof values[0] === 'string'
        && typeof values[1] === 'bigint') return true;
    if (values.length === 2 && typeof values[0] === 'string'
        && isCollectionSelector(values[1])) return true;
    if (values.length === 2 && isRankSequence(values[0])
        && typeof values[1] === 'bigint') return true;
    if (values.length === 2 && isRankSequence(values[0])
        && isRankSequenceMask(values[1])) return true;
    if (values.length === 2 && (isRankSequence(values[0]) || isRankArray(values[0]))
        && isPositionalMask(values[1])) return true;
    if (values.length === 2 && isRankSequence(values[0])
        && isIntegerCollectionSelector(values[1])) return true;
    if (values.length === 2 && isRankArray(values[0]) && isRankArray(values[1])) {
        return isTableFieldList(values[1])
            || values[1].items.every(item => typeof item === 'bigint')
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
    if (isRankSegment(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankMultiset(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankObject(values[0]) && values.length === 2
        && (typeof values[1] === 'string'
            || (isRankArray(values[1]) && values[1].shape.length === 1
                && values[1].items.every(item => typeof item === 'string')))) return true;
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

function isScopedSelectorChain(values: readonly RankValue[]): boolean {
    if (values.length < 3 || !values.slice(1).every(value =>
        isRankLabel(value) || typeof value === 'string')) return false;
    const source = values[0];
    const first = values[1];
    const name = isRankLabel(first) ? first.name : first as string;
    return (isRankSqliteTable(source) && source.scopes?.has(name) === true)
        || (isRankArray(source) && source.tableScopes?.includes(name) === true);
}

function unpackApplicationItems(value: RankValue): RankValue[] {
    if (!isRankArray(value)) {
        throw new RankError('unpack expects an array value', 'TypeError');
    }
    if (value.shape.length !== 1) {
        throw new RankError('unpack expects a rank-1 array value', 'DimensionMismatch');
    }
    return Array.from(
        { length: value.shape[0] },
        (_, index) => arrayItem(value, index),
    );
}

function isTableFieldList(value: RankValue, includeEmpty = true): boolean {
    return isRankArray(value) && value.shape.length === 1
        && ((includeEmpty && value.items.length === 0)
            || value.items.some(item => typeof item === 'string' || isRankLabel(item)));
}

function checkedArrayDimension(dimension: bigint): number {
    if (dimension < 0n) throw new RankError(`array dimension must be nonnegative: ${dimension}`);
    if (dimension > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`array dimension is too large: ${dimension}`);
    }
    return Number(dimension);
}

function memoScalarKey(value: RankValue): string {
    if (typeof value === 'number' && Object.is(value, -0)) return 'number:-0';
    if (typeof value !== 'object') return `${typeof value}:${value}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    if (isRankDate(value)) return `${value.kind}:${formatValue(value)}`;
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

function segmentItems(value: RankValue): RankValue[] {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError('segment expects a rank-1 value');
        return Array.from(
            { length: value.shape[0] },
            (_, index) => value.itemAt?.(index) ?? value.items[index],
        );
    }
    if (isRankQueue(value)) return [...value.items];
    if (typeof value === 'string') return [...value];
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError('segment requires a bounded sequence');
        }
        return [...value.plan.iterate()];
    }
    throw new RankError('segment expects a rank-1 value');
}

function membershipTest(right: RankValue, indexed: boolean): (value: RankValue) => boolean {
    if (typeof right === 'string' || isRankObject(right)) return value => {
        if (typeof value !== 'string') throw new RankError('in expects text on the left for text or object membership');
        return typeof right === 'string' ? right.includes(value) : right.entries.has(value);
    };
    if (isRankIndex(right)) return value => right.entries.has(indexKey([value]));
    if (isRankSet(right) || isRankCounter(right)) return value => right.entries.has(setValueKey(value));
    if (isRankMultiset(right)) return value => right.has(value);
    const source = asRankArray(right);
    if (source) return membershipLookup(reductionValues(source, 'in'));
    if (isRankSequence(right)) {
        if (!right.plan.contains && right.plan.size.kind !== 'infinite' && indexed) {
            return membershipLookup(right.plan.iterate());
        }
        return value => {
            const planned = right.plan.contains?.(value);
            if (planned !== undefined) return planned;
            if (right.plan.size.kind === 'infinite') {
                throw new RankError('in requires bounded sequence or membership support');
            }
            for (const item of right.plan.iterate()) {
                if (equalValues(value, item)) return true;
            }
            return false;
        };
    }
    throw new RankError('in expects text, an object, index, set, multiset, array, queue or sequence on the right');
}

// Hash scalar values once; retain structural equality for composite values.
function membershipLookup(values: Iterable<RankValue>): (value: RankValue) => boolean {
    const scalars = new Set<RankValue>();
    const composite: RankValue[] = [];
    const key = (value: RankValue): RankValue => typeof value === 'number'
        && Number.isFinite(value) && Number.isInteger(value) ? BigInt(value) : value;
    for (const value of values) {
        checkpoint('indexing membership');
        if (typeof value === 'object') composite.push(value);
        else if (!(typeof value === 'number' && Number.isNaN(value))) scalars.add(key(value));
    }
    return value => typeof value === 'object'
        ? composite.some(item => equalValues(value, item))
        : scalars.has(key(value));
}

const DENSE_OPERATORS = new Set(['+', '-', '*', '/', '**', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal']);

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
    if ((leftArray || rightArray) && DENSE_OPERATORS.has(name)) {
        const dense = mapDenseArrays(leftArray ?? left, rightArray ?? right, scalarOperation);
        if (dense) return dense;
    }
    if (leftArray && rightArray) {
        return mapBroadcastArrays(leftArray, rightArray, scalarOperation);
    }
    const source = leftArray ?? rightArray!;
    return derivedArray(source.shape, [source], index => {
        const item = arrayItem(source, index);
        return leftArray ? scalarOperation(item, right) : scalarOperation(left, item);
    }, true);
}

function asRankArray(value: RankValue): RankArray | undefined {
    if (isRankArray(value)) return value;
    if (isRankQueue(value)) return { kind: 'array', items: value.items, shape: [value.items.length] };
    return undefined;
}

function assertTestExpression(value: RankValue): void {
    const failed = typeof value === 'boolean'
        ? !value
        : isRankArray(value)
            && value.items.every(item => typeof item === 'boolean')
            && value.items.some(item => item === false);
    if (failed) throw new RankError('boolean test expression evaluated to false');
}

/** A comparison of an array with a scalar, or a logical join of two masks of the
 * same array, yields a mask that numeric operations can select through. */
function markBinaryMask(operator: string, left: RankValue, right: RankValue, result: RankArray): RankValue {
    if (isPredicateOperator(operator)) {
        if (isRankArray(left) && typeof right !== 'object') return markArrayMask(result, left);
        if (isRankArray(right) && typeof left !== 'object') return markArrayMask(result, right);
        return result;
    }
    if (operator === 'and' || operator === 'or' || operator === 'xor') {
        const source = arrayMaskSource(left);
        if (source && source === arrayMaskSource(right)) return markArrayMask(result, source);
    }
    return result;
}

function isPredicateOperator(operator: string): boolean {
    return ['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'multipleby']
        .includes(operator);
}

const SEGMENT_OPERATORS = new Set(['+', '*', 'and', 'or', 'xor']);

function isNamed(expression: Expression, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
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

export { typeName } from './value.js';

function typesOf(values: Iterable<RankValue>): ReadonlySet<string> {
    return new Set([...values].map(typeName));
}

function sortDescending(direction: RankValue): boolean {
    if (!isRankLabel(direction) || (direction.name !== 'ascending' && direction.name !== 'descending')) {
        throw new RankError('sort direction must be .ascending or .descending', 'TypeError');
    }
    return direction.name === 'descending';
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
