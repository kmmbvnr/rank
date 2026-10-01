import { InterruptedError, inspectionEnabled } from './interrupt.js';
import { type AstNode } from 'langium';
import { ownedArray, readArrayItem, enterRuntime, leaveRuntime } from './array-storage.js';
import { ByteArray } from './bytes.js';
import {
    runExecution, type Evaluation, type Execution,
} from './execution.js';
import { BindingEnvironment } from './binding-environment.js';
import { FunctionInvocation } from './function-invocation.js';
import { ApplicationEvaluator } from './eval/application.js';
import { ExpressionEvaluator } from './eval/expressions.js';
import { type LoopContext } from './eval/loops.js';
import {
    type AssignmentContext,
} from './eval/assignments.js';
import { FastPaths } from './fast-paths.js';
import { prepareStatement, type StatementContext } from './eval/statements.js';
import { BlockExecution } from './eval/blocks.js';
import type { InterpreterOptions, RankTestResult } from './interpreter-options.js';
import { DebugInspection } from './debug-inspection.js';
import { BuiltinRegistry, reseed, seedableRandom, type SeedableRandom } from './modules/builtins.js';
import { locateError, registerSource } from './source-location.js';
import { Operators } from './operators.js';
import {
    selectValues,
} from './value-selection.js';
import { newStructure } from './collections.js';
import { RankDeque } from './containers.js';
import { recordContract, retainRecordContract } from './record-contract.js';
import { ResourceOwnership } from './resource-ownership.js';
import { inputDeclarationName, inputValues, kebabCase, parseArguments, validateInputValue } from './cli-args.js';
import { ReductionEvaluator } from './reduction.js';
import { RankApplication } from './rank-application.js';
import {
    isArgumentStatement,
    isFlagStatement,
    isForStatement,
    isFunctionStatement,
    isIfStatement,
    isOptionStatement,
    isTestStatement,
    isTryStatement,
    isUseStatement,
    type AddressItem,
    type ArrayItem,
    type Expression,
    type FunctionStatement,
    type Program,
    type Statement,
    findOperation, availableBuiltin, builtinBindingDiagnostics, builtinBindingMessage,
} from '@arrrank/language';
import { RankError } from './errors.js';
import { standardModules } from './modules/index.js';
import { parse } from './parser.js';
import {
    isNativeFunction,
    isRankArray,
    isRankBytes,
    isRankCounter,
    isRankIndex,
    isRankObject,
    isRankQueue,
    isRankRecord,
    isRankSet,
    type RankCounter,
    type NativeFunction,
    type RankIndex,
    type RankQueue,
    type RankRecord,
    type RankSet,
    type RankValue,
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
    private readonly builtins: BuiltinRegistry;
    private readonly reductions: ReductionEvaluator;
    private readonly rankApplication: RankApplication;
    private readonly resources = new ResourceOwnership();
    private readonly inspection = new DebugInspection(this.bindings, () => this.options.sourceId ?? '<input>');
    private readonly functions: FunctionInvocation;
    private readonly application: ApplicationEvaluator;
    private readonly expressions: ExpressionEvaluator;
    private readonly fastPaths: FastPaths;
    private readonly loops: LoopContext;
    private readonly writes: AssignmentContext;
    private readonly statementContext: StatementContext;
    private readonly blocks: BlockExecution;

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
                compiled: (statement, arguments_) => this.fastPaths.functionBody(statement, arguments_, this.blocks),
                execute: (statements, generator) => this.blocks.execute(statements, false, false, false, generator),
                locate: (error, node) => this.locateError(error, node),
                scalarEntry: (statement, generator) => this.fastPaths.scalarEntry(statement, generator),
                flatCombine: (fn, statement, available) => this.fastPaths.flatCombine(fn, statement, available),
            });
        this.reductions = new ReductionEvaluator(
            (operator, left, right) => this.operators.evaluateBinary(operator, left, right),
            name => this.resolve(name), this.builtins.functions, () => this.options.tensorFusion !== false,
        );
        this.rankApplication = new RankApplication(
            (fn, args) => this.invoke(fn, args),
            value => this.resources.ownFiles(value), this.builtins.functions,
        );
        this.fastPaths = new FastPaths({
            bindings: this.bindings,
            modules: this.modules,
            builtins: this.builtins,
            functions: this.functions,
            resolve: name => this.resolve(name),
            compileAssign: name => this.compileAssign(name),
            locate: (error, node) => this.locateError(error, node),
            options: () => this.options,
            evaluate: expression => this.evaluateTask(expression),
            compileDirect: expression => this.compileDirectExpression(expression),
            compileTail: expression => this.compileExpression(expression, undefined, true),
            operationOf: name => this.applicationOperation(name),
            operators: this.operators,
        });
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
            fastPaths: this.fastPaths,
        });
        this.expressions = new ExpressionEvaluator({
            bindings: this.bindings,
            resolve: name => this.resolve(name),
            select: (values, missing) => this.select(values, missing),
            requireModule: (module, operation) => this.requireModule(module, operation),
            invoke: (fn, arguments_) => this.invoke(fn, arguments_),
            locate: (error, expression) => this.locateError(error, expression),
            options: () => this.options,
            operators: this.operators,
            resources: this.resources,
            functions: this.functions,
            builtins: this.builtins,
            application: this.application,
            fastPaths: this.fastPaths,
        });
        this.blocks = new BlockExecution({
            bindings: this.bindings,
            fastPaths: this.fastPaths,
            prepare: statement => prepareStatement(statement, this.statementContext),
            point: statement => this.inspection.point(statement),
            locate: (error, node) => this.locateError(error, node),
            syntheticNames: () => this.syntheticNames,
            options: () => this.options,
        });
        this.loops = {
            bindings: this.bindings,
            evaluate: expression => this.evaluateTask(expression),
            compileDirect: expression => this.compileDirectExpression(expression),
            compileAssign: name => this.compileAssign(name),
            prepareBody: (statements, context, iterable, loopControl) =>
                this.blocks.prepareLoopBody(statements, context, iterable, loopControl),
            execute: (statements, context) => this.blocks.executeIn(statements, context),
            point: (statement, iteration) => this.inspection.point(statement, iteration),
            options: () => this.options,
            compileLoop: (statement, binding) => this.fastPaths.compileLoop(statement, binding),
        };
        this.writes = {
            evaluate: expression => this.evaluateTask(expression),
            compileDirect: expression => this.compileDirectExpression(expression),
            compileAssign: name => this.compileAssign(name),
            resolveVariable: name => this.resolveVariable(name),
            evaluateAddressParts: item => this.evaluateAddressParts(item),
            select: values => this.select(values),
            requireModule: (module, operation) => this.requireModule(module, operation),
            index: () => this.localIndex(),
            set: () => this.localSet(),
            counter: () => this.localCounter(),
            options: () => this.options,
            operators: this.operators,
        };
        this.statementContext = {
            bindings: this.bindings,
            evaluate: expression => this.evaluateTask(expression),
            compileDirect: expression => this.compileDirectExpression(expression),
            compileTail: expression => this.compileExpression(expression, undefined, true),
            operationOf: name => this.applicationOperation(name),
            execute: (statements, context) => this.blocks.executeIn(statements, context),
            assign: (name, value) => this.assign(name, value),
            define: statement => this.functions.define(statement),
            requireModule: (module, operation) => this.requireModule(module, operation),
            program: {
                useFile: (path, alias) => { this.useFile(path, alias); },
                useStandard: module => this.useStandard(module),
                run: path => this.run(path),
                runAlias: alias => this.runAlias(alias),
                test: (name, statements) => this.executeTest(name, statements),
                setArguments: values => { this.pendingArgs = values; },
            },
            loops: this.loops,
            writes: this.writes,
        };
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
        return this.blocks.run(program.statements, assertBooleanExpressions);
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

    private locateError(error: unknown, node: AstNode): unknown {
        return locateError(error, node, this.options.sourceId ?? '<input>');
    }

    evaluate(expression: Expression): RankValue {
        try {
            return runExecution(this.evaluateTask(expression));
        } catch (error) {
            throw this.locateError(error, expression);
        }
    }

    private evaluateTask(expression: Expression): Evaluation<RankValue> {
        return this.expressions.evaluate(expression);
    }

    private compileDirectExpression(expression: Expression): (() => RankValue) | undefined {
        return this.expressions.compileDirect(expression);
    }

    private compileExpression(
        expression: Expression, missing?: () => RankValue, tail = false, classify = true,
    ): () => Evaluation<RankValue> {
        return this.expressions.compile(expression, missing, tail, classify);
    }

    private applicationOperation(name: string): ReturnType<typeof findOperation> | false {
        return this.expressions.operationOf(name);
    }

    private evaluateArrayItem(item: ArrayItem): Execution<RankValue> {
        return this.expressions.evaluateArrayItem(item);
    }

    private evaluateAddressParts(item: AddressItem): Evaluation<RankValue[]> {
        return this.expressions.evaluateAddressParts(item);
    }

    private useStandard(module: string): void {
        if (!(module in standardModules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        const modules = new Set([...this.modules, module]);
        this.checkBuiltinBindings({ $type: 'Program', statements: [] }, modules);
        this.modules.add(module);
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

    private findVariable(name: string): RankValue | undefined {
        return this.bindings.find(name);
    }

    private invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue> {
        return this.functions.invoke(fn, arguments_);
    }

    private select(values: RankValue[], missing?: () => RankValue): RankValue {
        return selectValues(this.modules, values, missing);
    }

    private requireModule(module: string, operation: string): void {
        if (!this.modules.has(module)) {
            throw new RankError(`${operation} requires: use ${module}`);
        }
    }
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

export { typeName } from './value.js';
export type { InterpreterOptions, LoadedModule, RankTestResult } from './interpreter-options.js';

