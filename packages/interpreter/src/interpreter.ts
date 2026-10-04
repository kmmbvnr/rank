import { InterruptedError, inspectionEnabled } from './interrupt.js';
import { type AstNode } from 'langium';
import {
    availableBuiltin, builtinBindingDiagnostics, builtinBindingMessage, isFunctionStatement, isUseStatement,
    type Expression, type FunctionStatement, type Program, type Statement, type ValueFacts,
} from '@arrrank/language';
import { enterRuntime, leaveRuntime } from './array-storage.js';
import { BindingEnvironment } from './binding-environment.js';
import { bindInputs } from './cli-args.js';
import { CheckedInputContracts } from './checked-input.js';
import { DebugInspection } from './debug-inspection.js';
import { RankError } from './errors.js';
import { ApplicationEvaluator } from './eval/application.js';
import type { AssignmentContext } from './eval/assignments.js';
import { BlockExecution } from './eval/blocks.js';
import { ExpressionEvaluator } from './eval/expressions.js';
import type { LoopContext } from './eval/loops.js';
import { prepareStatement, validateFunctionPlacement, type StatementContext } from './eval/statements.js';
import { runExecution } from './execution.js';
import { FastPaths } from './fast-paths.js';
import { FunctionInvocation } from './function-invocation.js';
import {
    moduleOptions, testOptions, type InterpreterOptions, type RankTestResult,
} from './interpreter-options.js';
import { IMPLICIT_STRUCTURES, implicitStructure, type ImplicitStructure } from './modules/algo.js';
import { BuiltinRegistry, reseed, seedableRandom, type SeedableRandom } from './modules/builtins.js';
import { standardModules } from './modules/index.js';
import { requireModule } from './modules/shared.js';
import { Operators } from './operators.js';
import { parse } from './parser.js';
import { clonePreviewValue } from './preview-values.js';
import { RankApplication } from './rank-application.js';
import { ReductionEvaluator } from './reduction.js';
import { ResourceOwnership } from './resource-ownership.js';
import { locateError, registerSource } from './source-location.js';
import { selectValues } from './value-selection.js';
import { isNativeFunction, type RankValue } from './value.js';

type Output = (text: string) => void;

interface LoadedProgram {
    readonly id: string;
    readonly program: Program;
}

/**
 * The public runtime: executes Rank source and exposes its bindings to a
 * host. Each execution step has its own owner; this class creates them,
 * connects each to the capabilities it declares, and keeps what belongs to
 * one interpreter instance: options, module aliases and loaded programs.
 */
export class Interpreter {
    readonly variables = new Map<string, RankValue>();
    readonly modules = new Set<string>(['core']);
    readonly testResults: RankTestResult[] = [];
    private readonly output: Output;
    private readonly baseOptions: InterpreterOptions;
    /** Inspection runs every statement through the reference paths, so a debugger can stop anywhere. */
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
    private syntheticNames: ReadonlySet<string> = new Set();

    private readonly bindings = new BindingEnvironment(this.variables, this.modules);
    private readonly resources = new ResourceOwnership();
    private readonly checkedInputs = new CheckedInputContracts();
    private readonly operators = new Operators(this.modules, value => this.resources.ownFiles(value),
        fn => this.functions.scalarCallback(fn));
    private readonly inspection = new DebugInspection(this.bindings, () => this.options.sourceId ?? '<input>');
    private readonly builtins: BuiltinRegistry;
    private readonly functions: FunctionInvocation;
    private readonly reductions: ReductionEvaluator;
    private readonly rankApplication: RankApplication;
    private readonly fastPaths: FastPaths;
    private readonly application: ApplicationEvaluator;
    private readonly expressions: ExpressionEvaluator;
    private readonly blocks: BlockExecution;
    private readonly loops: LoopContext;
    private readonly writes: AssignmentContext;
    private readonly statements: StatementContext;

