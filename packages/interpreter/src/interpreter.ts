import {
    isArrayExpression,
    isArgsStatement,
    isArgumentStatement,
    isApplicationExpression,
    isAssignmentStatement,
    isBinaryExpression,
    isBooleanLiteral,
    isExpressionStatement,
    isFlagStatement,
    isForStatement,
    isFunctionStatement,
    isIfStatement,
    isIndexAssignmentStatement,
    isLabelLiteral,
    isNameExpression,
    isNumberLiteral,
    isOptionStatement,
    isParenthesizedExpression,
    isPushStatement,
    isRunStatement,
    isReturnStatement,
    isStringLiteral,
    isTestStatement,
    isUnaryExpression,
    isUseStatement,
    type ArrayItem,
    type Expression,
    type FunctionStatement,
    type Program,
    type Statement,
} from 'rank-language';
import { MissingValueError, RankError } from './errors.js';
import { standardModules } from './modules/index.js';
import { parse } from './parser.js';
import {
    atSequence,
    boundSequence,
    filterSequence,
    mapSequence,
    sequence,
    sequenceMask,
    sequenceValues,
    zipSequences,
} from './sequence.js';
import {
    formatValue,
    isNativeFunction,
    isRankArray,
    isRankIndex,
    isRankQueue,
    isRankSequence,
    isRankSequenceMask,
    type RankArray,
    type RankIndex,
    type RankQueue,
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

class ReturnSignal {
    constructor(readonly value: RankValue) {}
}

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
        return this.executeProgram(program, this.options.args ?? []);
    }

    executeProgram(
        program: Program,
        args: readonly string[] = [],
        assertBooleanExpressions = false,
    ): RankValue | undefined {
        this.prepareInputs(program, args);
        return this.executeStatements(program.statements, assertBooleanExpressions);
    }

    private executeStatements(
        statements: Statement[],
        assertBooleanExpressions = false,
    ): RankValue | undefined {
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
            } else if (isReturnStatement(statement)) {
                if (this.localScopes.length === 0) {
                    throw new RankError('return is only valid inside a function');
                }
                throw new ReturnSignal(this.evaluate(statement.value));
            } else if (isIfStatement(statement)) {
                const branch = expectBoolean(this.evaluate(statement.condition))
                    ? statement.thenStatements
                    : statement.elseStatements;
                result = this.executeStatements(branch, assertBooleanExpressions);
            } else if (isForStatement(statement)) {
                result = undefined;
                const binding = forIteration(statement.condition);
                if (binding) {
                    for (const entry of this.forEntries(binding)) {
                        this.assign(binding.names[0], entry.value);
                        binding.names.slice(1).forEach((name, position) =>
                            this.assign(name, entry.indices[position]));
                        result = this.executeStatements(statement.statements, assertBooleanExpressions);
                    }
                } else {
                    while (!statement.condition
                        || expectBoolean(this.evaluate(statement.condition))) {
                        result = this.executeStatements(statement.statements, assertBooleanExpressions);
                    }
                }
            } else if (isPushStatement(statement)) {
                const receiver = this.evaluate(statement.receiver);
                if (!isRankQueue(receiver)) throw new RankError('push expects a queue receiver');
                receiver.items.push(this.evaluate(statement.value));
                result = undefined;
            } else if (isIndexAssignmentStatement(statement)) {
                const index = this.localIndex();
                const keys = statement.keys.map(key => this.evaluate(key));
                index.entries.set(indexKey(keys), this.evaluate(statement.value));
                result = undefined;
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
            );
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            const explicitRank = explicitRankApplication(parts);
            if (explicitRank) {
                const values = explicitRank.parts.map(part => this.evaluate(part));
                return this.applyAtRank(values, explicitRank.rank);
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
        const fn: RankValue = {
            kind: 'function',
            name: statement.name,
            arities: [statement.parameters.length],
            monadicRank: 'all',
            call: arguments_ => this.callFunction(statement, arguments_),
        };
        this.assign(statement.name, fn);
        return fn;
    }

    private callFunction(statement: FunctionStatement, arguments_: RankValue[]): RankValue {
        if (arguments_.length !== statement.parameters.length) {
            throw new RankError(
                `${statement.name} expects ${statement.parameters.length} arguments, got ${arguments_.length}`,
            );
        }
        const scope = new Map<string, RankValue>();
        statement.parameters.forEach((parameter, index) => scope.set(parameter, arguments_[index]));
        this.localScopes.push(scope);
        try {
            this.executeStatements(statement.statements);
        } catch (error) {
            if (error instanceof ReturnSignal) return error.value;
            throw error;
        } finally {
            this.localScopes.pop();
        }
        throw new RankError(`function ${statement.name} reached end without return`);
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

    private useFile(specifier: string, alias?: string): LoadedProgram {
        const loaded = this.load(specifier);
        if (alias) {
            if (this.aliases.has(alias) || this.variables.has(alias)) {
                throw new RankError(`name already defined: ${alias}`);
            }
            const child = new Interpreter(this.output, {
                loadModule: this.options.loadModule,
                sourceId: loaded.id,
            });
            child.loadedProgram = loaded;
            this.aliases.set(alias, child);
        } else {
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
            return this.executeProgram(target.program, args);
        } finally {
            this.currentRunTarget = previous;
        }
    }

    private runAlias(alias: string): RankValue | undefined {
        const child = this.aliases.get(alias);
        if (!child?.loadedProgram) {
            throw new RankError(`unknown module alias: ${alias}`);
        }
        return child.executeProgram(child.loadedProgram.program);
    }

    private executeTest(name: string, statements: Statement[]): void {
        if (!this.options.testing && !this.modules.has('testing')) {
            throw new RankError('test requires: use testing');
        }
        const output: string[] = [];
        const test = new Interpreter(line => output.push(line), {
            loadModule: this.options.loadModule,
            sourceId: this.options.sourceId,
            testing: true,
        });
        test.modules.add('testing');
        const program = { $type: 'Program' as const, statements } as Program;
        try {
            test.executeProgram(program, [], true);
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

        for (const module of this.modules) {
            const fn = standardModules[module]?.[name];
            if (fn) {
                return fn(this.output);
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
            const previous = scope.get(name);
            if (previous !== undefined && typeName(previous) !== typeName(value)) {
                throw new RankError(
                    `${name} has type ${typeName(previous)} and cannot receive ${typeName(value)}`,
                );
            }
            scope.set(name, value);
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
        const functions = values.filter(isNativeFunction);
        if (functions.length === 0) {
            return applySelectors(values);
        }
        if (functions.length > 1) {
            throw new RankError('application contains more than one operation');
        }

        const fn = functions[0];
        const functionIndex = values.indexOf(fn);
        if (functionIndex !== values.length - 1) {
            throw new RankError(`operation must follow its data: ${fn.name}`);
        }
        const receivers = values.slice(0, functionIndex);
        const arguments_ = receivers.length > 1 && fn.arities.includes(1)
            && canApplySelectors(receivers)
            ? [applySelectors(receivers)]
            : receivers;
        if (arguments_.length === 1 && fn.monadicRank !== 'all') {
            return this.applyUnaryAtRank(arguments_[0], fn, fn.monadicRank);
        }
        return fn.call(arguments_);
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
            if (cellRank === 0) return array(value.items.map(atom => fn.call([atom])));
            throw new RankError(`rank ${cellRank} over tensors is not implemented yet`);
        }
        return fn.call([value]);
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

    private evaluateBinary(operator: string, left: RankValue, right: RankValue): RankValue {
        if (operator === 'to' || operator === 'until') {
            if (isRankSequence(left)) {
                return boundSequence(left, expectInteger(right), operator === 'to');
            }
            this.requireModule('ranges', operator);
            return makeRange(expectInteger(left), expectInteger(right), operator === 'to');
        }
        if (isRankSequenceMask(left) || isRankSequenceMask(right)) {
            return this.combineSequenceMasks(operator, left, right);
        }
        if (operator === 'in') {
            if (!isRankIndex(right)) throw new RankError('in expects an index on the right');
            return right.entries.has(indexKey([left]));
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
            yield* tensorEntries(value, frameAxes);
            return;
        }

        const value = this.evaluate(binding.iterable);
        if (isRankArray(value) && value.shape.length > 1) {
            validateForBindings(binding.names, 1);
            yield* tensorEntries(value, [0]);
            return;
        }

        validateForBindings(binding.names, 1);
        let index = 0n;
        for (const item of iterationValues(value)) {
            yield { value: item, indices: [index] };
            index += 1n;
        }
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
    readonly indices: readonly bigint[];
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

function makeRange(start: bigint, end: bigint, inclusive: boolean): RankSequence {
    const step = start <= end ? 1n : -1n;
    const stop = inclusive ? end + step : end;
    return sequence({
        name: `${start} ${inclusive ? 'to' : 'until'} ${end}`,
        size: {
            kind: 'exact',
            value: absolute(end - start) + (inclusive ? 1n : 0n),
        },
        *iterate() {
            for (let value = start; value !== stop; value += step) yield value;
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
    if (typeof value === 'string') return [...value];
    throw new RankError(`for expects text or a sequence, got ${typeName(value)}`);
}

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function applySelectors(values: RankValue[]): RankValue {
    if (values.length === 2 && typeof values[0] === 'string' && typeof values[1] === 'bigint') {
        const atoms = [...values[0]];
        const index = values[1];
        if (index < 0n) throw new RankError('text index must be nonnegative');
        if (index >= BigInt(atoms.length)) {
            throw new MissingValueError(`text index out of bounds: ${index}`);
        }
        return atoms[Number(index)];
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
    if (isRankIndex(values[0])) {
        const value = values[0].entries.get(indexKey(values.slice(1)));
        if (value === undefined) throw new MissingValueError('missing keyed value');
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
    if (isRankArray(values[0]) && values.length > 1
        && values.slice(1).every(value => typeof value === 'bigint')) {
        return atArray(values[0], values.slice(1) as bigint[]);
    }
    if (values.length !== 2 || !isRankArray(values[0]) || !isRankArray(values[1])) {
        throw new RankError('value application requires a sequence and one selector');
    }

    const [source, selector] = values;
    if (source.items.length !== selector.items.length) {
        throw new RankError(`mask shape mismatch: ${source.shape} and ${selector.shape}`);
    }
    if (!selector.items.every(item => typeof item === 'boolean')) {
        throw new RankError('array selector must be a boolean mask');
    }

    return array(source.items.filter((_, index) => selector.items[index]));
}

function canApplySelectors(values: RankValue[]): boolean {
    if (values.length !== 2) return false;
    if (typeof values[0] === 'string' && typeof values[1] === 'bigint') return true;
    if (isRankSequence(values[0]) && typeof values[1] === 'bigint') return true;
    if (isRankSequence(values[0]) && isRankSequenceMask(values[1])) {
        return values[0] === values[1].source;
    }
    if (isRankArray(values[0]) && isRankArray(values[1])) {
        return values[0].items.length === values[1].items.length
            && values[1].items.every(item => typeof item === 'boolean');
    }
    if (isRankIndex(values[0]) && values.length > 1) return true;
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') return true;
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
        return {
            kind: 'array',
            items: leftArray.items.map((item, index) => operation(item, rightArray.items[index])),
            shape: leftArray.shape,
        };
    }
    const source = leftArray ?? rightArray!;
    return {
        kind: 'array',
        items: source.items.map(item => leftArray ? operation(item, right) : operation(left, item)),
        shape: source.shape,
    };
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
    if (typeof value !== 'object') {
        return typeof value;
    }
    return value.kind;
}
