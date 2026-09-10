import {
    isAddStatement,
    isArrayExpression,
    isArgsStatement,
    isArgumentStatement,
    isApplicationExpression,
    isAssignmentStatement,
    isBinaryExpression,
    isBooleanLiteral,
    isBreakStatement,
    isExpressionStatement,
    isFlagStatement,
    isForStatement,
    isFunctionStatement,
    isIfStatement,
    isIndexAssignmentStatement,
    isLabelLiteral,
    isMaterializeExpression,
    isNameExpression,
    isNumberLiteral,
    isOptionStatement,
    isParenthesizedExpression,
    isPushStatement,
    isRunStatement,
    isReturnStatement,
    isStdinExpression,
    isStringLiteral,
    isTestStatement,
    isTryStatement,
    isUnaryExpression,
    isUnpackStatement,
    isUseStatement,
    isYieldStatement,
    type ArrayItem,
    type Expression,
    type FunctionStatement,
    type Program,
    type Statement,
} from 'rank-language';
import { MissingValueError, RankError } from './errors.js';
import type { RankInput, RankIo } from './io.js';
import { standardModules } from './modules/index.js';
import { closeFile } from './modules/io.js';
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
    isRankErrorValue,
    isRankFile,
    isRankIndex,
    isRankLabel,
    isRankObject,
    isRankQueue,
    isRankSet,
    isRankSequence,
    isRankSequenceMask,
    type RankArray,
    type RankFile,
    type NativeFunction,
    type RankIndex,
    type RankQueue,
    type RankSet,
    type RankSequence,
    type RankValue,
    type SequencePredicate,
} from './value.js';

type Output = (text: string) => void;

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
    readonly persistentResources?: boolean;
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

interface LocalFrame {
    readonly values: Map<string, RankValue>;
    readonly types: Map<string, ReadonlySet<string>>;
}

class ReturnSignal {
    constructor(readonly value?: RankValue) {}
}