    constructor(output: Output = console.log, options: InterpreterOptions = {}) {
        this.output = output;
        this.baseOptions = options;
        this.random = seedableRandom(options.random);
        const requireOpen = (module: string, operation: string) => requireModule(this.modules, module, operation);
        const select = (values: RankValue[], missing?: () => RankValue) => selectValues(this.modules, values, missing);
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
                inputs: this.checkedInputs,
                compileDirect: expression => this.expressions.compileDirect(expression),
                compiled: (statement, arguments_) => this.fastPaths.functionBody(statement, arguments_, this.blocks),
                execute: (statements, generator) => this.blocks.execute(statements, false, false, false, generator),
                locate: (error, node) => this.locateError(error, node),
                scalarEntry: (statement, generator, types) => this.fastPaths.scalarEntry(statement, generator, types),
                flatCombine: (fn, statement, available) => this.fastPaths.flatCombine(fn, statement, available),
            });
        this.reductions = new ReductionEvaluator(
            (operator, left, right) => this.operators.evaluateBinary(operator, left, right),
            name => this.resolve(name), this.builtins.functions, () => this.options.tensorFusion !== false,
            fn => this.functions.scalarCallback(fn),
        );
        this.rankApplication = new RankApplication(
            (fn, args) => this.functions.invoke(fn, args),
            value => this.resources.ownFiles(value), this.builtins.functions,
            fn => this.functions.scalarCallback(fn),
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
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compileTail: expression => this.expressions.compile(expression, undefined, true),
            operationOf: name => this.expressions.operationOf(name),
            operators: this.operators,
        });
        this.application = new ApplicationEvaluator({
            checkInput: (expression, value, source) => this.checkedInputs.check(expression, value, source),
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compile: (expression, missing, tail, classify) => this.expressions.compile(expression, missing, tail, classify),
            evaluateArrayItem: item => this.expressions.evaluateArrayItem(item),
            operationOf: name => this.expressions.operationOf(name),
            resolve: name => this.resolve(name),
            select,
            requireModule: requireOpen,
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
            inputCall: (expression, run) => this.checkedInputs.expression(expression, run),
            bindings: this.bindings,
            resolve: name => this.resolve(name),
            select,
            requireModule: requireOpen,
            invoke: (fn, arguments_) => this.functions.invoke(fn, arguments_),
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
            prepare: statement => prepareStatement(statement, this.statements),
            point: statement => this.inspection.point(statement),
            locate: (error, node) => this.locateError(error, node),
            syntheticNames: () => this.syntheticNames,
            options: () => this.options,
        });
        this.loops = {
            bindings: this.bindings,
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compileAssign: name => this.compileAssign(name),
            prepareBody: (statements, context, iterable, loopControl) =>
                this.blocks.prepareLoopBody(statements, context, iterable, loopControl),
            execute: (statements, context) => this.blocks.executeIn(statements, context),
            point: (statement, iteration) => this.inspection.point(statement, iteration),
            options: () => this.options,
            compileLoop: (statement, binding) => this.fastPaths.compileLoop(statement, binding),
        };
        this.writes = {
            checkArrayWrite: (name, target, values, offsets) => this.checkArrayWrite(name, target, values, offsets),
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compileAssign: name => this.compileAssign(name),
            resolveVariable: name => this.resolveVariable(name),
            evaluateAddressParts: item => this.expressions.evaluateAddressParts(item),
            select: values => select(values),
            requireModule: requireOpen,
            index: () => this.structure('index', IMPLICIT_STRUCTURES.index),
            set: () => this.structure('set', IMPLICIT_STRUCTURES.set),
            counter: () => this.structure('counter', IMPLICIT_STRUCTURES.counter),
            options: () => this.options,
            operators: this.operators,
        };
        this.statements = {
            bindings: this.bindings,
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compileTail: expression => this.expressions.compile(expression, undefined, true),
            operationOf: name => this.expressions.operationOf(name),
            execute: (statements, context) => this.blocks.executeIn(statements, context),
            assign: (name, value) => this.assign(name, value),
            define: statement => this.functions.define(statement),
            requireModule: requireOpen,
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

    evaluate(expression: Expression): RankValue {
        try {
            return runExecution(this.expressions.evaluate(expression));
        } catch (error) {
            throw this.locateError(error, expression);
        }
    }

    executeProgram(
        program: Program,
        args: readonly string[] = [],
        assertBooleanExpressions = false,
    ): RankValue | undefined {
        validateFunctionPlacement(program.statements, 'top');
        this.checkBuiltinBindings(program);
        const declarations = new Map<string, FunctionStatement>();
        const initial = new Map<string, ValueFacts>();
        for (const [name, value] of this.variables) {
            const definition = isNativeFunction(value) ? this.functions.definitionOf(value) : undefined;
            if (definition && !definition.context) declarations.set(name, definition.statement);
            else initial.set(name, { types: [] });
        }
        this.checkedInputs.prepare(program, initial, declarations);
        this.declareFunctions(program.statements);
        bindInputs(program, args, {
            variables: this.variables,
            modules: this.modules,
            evaluate: expression => this.evaluate(expression),
            locate: (error, node) => this.locateError(error, node),
        });
        return this.blocks.run(program.statements, assertBooleanExpressions);
    }

    /** Register notebook function cells without executing any statements or bodies. */
    declareFunctionSource(source: string): string[] {
        const program = this.parse(source);
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
        for (const [name, child] of this.aliases) fork.aliases.set(name, child.forkForPreview(output));
        for (const [name, value] of this.variables) {
            const source = isNativeFunction(value) ? this.functions.sourceOf(value) : undefined;
            if (source && isNativeFunction(value)) fork.functions.adoptSource(value, source);
            const definition = isNativeFunction(value) ? this.functions.definitionOf(value) : undefined;
            if (!definition || definition.context) fork.variables.set(name, clonePreviewValue(value));
        }
        fork.bindings.globals.adoptContracts(this.bindings.globals);
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

    private executeSource(source: string): RankValue | undefined {
        const program = this.parse(source, this.syntheticNames);
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

    private parse(source: string, syntheticNames?: ReadonlySet<string>): Program {
        const program = parse(source, this.options.sourceId, {
            bindings: new Map([...this.variables].map(([name, value]) => [name, isNativeFunction(value) ? value.arities : false])),
        }, new Set(this.variables.keys()), syntheticNames);
        registerSource(program, this.options.sourceId ?? '<input>');
        return program;
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

    private locateError(error: unknown, node: AstNode): unknown {
        return locateError(error, node, this.options.sourceId ?? '<input>');
    }

    // Names: module aliases own dotted names, the implicit structures own
    // theirs, then bindings and finally the open builtins.

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
        const implicit = implicitStructure(name);
        if (implicit) return this.structure(name, implicit);
        const variable = this.bindings.find(name);
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
        const value = this.bindings.find(name);
        if (value === undefined) {
            throw new RankError(`unknown variable: ${name}`);
        }
        return value;
    }

    private checkArrayWrite(name: string, target: RankValue, values: readonly RankValue[], offsets?: readonly number[]): readonly RankValue[] {
        const dot = name.indexOf('.');
        if (dot > 0) {
            const child = this.aliases.get(name.slice(0, dot));
            if (child) return child.checkArrayWrite(name.slice(dot + 1), target, values, offsets);
        }
        return (this.bindings.current?.find(name) ?? this.bindings.globals).checkArrayWrite(name, target, values, offsets);
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

    private structure<T extends RankValue>(name: string, kind: ImplicitStructure<T>): T {
        requireModule(this.modules, 'algo', name);
        return this.bindings.structure(name, kind.is, kind.create);
    }

    // Programs: standard modules, files loaded as module children, runs and tests.

    private useStandard(module: string): void {
        if (!(module in standardModules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        const modules = new Set([...this.modules, module]);
        this.checkBuiltinBindings({ $type: 'Program', statements: [] }, modules);
        this.modules.add(module);
    }

    private useFile(specifier: string, alias?: string): LoadedProgram {
        const loaded = this.load(specifier);
        const child = new Interpreter(this.output, {
            ...moduleOptions(this.options),
            random: this.random,
            maxCallDepth: this.functions.maxDepth,
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
            ...testOptions(this.options),
            random: this.random,
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
}

export { typeName } from './value.js';
export type { InterpreterOptions, LoadedModule, RankTestResult } from './interpreter-options.js';
