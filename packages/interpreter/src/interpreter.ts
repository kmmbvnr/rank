import {
    isApplicationExpression,
    isAssignmentStatement,
    isBinaryExpression,
    isBooleanLiteral,
    isExpressionStatement,
    isLabelLiteral,
    isNameExpression,
    isNumberLiteral,
    isParenthesizedExpression,
    isStringLiteral,
    isUnaryExpression,
    isUseStatement,
    type Expression,
    type Program,
} from 'rank-language';
import { RankError } from './errors.js';
import { parse } from './parser.js';
import {
    formatValue,
    isNativeFunction,
    isRankArray,
    type NativeFunction,
    type RankArray,
    type RankValue,
} from './value.js';

type Output = (text: string) => void;

export class Interpreter {
    readonly variables = new Map<string, RankValue>();
    readonly modules = new Set<string>();
    private readonly output: Output;

    constructor(output: Output = console.log) {
        this.output = output;
    }

    execute(source: string): RankValue | undefined {
        return this.executeProgram(parse(source));
    }

    executeProgram(program: Program): RankValue | undefined {
        let result: RankValue | undefined;

        for (const statement of program.statements) {
            if (isUseStatement(statement)) {
                this.use(statement.module);
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
                this.variables.set(statement.name, result);
            } else if (isExpressionStatement(statement)) {
                result = this.evaluate(statement.value);
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
            const values = [
                this.evaluate(expression.head),
                ...expression.arguments.map(argument => this.evaluate(argument)),
            ];
            return this.apply(values);
        }
        throw new RankError(`cannot evaluate ${expression.$type}`);
    }

    private use(module: string): void {
        if (!(module in modules)) {
            throw new RankError(`unknown module: ${module}`);
        }
        this.modules.add(module);
    }

    private resolve(name: string): RankValue {
        const variable = this.variables.get(name);
        if (variable !== undefined) {
            return variable;
        }

        for (const module of this.modules) {
            const fn = modules[module]?.[name];
            if (fn) {
                return fn(this.output);
            }
        }

        throw new RankError(`unknown name: ${name}`);
    }

    private resolveVariable(name: string): RankValue {
        const value = this.variables.get(name);
        if (value === undefined) {
            throw new RankError(`unknown variable: ${name}`);
        }
        return value;
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
        const receivers = values.slice(0, functionIndex);
        const arguments_ = functionIndex === 0
            ? values.slice(1)
            : [
                receivers.length === 1 ? receivers[0] : applySelectors(receivers),
                ...values.slice(functionIndex + 1),
            ];
        return fn.call(arguments_);
    }

    private evaluateUnary(operator: string, value: RankValue): RankValue {
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
            this.requireModule('ranges', operator);
            return makeRange(expectInteger(left), expectInteger(right), operator === 'to');
        }
        if (isRankArray(left) || isRankArray(right)) {
            return mapBinary(left, right, (a, b) => this.evaluateBinary(operator, a, b));
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

    private requireModule(module: string, operation: string): void {
        if (!this.modules.has(module)) {
            throw new RankError(`${operation} requires: use ${module}`);
        }
    }
}

type ModuleFactory = Record<string, (output: Output) => NativeFunction>;

const modules: Record<string, ModuleFactory> = {
    io: {
        print: output => native('print', 1, arguments_ => {
            output(formatValue(arguments_[0]));
            return arguments_[0];
        }),
    },
    numbers: {
        sum: () => native('sum', 1, arguments_ => {
            const value = arguments_[0];
            const items = isRankArray(value) ? value.items : [value];
            return items.reduce<bigint>((total, item) => total + expectInteger(item), 0n);
        }),
        odd: () => native('odd', 1, arguments_ => mapValue(arguments_[0], value => expectInteger(value) % 2n !== 0n)),
        even: () => native('even', 1, arguments_ => mapValue(arguments_[0], value => expectInteger(value) % 2n === 0n)),
    },
    ranges: {},
};

function native(name: string, arity: number, call: (arguments_: RankValue[]) => RankValue): NativeFunction {
    return {
        kind: 'function',
        name,
        call(arguments_) {
            if (arguments_.length !== arity) {
                throw new RankError(`${name} expects ${arity} argument, got ${arguments_.length}`);
            }
            return call(arguments_);
        },
    };
}

function array(items: RankValue[]): RankArray {
    return { kind: 'array', items, shape: [items.length] };
}

function makeRange(start: bigint, end: bigint, inclusive: boolean): RankArray {
    const step = start <= end ? 1n : -1n;
    const stop = inclusive ? end + step : end;
    const items: RankValue[] = [];
    for (let value = start; value !== stop; value += step) {
        items.push(value);
    }
    return array(items);
}

function mapValue(value: RankValue, operation: (scalar: RankValue) => RankValue): RankValue {
    return isRankArray(value) ? array(value.items.map(operation)) : operation(value);
}

function applySelectors(values: RankValue[]): RankValue {
    if (values.length !== 2 || !isRankArray(values[0]) || !isRankArray(values[1])) {
        throw new RankError('value application requires an array and one selector');
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

function assignmentOperator(operator: string): string {
    return operator.slice(0, -1);
}

function mapBinary(
    left: RankValue,
    right: RankValue,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankArray {
    if (isRankArray(left) && isRankArray(right)) {
        if (left.items.length !== right.items.length) {
            throw new RankError(`shape mismatch: ${left.shape} and ${right.shape}`);
        }
        return array(left.items.map((item, index) => operation(item, right.items[index])));
    }
    const source = isRankArray(left) ? left : right as RankArray;
    return array(source.items.map(item => isRankArray(left) ? operation(item, right) : operation(left, item)));
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
