import { InterruptedError, inspectionEnabled } from './interrupt.js';
import { type AstNode } from 'langium';
import {
    functionScopeDiagnostics, availableBuiltin, builtinBindingDiagnostics, builtinBindingMessage, isFunctionStatement, isFunctionBindingStatement, isUseStatement,
    type Expression, type FunctionStatement, type Program, type Statement, type ValueFacts,
} from '@arrrank/language';
import { BindingEnvironment } from './binding-environment.js';
import { MutationGuards } from './mutation-guards.js';
import { hasNativeImplementation } from './native-implementation.js';
import { EnvironmentOverlay, effectiveEnvironment, withEnvironment, type RankEnvironment } from './environment.js';
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
    moduleOptions, testOptions, resolveCompilerCapabilities, referenceCompilerOptions,
    type CompilerCapabilities, type InterpreterOptions, type RankTestResult,
} from './interpreter-options.js';
import { RETIRED_IMPLICIT_NAMES } from './modules/algo.js';
import { BuiltinRegistry, reseed, seedableRandom, type SeedableRandom } from './modules/builtins.js';
import { standardModules } from './modules/index.js';
import { requireModule } from './modules/shared.js';
import { Operators } from './operators.js';
import { parse } from './parser.js';
import { clonePreviewValue } from './preview-values.js';
import { RankApplication } from './rank-application.js';
import { ReductionEvaluator } from './reduction.js';
import { ResourceOwnership } from './resource-ownership.js';
import { locateError, planBindingNote, registerSource, scopeDiagnosticMessage, sourceIdOf } from './source-location.js';
import { selectValues } from './value-selection.js';
import { withoutAmbientTensorPlan } from './tensor-map.js';
import { isNativeFunction, type RankValue } from './value.js';

type Output = (text: string) => void;

interface LoadedProgram {
    readonly id: string;
    readonly program: Program;
}

