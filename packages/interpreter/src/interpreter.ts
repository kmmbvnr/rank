import {
    isArgsStatement,
    isArgumentStatement,
    isApplicationExpression,
    isAssignmentStatement,
    isBinaryExpression,
    isBooleanLiteral,
    isExpressionStatement,
    isFlagStatement,
    isLabelLiteral,
    isNameExpression,
    isNumberLiteral,
    isOptionStatement,
    isParenthesizedExpression,
    isRunStatement,
    isStringLiteral,
    isTestStatement,
    isUnaryExpression,
    isUseStatement,
    type Expression,
    type Program,
    type Statement,
} from 'rank-language';
import { RankError } from './errors.js';
import { standardModules } from './modules/index.js';
import { parse } from './parser.js';
import {
    atSequence,
    boundSequence,
    filterSequence,
    mapSequence,
    sequence,
    sequenceMask,
    zipSequences,
} from './sequence.js';
import {
    formatValue,
    isNativeFunction,
    isRankArray,
    isRankSequence,
    isRankSequenceMask,
    type RankArray,
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
        let result: RankValue | undefined;

        for (const statement of program.statements) {
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
                    if (assertBooleanExpressions && typeof result === 'boolean' && !result) {
                        throw new RankError('boolean test expression evaluated to false');
                    }
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
            return this.evaluateBinary(
                expression.operator,
                this.evaluate(expression.left),
                this.evaluate(expression.right),
            );
        }
        if (isApplicationExpression(expression)) {
            const values = flattenApplication(expression).map(part => this.evaluate(part));
            return this.apply(values);
        }
        throw new RankError(`cannot evaluate ${expression.$type}`);
    }

    private useStandard(module: string): void {
        if (!(module in standardModules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        this.modules.add(module);
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
        const variable = this.variables.get(name);
        if (variable !== undefined) {
            return variable;
        }

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
        const value = this.variables.get(name);
        if (value === undefined) {
            throw new RankError(`unknown variable: ${name}`);
        }
        return value;
    }

    private assign(name: string, value: RankValue): void {
        const qualified = splitQualified(name);
        if (!qualified) {
            this.variables.set(name, value);
            return;
        }
        const [alias, member] = qualified;
        const child = this.aliases.get(alias);
        if (!child) throw new RankError(`unknown module alias: ${alias}`);
        child.variables.set(member, value);
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
        return fn.call(arguments_);
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
        if ((operator === '+' || operator === '-') && typeof value === 'bigint') {
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
        if (isRankSequence(left) || isRankSequence(right)) {
            if (isPredicateOperator(operator)) {
                return this.sequenceComparison(operator, left, right);
            }
            return mapBinary(left, right, operator, (a, b) => this.evaluateBinary(operator, a, b));
        }
        if (isRankArray(left) || isRankArray(right)) {
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
        if (operator === 'less' || operator === 'greater') {
            const a = expectInteger(left);
            const b = expectInteger(right);
            return operator === 'less' ? a < b : a > b;
        }

        const a = expectInteger(left);
        const b = expectInteger(right);
        if ((operator === '/' || operator === '%') && b === 0n) {
            throw new RankError('division by zero');
        }
        switch (operator) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return a / b;
            case '%': return a % b;
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
    if ((valueType === 'text' || valueType === 'path') && typeof value === 'string') return;
    if (valueType === 'boolean' && typeof value === 'boolean') return;
    if (!['integer', 'text', 'path', 'boolean'].includes(valueType)) {
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

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function applySelectors(values: RankValue[]): RankValue {
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
    if (isRankSequence(values[0]) && typeof values[1] === 'bigint') return true;
    if (isRankSequence(values[0]) && isRankSequenceMask(values[1])) {
        return values[0] === values[1].source;
    }
    if (isRankArray(values[0]) && isRankArray(values[1])) {
        return values[0].items.length === values[1].items.length
            && values[1].items.every(item => typeof item === 'boolean');
    }
    return false;
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
    if (isRankArray(left) && isRankArray(right)) {
        if (left.items.length !== right.items.length) {
            throw new RankError(`shape mismatch: ${left.shape} and ${right.shape}`);
        }
        return array(left.items.map((item, index) => operation(item, right.items[index])));
    }
    const source = isRankArray(left) ? left : right as RankArray;
    return array(source.items.map(item => isRankArray(left) ? operation(item, right) : operation(left, item)));
}

function isPredicateOperator(operator: string): boolean {
    return ['equal', 'notequal', 'less', 'greater', 'multipleby'].includes(operator);
}

function flattenApplication(expression: Expression): Expression[] {
    if (!isApplicationExpression(expression)) return [expression];
    return [
        ...flattenApplication(expression.head),
        ...expression.arguments.flatMap(flattenApplication),
    ];
}

function expectInteger(value: RankValue): bigint {
    if (typeof value !== 'bigint') {
        throw new RankError(`expected integer, got ${typeName(value)}`);
    }
    return value;
}

function expectBoolean(value: RankValue): boolean {
    if (typeof value !== 'boolean') {
        throw new RankError(`expected boolean, got ${typeName(value)}`);
    }
    return value;
}

function equalValues(left: RankValue, right: RankValue): boolean {
    if (typeof left !== 'object' || typeof right !== 'object') {
        return left === right;
    }
    if (left.kind === 'label' && right.kind === 'label') {
        return left.name === right.name;
    }
    return left === right;
}

function typeName(value: RankValue): string {
    if (typeof value !== 'object') {
        return typeof value;
    }
    return value.kind;
}