class BreakSignal {}

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
    private readonly openPrograms = new Map<string, LoadedProgram>();
    private readonly aliases = new Map<string, Interpreter>();
    private currentRunTarget: LoadedProgram | undefined;
    private pendingArgs: string[] | undefined;
    private loadedProgram: LoadedProgram | undefined;
    private readonly localScopes: Map<string, RankValue>[] = [];
    private readonly variableTypes = new Map<string, ReadonlySet<string>>();
    private readonly localTypeScopes: Map<string, ReadonlySet<string>>[] = [];
    private readonly resourceScopes: Set<RankFile>[] = [];
    private readonly generatorResourceScopes = new Set<Set<RankFile>>();

    constructor(output: Output = console.log, options: InterpreterOptions = {}) {
        this.output = output;
        this.options = options;
    }

    execute(source: string): RankValue | undefined {
        const program = parse(source);
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
            pending = error;
        }

        const escaped = pending === undefined && transferResult
            ? containedFiles(result)
            : new Set<RankFile>();
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
        return result as T;
    }

    private ownFile(file: RankFile): void {
        let scope = this.resourceScopes.at(-1);
        if (!scope) {
            scope = new Set();
            this.resourceScopes.push(scope);
        }
        scope.add(file);
    }

    private withLocalFrame<T>(frame: LocalFrame, operation: () => T): T {
        this.localScopes.push(frame.values);
        this.localTypeScopes.push(frame.types);
        try {
            return operation();
        } finally {
            this.localScopes.pop();
            this.localTypeScopes.pop();
        }
    }

    private withGeneratorFrame<T>(
        frame: LocalFrame,
        resources: Set<RankFile>,
        operation: () => T,
    ): T {
        this.resourceScopes.push(resources);
        try {
            return this.withLocalFrame(frame, operation);
        } finally {
            this.resourceScopes.pop();
        }
    }

    private ownFiles(value: RankValue | undefined): void {
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
        const execution = this.executeStatementStream(
            statements,
            assertBooleanExpressions,
            insideLoop,
            insideFinally,
            false,
        );
        const result = execution.next();
        if (!result.done) {
            execution.return(undefined);
            throw new RankError('yield is only valid inside a generator function');
        }
        return result.value;
    }

    private *executeStatementStream(
        statements: Statement[],
        assertBooleanExpressions = false,
        insideLoop = false,
        insideFinally = false,
        insideGenerator = false,
    ): Generator<RankValue, RankValue | undefined> {
        let result: RankValue | undefined;

        for (const statement of statements) {
            if (isUseStatement(statement)) {
                if (statement.path !== undefined) {
                    this.useFile(statement.path, statement.alias);
                } else {
                    this.useStandard(statement.module!);
                }
                result = undefined;
            } else if (isRunStatement(statement)) {
                result = this.run(statement.path);
            } else if (isArgsStatement(statement)) {
                this.pendingArgs = statement.values.map(value => formatValue(this.evaluate(value)));
                result = undefined;
            } else if (isOptionStatement(statement)
                || isArgumentStatement(statement)
                || isFlagStatement(statement)) {
                result = undefined;
            } else if (isTestStatement(statement)) {
                this.executeTest(statement.description, statement.statements);
                result = undefined;
            } else if (isFunctionStatement(statement)) {
                result = this.defineFunction(statement);
            } else if (isYieldStatement(statement)) {
                if (!insideGenerator) {
                    throw new RankError('yield is only valid inside a generator function');
                }
                yield this.evaluate(statement.value);
                result = undefined;
            } else if (isReturnStatement(statement)) {
                if (insideFinally) {
                    throw new RankError('return is not valid inside finally');
                }
                if (this.localScopes.length === 0) {
                    throw new RankError('return is only valid inside a function');
                }
                if (insideGenerator && statement.value !== undefined) {
                    throw new RankError('a generator cannot return a value');
                }
                if (!insideGenerator && statement.value === undefined) {
                    throw new RankError('a value-returning function must return a value');
                }
                throw new ReturnSignal(
                    statement.value === undefined ? undefined : this.evaluate(statement.value),
                );
            } else if (isBreakStatement(statement)) {
                if (insideFinally) {
                    throw new RankError('break is not valid inside finally');
                }
                if (!insideLoop) {
                    throw new RankError('break is only valid inside a for loop');
                }
                throw new BreakSignal();
            } else if (isTryStatement(statement)) {
                let pending: unknown;
                try {
                    try {
                        result = yield* this.executeStatementStream(
                            statement.statements,
                            assertBooleanExpressions,
                            insideLoop,
                            insideFinally,
                            insideGenerator,
                        );
                    } catch (error) {
                        if (!(error instanceof RankError)) throw error;
                        const clause = statement.catches.find(candidate =>
                            candidate.errorKind === undefined
                            || candidate.errorKind.name === error.rankKind);
                        if (!clause) throw error;
                        this.assign(clause.errorName, error.toValue());
                        result = yield* this.executeStatementStream(
                            clause.statements,
                            assertBooleanExpressions,
                            insideLoop,
                            insideFinally,
                            insideGenerator,
                        );
                    }
                } catch (error) {
                    pending = error;
                }
                try {
                    yield* this.executeStatementStream(
                        statement.finallyStatements,
                        assertBooleanExpressions,
                        insideLoop,
                        true,
                        insideGenerator,
                    );
                } catch (error) {
                    if (error instanceof RankError && pending instanceof RankError) {
                        error.attachCause(pending);
                    }
                    pending = error;
                }
                if (pending !== undefined) throw pending;
            } else if (isIfStatement(statement)) {
                let branch = statement.elseStatements;
                if (expectBoolean(this.evaluate(statement.condition))) {
                    branch = statement.thenStatements;
                } else {
                    for (const clause of statement.elifClauses) {
                        if (expectBoolean(this.evaluate(clause.condition))) {
                            branch = clause.statements;
                            break;
                        }
                    }
                }
                result = yield* this.executeStatementStream(
                    branch,
                    assertBooleanExpressions,
                    insideLoop,
                    insideFinally,
                    insideGenerator,
                );
            } else if (isForStatement(statement)) {
                result = undefined;
                const binding = forIteration(statement.condition);
                if (binding) {
                    for (const entry of this.forEntries(binding)) {
                        this.assign(binding.names[0], entry.value);
                        binding.names.slice(1).forEach((name, position) =>
                            this.assign(name, entry.indices[position]));
                        try {
                            result = yield* this.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                true,
                                insideFinally,
                                insideGenerator,
                            );
                        } catch (error) {
                            if (error instanceof BreakSignal) break;
                            throw error;
                        }
                    }
                } else {
                    while (!statement.condition
                        || expectBoolean(this.evaluate(statement.condition))) {
                        try {
                            result = yield* this.executeStatementStream(
                                statement.statements,
                                assertBooleanExpressions,
                                true,
                                insideFinally,
                                insideGenerator,
                            );
                        } catch (error) {
                            if (error instanceof BreakSignal) break;
                            throw error;
                        }
                    }
                }
            } else if (isPushStatement(statement)) {
                const receiver = this.evaluate(statement.receiver);
                if (!isRankQueue(receiver)) throw new RankError('push expects a queue receiver');
                receiver.items.push(this.evaluate(statement.value));
                result = undefined;
            } else if (isAddStatement(statement)) {
                const receiver = this.localSet();
                const value = this.evaluate(statement.value);
                receiver.entries.set(setValueKey(value), value);
                result = undefined;
            } else if (isIndexAssignmentStatement(statement)) {
                const index = this.localIndex();
                const keys = statement.keys.map(key => this.evaluate(key));
                index.entries.set(indexKey(keys), this.evaluate(statement.value));
                result = undefined;
            } else if (isUnpackStatement(statement)) {
                result = this.evaluate(statement.value);
                if (!isRankArray(result) || result.shape.length !== 1) {
                    throw new RankError('unpack expects a rank-1 array value');
                }
                const unpacked = result;
                if (unpacked.items.length !== statement.names.length) {
                    throw new RankError(
                        `unpack expects ${statement.names.length} values, got ${unpacked.items.length}`,
                    );
                }
                statement.names.forEach((name, index) => this.assign(name, unpacked.items[index]));
            } else if (isAssignmentStatement(statement)) {
                if (statement.operator === '=') {
                    result = this.evaluate(statement.value);
                } else {
                    const left = this.resolveVariable(statement.name);
                    const right = this.evaluate(statement.value);
                    result = this.evaluateBinary(
                        assignmentOperator(statement.operator),
                        left,
                        right,
                    );
                }
                this.assign(statement.name, result);
            } else if (isExpressionStatement(statement)) {
                if (isNameExpression(statement.value) && statement.value.name.endsWith('.run')) {
                    result = this.runAlias(statement.value.name.slice(0, -4));
                } else {
                    result = this.evaluate(statement.value);
                    if (assertBooleanExpressions) assertTestExpression(result);
                }
            }
        }

        return result;
    }

    evaluate(expression: Expression): RankValue {
        if (isNumberLiteral(expression) || isBooleanLiteral(expression)) {
            return expression.value;
        }
        if (isStringLiteral(expression)) {
            return expression.value;
        }
        if (isLabelLiteral(expression)) {
            return { kind: 'label', name: expression.name };
        }
        if (isStdinExpression(expression)) {
            this.requireModule('io', 'stdin');
            if (expression.valueType !== 'integer') {
                throw new RankError(`unsupported standard input type: ${expression.valueType}`);
            }
            const input = this.options.input;
            if (!input) {
                throw new RankError('standard input is unavailable in this host', 'IO');
            }
            const token = input.readToken();
            if (token === undefined) {
                throw new RankError('standard input ended before an integer', 'EndOfInput');
            }
            if (!/^[+-]?[0-9]+$/u.test(token)) {
                throw new RankError(`invalid integer input: ${token}`, 'InvalidNumber', token);
            }
            return BigInt(token);
        }
        if (isArrayExpression(expression)) {
            const items = (expression.dimensions.length > 0
                ? expression.rows.flatMap(row => row.items)
                : expression.items).map(item => this.evaluateArrayItem(item));
            if (expression.dimensions.length === 0) return array(items);
            const shape = expression.dimensions.map(item => this.arrayDimension(item));
            const size = shape.reduce((product, dimension) => product * BigInt(dimension), 1n);
            if (BigInt(items.length) !== size) {
                throw new RankError(
                    `array shape ${shape.join(' ')} expects ${size} elements, got ${items.length}`,
                );
            }
            return { kind: 'array', items, shape };
        }
        if (isNameExpression(expression)) {
            return this.resolve(expression.name);
        }
        if (isParenthesizedExpression(expression)) {
            return this.evaluate(expression.value);
        }
        if (isUnaryExpression(expression)) {
            return this.evaluateUnary(expression.operator, this.evaluate(expression.operand));
        }
        if (isBinaryExpression(expression)) {
            if (expression.operator === '**' && isUnaryExpression(expression.left)
                && (expression.left.operator === '+' || expression.left.operator === '-')) {
                const powered = this.evaluateBinary(
                    '**',
                    this.evaluate(expression.left.operand),
                    this.evaluate(expression.right),
                );
                return this.evaluateUnary(expression.left.operator, powered);
            }
            const outer = explicitOuterApplication(expression);
            if (outer) {
                return this.evaluateOuter(
                    outer.operator,
                    this.evaluate(outer.left),
                    this.evaluate(outer.right),
                );
            }
            const reduction = explicitReduceApplication(expression);
            if (reduction) {
                return this.evaluateReduction(
                    reduction.operator,
                    this.evaluate(reduction.source),
                    reduction.rank,
                );
            }
            const slice = inlineSlice(expression);
            if (slice) {
                const start = expectInteger(this.evaluate(slice.start));
                const end = expectInteger(this.evaluate(slice.end));
                const source = this.evaluate(slice.source);
                const axis = slice.axis === undefined ? 0 : safeDimension(slice.axis, 'axis');
                return sliceValue(source, axis, start, end, slice.inclusive);
            }
            if (expression.operator === 'pad') {
                try {
                    return this.evaluate(expression.left);
                } catch (error) {
                    if (error instanceof MissingValueError) {
                        return this.evaluate(expression.right);
                    }
                    throw error;
                }
            }
            return this.evaluateBinary(
                expression.operator,
                this.evaluate(expression.left),
                this.evaluate(expression.right),
                expression.step ? this.evaluate(expression.step) : undefined,
            );
        }
        if (isMaterializeExpression(expression)) {
            const source = this.evaluate(expression.source);
            if (!isRankSequence(source)) {
                throw new RankError('postfix array expects a sequence');
            }
            return materializeSequence(source);
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            const axisWindow = explicitAxisWindow(parts);
            if (axisWindow) {
                this.requireModule('sequences', 'window');
                return windowValue(
                    this.evaluate(axisWindow.source),
                    this.evaluate(axisWindow.size),
                    axisWindow.axes,
                );
            }
            const explicitRank = explicitRankApplication(parts);
            if (explicitRank) {
                const values = explicitRank.parts.map(part => this.evaluate(part));
                return this.applyAtRank(values, explicitRank.rank);
            }
            const axisSelection = explicitAxisSelection(parts);
            if (axisSelection) {
                return selectAxis(
                    this.evaluate(axisSelection.source),
                    axisSelection.axis,
                    this.evaluate(axisSelection.selector),
                );
            }
            const values = parts.map(part => this.evaluate(part));
            return this.apply(values);
        }
        throw new RankError(`cannot evaluate ${expression.$type}`);
    }

    private evaluateArrayItem(item: ArrayItem): RankValue {
        const value = this.evaluate(item.value);
        if (!item.sign) return value;
        return this.evaluateUnary(item.sign, value);
    }

    private arrayDimension(item: ArrayItem): number {
        const dimension = expectInteger(this.evaluateArrayItem(item));
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
        const generator = statementsContainYield(statement.statements);
        const fn: RankValue = {
            kind: 'function',
            name: statement.name,
            arities: [statement.parameters.length],
            monadicRank: 'all',
            call: arguments_ => generator
                ? this.callGeneratorFunction(statement, arguments_)
                : this.callFunction(statement, arguments_),
        };
        this.assign(statement.name, fn);
        return fn;
    }

    private functionFrame(
        statement: FunctionStatement,
        arguments_: RankValue[],
    ): LocalFrame {
        if (arguments_.length !== statement.parameters.length) {
            throw new RankError(
                `${statement.name} expects ${statement.parameters.length} arguments, got ${arguments_.length}`,
            );
        }
        const frame: LocalFrame = {
            values: new Map<string, RankValue>(),
            types: new Map<string, ReadonlySet<string>>(),
        };
        statement.parameters.forEach((parameter, index) => {
            frame.values.set(parameter, arguments_[index]);
            frame.types.set(parameter, new Set([typeName(arguments_[index])]));
        });
        return frame;
    }

    private callFunction(statement: FunctionStatement, arguments_: RankValue[]): RankValue {
        const frame = this.functionFrame(statement, arguments_);
        return this.withResourceScope(() => {
            return this.withLocalFrame(frame, () => {
                try {
                    this.executeStatements(statement.statements);
                } catch (error) {
                    if (error instanceof ReturnSignal && error.value !== undefined) {
                        return error.value;
                    }
                    throw error;
                }
                throw new RankError(`function ${statement.name} reached end without return`);
            });
        });
    }

    private callGeneratorFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
    ): RankSequence {
        const frame = this.functionFrame(statement, arguments_);
        const interpreter = this;
        let consumed = false;

        return sequence({
            name: statement.name,
            size: { kind: 'unknown' },
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
                const execution = interpreter.executeStatementStream(
                    statement.statements,
                    false,
                    false,
                    false,
                    true,
                );
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
                            () => execution.return(undefined),
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
        const scope = this.localScopes.at(-1) ?? this.variables;
        const existing = scope.get('index');
        if (existing !== undefined) {
            if (!isRankIndex(existing)) throw new RankError('index name is already in use');
            return existing;
        }
        const index: RankIndex = { kind: 'index', entries: new Map() };
        scope.set('index', index);
        return index;
    }

    private localQueue(): RankQueue {
        this.requireModule('algo', 'queue');
        const scope = this.localScopes.at(-1) ?? this.variables;
        const existing = scope.get('queue');
        if (existing !== undefined) {
            if (!isRankQueue(existing)) throw new RankError('queue name is already in use');
            return existing;
        }
        const queue: RankQueue = { kind: 'queue', items: [] };
        scope.set('queue', queue);
        return queue;
    }

    private localSet(): RankSet {
        this.requireModule('algo', 'set');
        const scope = this.localScopes.at(-1) ?? this.variables;
        const existing = scope.get('set');
        if (existing !== undefined) {
            if (!isRankSet(existing)) throw new RankError('set name is already in use');
            return existing;
        }
        const set: RankSet = { kind: 'set', entries: new Map() };
        scope.set('set', set);
        return set;
    }

    private useFile(specifier: string, alias?: string): LoadedProgram {
        const loaded = this.load(specifier);
        const child = new Interpreter(this.output, {
            input: this.options.input,
            io: this.options.io,
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
        const loaded = { id: source.id, program: parse(source.source) };
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
                error: error instanceof Error ? error.message : String(error),
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
        const variable = this.findVariable(name);
        if (variable !== undefined) {
            return variable;
        }

        if (name === 'index') return this.localIndex();
        if (name === 'queue') return this.localQueue();
        if (name === 'set') return this.localSet();
        if (name === 'raise') return raiseFunction;
        if (name === 'type') return typeFunction;

        for (const module of this.modules) {
            const fn = standardModules[module]?.[name];
            if (fn) {
                return fn({
                    output: this.output,
                    io: this.options.io,
                    ownFile: file => this.ownFile(file),
                });
            }
        }

        throw new RankError(`unknown name: ${name}`);
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
            const scope = this.localScopes.at(-1) ?? this.variables;
            const typeScope = this.localTypeScopes.at(-1) ?? this.variableTypes;
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

    private findVariable(name: string): RankValue | undefined {
        for (let index = this.localScopes.length - 1; index >= 0; index -= 1) {
            const value = this.localScopes[index].get(name);
            if (value !== undefined) return value;
        }
        return this.variables.get(name);
    }

    private apply(values: RankValue[]): RankValue {
        if (!values.some(isNativeFunction)) return applySelectors(values);

        let pending: RankValue[] = [];
        for (const value of values) {
            if (!isNativeFunction(value)) {
                pending.push(value);
                continue;
            }
            if (pending.length === 0) {
                throw new RankError(`operation must follow its data: ${value.name}`);
            }

            const arguments_ = callArguments(value, pending);
            const result = arguments_.length === 1 && value.monadicRank !== 'all'
                ? this.applyUnaryAtRank(arguments_[0], value, value.monadicRank)
                : value.call(arguments_);
            this.ownFiles(result);
            pending = [result];
        }
        return pending.length === 1 ? pending[0] : applySelectors(pending);
    }

    private applyAtRank(values: RankValue[], rank: bigint): RankValue {
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
        return this.applyUnaryAtRank(receivers[0], fn, Number(rank));
    }

    private applyUnaryAtRank(
        value: RankValue,
        fn: Extract<RankValue, { kind: 'function' }>,
        cellRank: number,
    ): RankValue {
        if (typeof value === 'string') {
            if (cellRank >= 1) return fn.call([value]);
            return mapTextAtoms(value, atom => fn.call([atom]), fn.name);
        }
        if (isRankSequence(value)) {
            if (cellRank >= 1) return fn.call([value]);
            return mapSequence(value, fn.name, atom => fn.call([atom]));
        }
        if (isRankArray(value)) {
            if (cellRank >= value.shape.length) return fn.call([value]);
            if (cellRank === 0) {
                return lazyArray(value.shape, index => fn.call([arrayItem(value, index)]));
            }
            throw new RankError(`rank ${cellRank} over tensors is not implemented yet`);
        }
        return fn.call([value]);
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
                const cell = cellRank === 0
                    ? arrayItem(value, start)
                    : lazyArray(cellShape, index => arrayItem(value, start + index));
                return this.reduceCell(operator, cell);
            });
        }
        if (cellRank > valueRank(value)) {
            throw new RankError(`rank ${cellRank} exceeds value rank ${valueRank(value)}`);
        }
        return this.reduceCell(operator, value);
    }

    private reduceCell(operator: string, value: RankValue): RankValue {
        if (isRankSequence(value)) {
            const planned = value.plan.reduce?.(operator);
            if (planned !== undefined) return planned;
        }
        const values = reductionValues(value, operator);
        const first = values.next();
        if (first.done) return reductionIdentity(operator);
        let result = first.value;
        for (let next = values.next(); !next.done; next = values.next()) {
            result = this.evaluateBinary(operator, result, next.value);
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
            return array(value.items.map(item => this.evaluateUnary(operator, item)));
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
        if (operator === 'is') {
            if (!isRankLabel(right)) {
                throw new RankError('is expects a type label on the right');
            }
            if (!RUNTIME_TYPE_NAMES.has(right.name)) {
                throw new RankError(`unknown type label: .${right.name}`);
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
            throw new RankError('in expects text, an object, index or set on the right');
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
            return expectInteger(left) % expectInteger(right) === 0n;
        }
        if (operator === 'less' || operator === 'greater'
            || operator === 'atleast' || operator === 'atmost') {
            const a = expectNumeric(left);
            const b = expectNumeric(right);
            if (operator === 'less') return a < b;
            if (operator === 'greater') return a > b;
            if (operator === 'atleast') return a >= b;
            return a <= b;
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
            case '//': return bothIntegers ? floorDivide(a, b) : Math.floor(Number(a) / Number(b));
            case '%': return bothIntegers ? a % b : Number(a) % Number(b);
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

    private *forEntries(binding: ForBinding): IterableIterator<ForEntry> {
        const spec = tensorIterationSpec(binding.iterable);
        if (spec) {
            const value = this.evaluate(spec.source);
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

        const value = this.evaluate(binding.iterable);
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
        const scope = this.localScopes.at(-1) ?? this.variables;
        const typeScope = this.localTypeScopes.at(-1) ?? this.variableTypes;
        names.forEach((name, index) => {
            const inferred = candidates[index];
            if (!inferred || inferred.size === 0) return;
            const previous = typeScope.get(name)
                ?? (scope.has(name) ? new Set([typeName(scope.get(name)!)]) : undefined);
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
    if (bindings.length < 1 || !bindings.every(isNameExpression)) {
        return undefined;
    }
    return {
        names: bindings.map(binding => binding.name),
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
        for (const cellCoordinates of coordinates(cellShape)) {
            cellAxes.forEach((axis, position) => {
                fullCoordinates[axis] = cellCoordinates[position];
            });
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

function makeRange(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
    const magnitude = stride ?? 1n;
    if (magnitude <= 0n) throw new RankError('range step must be a positive integer');

    const ascending = start <= end;
    const step = ascending ? magnitude : -magnitude;
    const distance = absolute(end - start);
    const size = inclusive
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
    if (isRankSequence(value)) return sequenceValues(value, 'for');
    if (isRankArray(value)) return value.items;
    if (isRankQueue(value)) return value.items;
    if (isRankSet(value)) return value.entries.values();
    if (typeof value === 'string') return [...value];
    throw new RankError(`for expects text or a sequence, got ${typeName(value)}`);
}

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function applySelectors(values: RankValue[]): RankValue {
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
        if (value === undefined) throw new MissingValueError('missing keyed value');
        return value;
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
        return atArray(values[0], values.slice(1) as bigint[]);
    }
    if (values.length === 2 && isRankArray(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
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
): RankValue[] {
    if (fn.arities.includes(values.length)) return values;

    const arities = [...fn.arities].sort((left, right) => right - left);
    for (const arity of arities) {
        if (arity < 1 || values.length <= arity) continue;
        const firstLength = values.length - arity + 1;
        const firstParts = values.slice(0, firstLength);
        if (!canApplySelectors(firstParts)) continue;
        return [applySelectors(firstParts), ...values.slice(firstLength)];
    }

    return values;
}

function canApplySelectors(values: RankValue[]): boolean {
    if (values.length < 2) return false;
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
    if (isRankArray(values[0]) && isRankSequence(values[1])) return true;
    if (isRankIndex(values[0]) && values.length > 1) return true;
    if (isRankObject(values[0]) && values.length === 2
        && typeof values[1] === 'string') return true;
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') return true;
    if (isRankQueue(values[0]) && isIntegerCollectionSelector(values[1])) return true;
    if (isRankArray(values[0]) && values.length > 1
        && values.slice(1).every(value => typeof value === 'bigint')) return true;
    return false;
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
    if (indices.length === source.shape.length) return source.items[offset];
    const shape = source.shape.slice(indices.length);
    const size = shape.reduce((product, value) => product * value, 1);
    return { kind: 'array', items: source.items.slice(offset, offset + size), shape };
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
    const indices = selectorIndices(selector, size, axis);
    if (typeof source === 'string') {
        const atoms = [...source];
        return indices.map(index => atoms[index]).join('');
    }
    if (isRankSequence(source)) {
        return array(indices.map(index => atSequence(source, BigInt(index))));
    }
    const input = isRankQueue(source)
        ? { kind: 'array' as const, items: source.items, shape: [source.items.length] }
        : source as RankArray;
    const shape = [...input.shape];
    shape[axis] = indices.length;
    const items: RankValue[] = [];
    for (const outputCoordinates of coordinates(shape)) {
        const inputCoordinates = [...outputCoordinates];
        inputCoordinates[axis] = indices[outputCoordinates[axis]];
        items.push(input.items[arrayOffset(input.shape, inputCoordinates)]);
    }
    return { kind: 'array', items, shape };
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

function indexKey(values: readonly RankValue[]): string {
    if (values.length === 0) throw new RankError('index requires at least one key');
    return values.map(value => {
        if (typeof value === 'bigint') return `integer:${value}`;
        if (typeof value === 'boolean') return `boolean:${value}`;
        if (typeof value === 'string') return `text:${value}`;
        if (typeof value === 'object' && value.kind === 'label') return `label:${value.name}`;
        throw new RankError('index keys must be scalar values');
    }).join('|');
}

function assignmentOperator(operator: string): string {
    return operator.slice(0, -1);
}

function statementsContainYield(statements: readonly Statement[]): boolean {
    return statements.some(statement => {
        if (isYieldStatement(statement)) return true;
        if (isFunctionStatement(statement) || isTestStatement(statement)) return false;
        if (isIfStatement(statement)) {
            return statementsContainYield(statement.thenStatements)
                || statement.elifClauses.some(clause =>
                    statementsContainYield(clause.statements))
                || statementsContainYield(statement.elseStatements);
        }
        if (isForStatement(statement)) {
            return statementsContainYield(statement.statements);
        }
        if (isTryStatement(statement)) {
            return statementsContainYield(statement.statements)
                || statement.catches.some(clause =>
                    statementsContainYield(clause.statements))
                || statementsContainYield(statement.finallyStatements);
        }
        return false;
    });
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
    if (isRankSequence(left) && isRankSequence(right)) {
        return zipSequences(left, right, name, operation);
    }
    if (isRankSequence(left)) {
        return mapSequence(left, name, item => operation(item, right));
    }
    if (isRankSequence(right)) {
        return mapSequence(right, name, item => operation(left, item));
    }
    const leftArray = asRankArray(left);
    const rightArray = asRankArray(right);
    if (leftArray && rightArray) {
        if (!sameShape(leftArray.shape, rightArray.shape)) {
            throw new RankError(`shape mismatch: ${leftArray.shape} and ${rightArray.shape}`);
        }
        return lazyArray(leftArray.shape, index =>
            operation(arrayItem(leftArray, index), arrayItem(rightArray, index)));
    }
    const source = leftArray ?? rightArray!;
    return lazyArray(source.shape, index => {
        const item = arrayItem(source, index);
        return leftArray ? operation(item, right) : operation(left, item);
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

function explicitRankApplication(parts: Expression[]): { parts: Expression[]; rank: bigint } | undefined {
    const modifier = parts.at(-2);
    const rank = parts.at(-1);
    if (!modifier || !rank || !isNameExpression(modifier) || modifier.name !== 'rank') return undefined;
    if (!isNumberLiteral(rank) || typeof rank.value !== 'bigint') {
        throw new RankError('rank expects a nonnegative integer');
    }
    return { parts: parts.slice(0, -2), rank: rank.value };
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
    return left === right;
}

function typeName(value: RankValue): string {
    if (typeof value === 'number') return 'real';
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'string') return 'text';
    if (typeof value !== 'object') return typeof value;
    return value.kind;
}

const RUNTIME_TYPE_NAMES = new Set([
    'integer',
    'real',
    'boolean',
    'text',
    'array',
    'bytes',
    'label',
    'object',
    'file',
    'error',
    'index',
    'queue',
    'set',
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
    const seen = new Set<object>();

    const visit = (item: RankValue | undefined): void => {
        if (item === undefined || typeof item !== 'object' || seen.has(item)) return;
        seen.add(item);
        if (isRankFile(item)) {
            files.add(item);
        } else if (isRankArray(item) || isRankQueue(item)) {
            item.items.forEach(visit);
        } else if (isRankIndex(item) || isRankSet(item) || isRankObject(item)) {
            item.entries.forEach(visit);
        } else if (isRankErrorValue(item)) {
            visit(item.value);
            visit(item.cause);
        }
    };

    visit(value);
    return files;
}