function splitQualified(name: string): { alias: string; member: string } | undefined {
    const dot = name.indexOf('.');
    return dot < 0 ? undefined : { alias: name.slice(0, dot), member: name.slice(dot + 1) };
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
    private readonly referenceOptions: InterpreterOptions;
    private environmentOverride?: RankEnvironment;
    /** Inspection runs every statement through the reference paths, so a debugger can stop anywhere. */
    get options(): InterpreterOptions {
        return this.baseOptions.compilation === false || inspectionEnabled() ? this.referenceOptions : this.baseOptions;
    }
    get compiler(): CompilerCapabilities {
        return resolveCompilerCapabilities(this.options);
    }
    private readonly random: SeedableRandom;
    private readonly parsingPrograms = new Set<string>();
    private readonly openPrograms = new Map<string, LoadedProgram>();
    private readonly aliases = new Map<string, Interpreter>();
    private currentRunTarget: LoadedProgram | undefined;
    private pendingArgs: string[] | undefined;
    private loadedProgram: LoadedProgram | undefined;
    private syntheticNames: ReadonlySet<string> = new Set();

    private readonly bindings = new BindingEnvironment(this.variables, this.modules);
    private readonly mutations = new MutationGuards(
        (name, local) => this.checkMutable(name, local), (error, node) => this.locateError(error, node),
    );
    private readonly resources = new ResourceOwnership();
    private readonly checkedInputs = new CheckedInputContracts();
    private readonly operators = new Operators(value => this.resources.ownFiles(value),
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
        this.baseOptions = { ...options, environment: options.environment ?? new EnvironmentOverlay() };
        this.referenceOptions = referenceCompilerOptions(this.baseOptions);
        this.random = seedableRandom(options.random);
        const requireOpen = (module: string, operation: string) => requireModule(this.modules, module, operation);
        const select = (values: RankValue[], missing?: () => RankValue) => selectValues(this.modules, values, missing);
        this.builtins = new BuiltinRegistry(this.modules, {
            output,
            io: options.io,
            environment: this.baseOptions.environment,
            md5: options.md5,
            random: this.random,
            seedRandom: seed => reseed(this.random, seed),
            ownFile: file => this.resources.ownFile(file),
        });
        this.functions = new FunctionInvocation(this.bindings, this.resources, this.builtins, this.inspection,
            this.modules, () => this.options, {
                resolve: name => this.resolve(name),
                evaluateReturn: expression => this.expressions.returnValue(expression),
                inputs: this.checkedInputs,
                apply: (fn, args) => this.rankApplication.applyIntrinsicRank(fn, args),
                compileDirect: expression => this.expressions.compileDirect(expression),
                compiled: (statement, arguments_) => this.fastPaths.functionBody(statement, arguments_, this.blocks),
                execute: (statements, generator, control) => this.blocks.execute(statements, false, false, false, generator, true, undefined, control),
                locate: (error, node) => this.locateError(error, node),
                scalarEntry: (statement, generator, types, captures) => this.fastPaths.scalarEntry(statement, generator, types, captures),
                flatCombine: (fn, statement, available) => this.fastPaths.flatCombine(fn, statement, available),
            });
        this.reductions = new ReductionEvaluator(
            (operator, left, right) => this.operators.evaluateBinary(operator, left, right),
            name => this.resolve(name), this.builtins.functions, () => this.compiler.tensors.fusion,
            fn => this.functions.scalarCallback(fn),
            (fn, args) => runExecution(this.rankApplication.applyIntrinsicRank(fn, args)),
            value => this.resources.ownFiles(value),
        );
        this.rankApplication = new RankApplication(
            (fn, args) => this.functions.invoke(fn, args),
            value => this.resources.ownFiles(value), this.builtins.functions,
            fn => this.functions.scalarCallback(fn),
            (fn, source, axes) => this.functions.arrayBatch(fn, source, axes),
        );
        this.fastPaths = new FastPaths({
            checkMutation: statement => this.mutations.statement(statement),
            bindings: this.bindings,
            modules: this.modules,
            builtins: this.builtins,
            functions: this.functions,
            resolve: name => this.resolve(name),
            compileAssign: name => this.compileAssign(name),
            locate: (error, node) => this.locateError(error, node),
            options: () => this.options,
            evaluate: expression => this.expressions.evaluate(expression),
            evaluateReturn: (expression, tail) => this.expressions.returnValue(expression, tail),
            compileDirect: expression => this.expressions.compileDirect(expression),
            operationOf: name => this.expressions.operationOf(name),
            operators: this.operators,
        });
        this.application = new ApplicationEvaluator({
            findVariable: name => this.findVariable(name),
            argument: expression => this.expressions.argument(expression),
            stageArgument: expression => this.expressions.stageArgument(expression),
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
            findVariable: name => this.findVariable(name),
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
            prepare: statement => this.mutations.wrap(statement, prepareStatement(statement, this.statements)),
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
            compileLoop: (statement, binding, continuation) => this.fastPaths.compileLoop(statement, binding, continuation),
            prepareStatement: (statements, index) => this.blocks.preparedStatement(statements, index),
            locate: (error, statement) => this.locateError(error, statement),
        };
        this.writes = {
            protect: (names, plan) => {
                const note = planBindingNote(plan, this.options.sourceId ?? '<input>');
                const publish = names.map(name => this.protect(name, plan.name, note));
                return () => { for (const apply of publish) apply(); };
            },
            defer: expression => this.expressions.defer(expression),
            checkArrayWrite: (name, target, values, offsets) => this.checkArrayWrite(name, target, values, offsets),
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compileAssign: name => this.compileAssign(name),
            resolveVariable: name => this.resolveVariable(name),
            // Local parameters may borrow a caller's array without an ownership
            // increment. Keep their self-rebindings on the copying path.
            canConsumeBinding: () => this.bindings.current === undefined,
            isStandardFunction: (module, name) => {
                const value = this.resolve(name);
                return isNativeFunction(value) && this.builtins.is(module, name, value)
                    && hasNativeImplementation(value) && value.monadicRank === 1;
            },
            evaluateAddressParts: item => this.expressions.evaluateAddressParts(item),
            select: values => select(values),
            requireModule: requireOpen,
            options: () => this.options,
            operators: this.operators,
        };
        this.statements = {
            evaluateReturn: (expression, tail) => this.expressions.returnValue(expression, tail),
            resolve: name => this.resolve(name),
            bindings: this.bindings,
            evaluate: expression => this.expressions.evaluate(expression),
            compileDirect: expression => this.expressions.compileDirect(expression),
            compileTail: expression => () => this.expressions.returnValue(expression, true),
            operationOf: name => this.expressions.operationOf(name),
            execute: (statements, context) => this.blocks.executeIn(statements, context),
            assign: (name, value) => this.assign(name, value),
            define: statement => this.functions.define(statement),
            defineBinding: statement => this.functions.defineBinding(statement, name => this.resolve(name), value => this.evaluate(value)),
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
        const previous = this.syntheticNames;
        this.syntheticNames = syntheticNames;
        try { return this.inEnvironment(() => this.executeSource(source)); }
        finally { this.syntheticNames = previous; }
    }

    evaluate(expression: Expression): RankValue {
        try {
            const run = () => runExecution(this.expressions.evaluate(expression));
            return this.inEnvironment(run);
        } catch (error) {
            throw this.locateError(error, expression);
        }
    }

    executeProgram(
        program: Program,
        args: readonly string[] = [],
        assertBooleanExpressions = false,
    ): RankValue | undefined {
        const run = () => this.executeProgramBody(program, args, assertBooleanExpressions);
        return this.inEnvironment(run);
    }

    private executeProgramBody(program: Program, args: readonly string[], assertBooleanExpressions: boolean): RankValue | undefined {
        validateFunctionPlacement(program.statements, 'top');
        const scopeError = functionScopeDiagnostics(program)[0];
        if (scopeError) throw this.locateError(new RankError(scopeDiagnosticMessage(scopeError, this.options.sourceId ?? '<input>'), 'Scope'), scopeError.node);
        this.checkBuiltinBindings(program);
        this.mutations.program(program);
        const declarations = new Map<string, FunctionStatement>();
        const initial = new Map<string, ValueFacts>();
        for (const [name, value] of this.variables) {
            const definition = isNativeFunction(value) ? this.functions.definitionOf(value) : undefined;
            if (definition && !definition.context) declarations.set(name, definition.statement);
            else initial.set(name, { types: [] });
        }
        this.checkedInputs.prepare(program, initial, declarations,
            this.options.loadModule ? (path, site) => this.load(path,
                site?.$cstNode ? sourceIdOf(site.$cstNode, this.options.sourceId ?? '<input>')
                    : this.options.sourceId).program : undefined);
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
        const scopeError = functionScopeDiagnostics(program)[0];
        if (scopeError) throw this.locateError(new RankError(scopeDiagnosticMessage(scopeError, this.options.sourceId ?? '<input>'), 'Scope'), scopeError.node);
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

    /** Hosts force preview results in this environment, without borrowing a caller's compiler. */
    inEnvironment<T>(run: () => T): T {
        return withoutAmbientTensorPlan(() => this.environmentOverride ? withEnvironment(this.environmentOverride, run) : run(),
            this.compiler.tensors.fusion);
    }

    /** Copy the current bindings without rerunning the program that produced them. */
    forkForPreview(output: Output = this.output, environment: RankEnvironment = new EnvironmentOverlay(this.options.environment)): Interpreter {
        const { wrapSinglePassSequence: _singlePass,
            persistentResources: _persistent, ...options } = this.options;
        const fork = new Interpreter(output, { ...options, environment });
        fork.environmentOverride = environment;
        for (const module of this.modules) fork.modules.add(module);
        for (const name of this.bindings.sourceBindings) fork.bindings.sourceBindings.add(name);
        for (const [name, child] of this.aliases) fork.aliases.set(name, child.forkForPreview(output, environment));
        for (const [name, value] of this.variables) {
            const fn = isNativeFunction(value) ? value : undefined;
            const source = fn && this.functions.sourceOf(fn);
            if (fn && source) fork.functions.adoptSource(fn, source);
            const definition = fn && this.functions.definitionOf(fn);
            if (!definition || definition.context) {
                const copy = clonePreviewValue(value);
                if (isNativeFunction(copy)) {
                    const isolated = { ...copy, call: (arguments_: RankValue[]) => withEnvironment(environment, () => copy.call(arguments_)),
                        ...(copy.write ? { write: { ...copy.write,
                            validate: (arguments_: RankValue[]) => withEnvironment(environment, () => copy.write!.validate(arguments_)),
                            call: (arguments_: RankValue[], value: RankValue) => withEnvironment(environment, () => copy.write!.call(arguments_, value)),
                        } } : {}) };
                    BuiltinRegistry.inheritOperation(copy, isolated);
                    if (source) fork.functions.adoptSource(isolated, source);
                    fork.variables.set(name, isolated);
                } else fork.variables.set(name, copy);
            }
        }
        fork.bindings.globals.adoptContracts(this.bindings.globals);
        // Rebuild top-level user functions so their calls use the fork rather than
        // the original interpreter captured by the function object.
        for (const value of this.variables.values()) {
            const definition = isNativeFunction(value) ? this.functions.definitionOf(value) : undefined;
            if (definition && !definition.context) fork.functions.define(definition.statement,
                this.bindings.isConstant(definition.statement.name, this.bindings.globals));
        }
        for (const name of this.variables.keys()) if (this.bindings.isConstant(name, this.bindings.globals)
            && !fork.bindings.isConstant(name, fork.bindings.globals)) fork.bindings.lockFunction(name);
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
        const callableBindings = [...this.variables, ...[...this.aliases].flatMap(([alias, child]) =>
            [...child.variables].map(([name, value]) => [`${alias}.${name}`, value] as const))];
        const program = parse(source, this.options.sourceId, {
            bindings: new Map(callableBindings.map(([name, value]) => [name, isNativeFunction(value) ? value.arities : false])),
            operations: new Map(callableBindings.flatMap(([name, value]) => {
                const operation = isNativeFunction(value) && BuiltinRegistry.operationOf(value);
                return operation ? [[name, operation] as const] : [];
            })),
            modules: this.modules,
            loadModule: this.options.loadModule ? path => this.load(path).program : undefined,
            signatures: new Map(callableBindings.flatMap(([name, value]) =>
                isNativeFunction(value) && value.callSignature ? [[name, value.callSignature] as const] : [])),
            declarations: new Map(callableBindings.flatMap(([name, value]) => {
                const dot = name.indexOf('.');
                const owner = dot < 0 ? this : this.aliases.get(name.slice(0, dot));
                const localName = dot < 0 ? name : name.slice(dot + 1);
                if (!owner?.bindings.isConstant(localName, owner.bindings.globals)) return [];
                const declaration = isNativeFunction(value) ? this.functions.sourceOf(value, true) : undefined;
                return declaration ? [[name, declaration] as const] : [];
            })),
            writableOperations: new Map([...this.variables].flatMap(([name, value]) => {
                const operation = isNativeFunction(value) && value.write && BuiltinRegistry.operationOf(value);
                return operation ? [[name, operation.name] as const] : [];
            })),
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

    /** Look up data/functions without invoking a function or falling back to builtins. */
    private findVariable(name: string): RankValue | undefined {
        const qualified = splitQualified(name);
        if (!qualified) return this.bindings.find(name);
        return this.bindings.current?.lookup(name)
            ?? this.aliases.get(qualified.alias)?.findVariable(qualified.member);
    }

    private resolve(name: string): RankValue {
        const qualified = splitQualified(name);
        if (qualified) {
            // A lazy callback's snapshot can bind a qualified dependency.
            const captured = this.bindings.current?.lookup(name);
            if (captured !== undefined) return captured;
            const { alias, member } = qualified;
            const child = this.aliases.get(alias);
            if (!child) throw new RankError(`unknown module alias: ${alias}`);
            if (member === 'run') throw new RankError(`${alias}.run is only valid as a statement`);
            return child.resolveVariable(member);
        }
        const variable = this.bindings.find(name);
        if (variable !== undefined) {
            return variable;
        }

        const builtin = this.builtins.lookup(name);
        if (builtin !== undefined) return builtin;
        const suggested = RETIRED_IMPLICIT_NAMES.get(name);
        if (suggested) {
            throw new RankError(`a bare \`${name}\` is no longer an implicit ${name}: name one with \`${suggested} = new ${name}\` and use \`${suggested}\``);
        }
        throw this.builtins.unknown(name);
    }

    private resolveVariable(name: string): RankValue {
        const qualified = splitQualified(name);
        if (qualified) {
            const child = this.aliases.get(qualified.alias);
            if (!child) throw new RankError(`unknown module alias: ${qualified.alias}`);
            return child.resolveVariable(qualified.member);
        }
        const value = this.bindings.find(name);
        if (value === undefined) {
            throw new RankError(`unknown variable: ${name}`);
        }
        return value;
    }

    private protect(name: string, plan: string, note: string): () => void {
        const qualified = splitQualified(name);
        if (qualified) return this.aliases.get(qualified.alias)?.protect(qualified.member, plan, note) ?? (() => undefined);
        return this.bindings.protect(name, plan, note);
    }

    private checkMutable(name: string, local = false): void {
        const qualified = splitQualified(name);
        if (qualified) this.aliases.get(qualified.alias)?.checkMutable(qualified.member);
        else this.bindings.checkMutable(name, local);
    }

    private checkArrayWrite(name: string, target: RankValue, values: readonly RankValue[], offsets?: readonly number[]): readonly RankValue[] {
        const qualified = splitQualified(name);
        if (qualified?.alias) {
            const child = this.aliases.get(qualified.alias);
            if (child) return child.checkArrayWrite(qualified.member, target, values, offsets);
        }
        return (this.bindings.current?.find(name) ?? this.bindings.globals).checkArrayWrite(name, target, values, offsets);
    }

    private compileAssign(name: string): (value: RankValue) => void {
        return name.includes('.') ? value => this.assign(name, value) : this.bindings.compileAssign(name);
    }

    private assign(name: string, value: RankValue): void {
        const qualified = splitQualified(name);
        if (qualified) {
            const { alias, member } = qualified;
            const child = this.aliases.get(alias);
            if (!child) throw new RankError(`unknown module alias: ${alias}`);
            child.assign(member, value);
            return;
        }
        this.bindings.assign(name, value);
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
        for (const [key, value] of this.openPrograms) child.openPrograms.set(key, value);
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
                if (!isFunctionStatement(statement) && !isFunctionBindingStatement(statement)) continue;
                const existing = this.variables.get(statement.name);
                if (isFunctionStatement(statement) && existing && isNativeFunction(existing)
                    && this.functions.isDeclaration(existing, statement)) {
                    // Loading the same program again is a host replay of its
                    // declarations, not a replacement declaration in source.
                    this.bindings.forget([statement.name]);
                }
                this.assign(statement.name, child.resolveVariable(statement.name));
                if (isFunctionStatement(statement)) this.bindings.lockFunction(statement.name);
            }
            this.currentRunTarget = loaded;
        }
        return loaded;
    }

    private prepareModule(program: Program): void {
        validateFunctionPlacement(program.statements, 'top');
        const scopeError = functionScopeDiagnostics(program)[0];
        if (scopeError) throw this.locateError(new RankError(scopeDiagnosticMessage(scopeError, this.options.sourceId ?? '<input>'), 'Scope'), scopeError.node);
        this.checkBuiltinBindings(program);
        this.declareFunctions(program.statements);
        for (const statement of program.statements) {
            if (isFunctionBindingStatement(statement)) {
                this.functions.defineBinding(statement, name => this.resolve(name), value => this.evaluate(value));
                continue;
            }
            if (!isUseStatement(statement)) continue;
            if (statement.path !== undefined) {
                this.useFile(statement.path, statement.alias);
            } else {
                this.useStandard(statement.module!);
            }
        }
    }

    private load(specifier: string, fromId = this.options.sourceId): LoadedProgram {
        const key = `${fromId ?? '<input>'}\0${specifier}`;
        const cached = this.openPrograms.get(key);
        if (cached) return cached;
        if (!this.options.loadModule) {
            throw new RankError(`cannot load module without a loader: ${specifier}`);
        }
        const source = this.options.loadModule(specifier, fromId);
        if (this.parsingPrograms.has(source.id)) throw new RankError(`cyclic module import: ${source.id}`);
        this.parsingPrograms.add(source.id);
        try {
            const loaded = { id: source.id, program: parse(source.source, source.id, {
                loadModule: path => this.load(path, source.id).program,
            }) };
            registerSource(loaded.program, source.id);
            this.openPrograms.set(key, loaded);
            return loaded;
        } finally { this.parsingPrograms.delete(source.id); }
    }

    private run(specifier?: string): RankValue | undefined {
        const target = specifier ? this.useFile(specifier) : this.currentRunTarget;
        if (!target) {
            throw new RankError('run requires a previously used program or a file name');
        }
        const args = this.pendingArgs ?? [];
        this.pendingArgs = undefined;
        // The named run becomes the target for later bare runs. Imports or nested
        // runs inside it must not replace that target, even when execution fails.
        const callerRunTarget = this.currentRunTarget;
        try {
            return this.resources.withResourceScope(() => this.executeProgram(target.program, args));
        } finally {
            this.currentRunTarget = callerRunTarget;
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
            environment: new EnvironmentOverlay(effectiveEnvironment(this.options.environment!)),
            random: this.random,
            testing: true,
        });
        test.environmentOverride = test.options.environment;
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
export {
    resolveCompilerCapabilities,
    type CompilerCapabilities, type CompilerCapabilitiesConfig,
    type InterpreterOptions, type LoadedModule, type RankTestResult,
} from './interpreter-options.js';
