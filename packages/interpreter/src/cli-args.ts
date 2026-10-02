import {
    isArgumentStatement, isFlagStatement, isOptionStatement, isUseStatement,
    type Expression, type Program, type Statement,
} from '@arrrank/language';
import { ownedArray } from './array-storage.js';
import { RankError } from './errors.js';
import { isRankArray, typeName, type RankValue } from './value.js';

export interface ParsedArguments {
    readonly options: Map<string, string[]>;
    readonly positionals: string[];
}

export function parseArguments(args: readonly string[]): ParsedArguments {
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

export function inputValues(values: string[], valueType: string, many: boolean): RankValue {
    const converted = values.map(value => parseInputValue(valueType, value));
    return many ? ownedArray(converted) : converted.at(-1)!;
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

export function validateInputValue(name: string, valueType: string, value: RankValue): void {
    if (valueType === 'integer' && typeof value === 'bigint') return;
    if (valueType === 'real' && typeof value === 'number') return;
    if ((valueType === 'text' || valueType === 'path') && typeof value === 'string') return;
    if (valueType === 'boolean' && typeof value === 'boolean') return;
    if (!['integer', 'real', 'text', 'path', 'boolean'].includes(valueType)) {
        throw new RankError(`unknown input type: ${valueType}`);
    }
    throw new RankError(`${name} expects ${valueType}, got ${typeName(value)}`);
}

export function kebabCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function inputDeclarationName(statement: Statement): string {
    return isOptionStatement(statement) ? 'option' : isArgumentStatement(statement) ? 'argument' : 'flag';
}

/** What binding command-line inputs needs from the interpreter. */
export interface InputHost {
    readonly variables: Map<string, RankValue>;
    readonly modules: ReadonlySet<string>;
    evaluate(expression: Expression): RankValue;
    locate(error: unknown, node: Statement): unknown;
}

/**
 * Binds the program's `option`, `argument` and `flag` declarations from the
 * command line before it runs. A value the host already bound is validated
 * instead; defaults are evaluated in declaration order.
 */
export function bindInputs(program: Program, args: readonly string[], host: InputHost): void {
    const declarations = program.statements.filter(statement =>
        isOptionStatement(statement) || isArgumentStatement(statement) || isFlagStatement(statement));
    if (declarations.length === 0) {
        if (args.length > 0) throw new RankError(`unexpected arguments: ${args.join(' ')}`);
        return;
    }

    if (!host.modules.has('cli') && !program.statements.some(statement =>
        isUseStatement(statement) && statement.module === 'cli')) {
        throw host.locate(new RankError(`${inputDeclarationName(declarations[0])} requires: use cli`), declarations[0]);
    }

    const parsed = parseArguments(args);
    let positionalIndex = 0;
    const knownOptions = new Set<string>();
    for (const declaration of declarations) {
        if (isOptionStatement(declaration)) {
            const optionName = kebabCase(declaration.name);
            knownOptions.add(optionName);
            const supplied = parsed.options.get(optionName);
            if (host.variables.has(declaration.name)) {
                validateInput(host.variables, declaration.name, declaration.valueType, declaration.many);
            } else if (supplied) {
                host.variables.set(
                    declaration.name,
                    inputValues(supplied, declaration.valueType, declaration.many),
                );
            } else if (declaration.defaultValue) {
                host.variables.set(declaration.name, host.evaluate(declaration.defaultValue));
                validateInput(host.variables, declaration.name, declaration.valueType, declaration.many);
            } else {
                throw new RankError(`missing option: --${optionName}`);
            }
        } else if (isArgumentStatement(declaration)) {
            if (host.variables.has(declaration.name)) {
                validateInput(host.variables, declaration.name, declaration.valueType, declaration.many);
                continue;
            }
            const values = declaration.many
                ? parsed.positionals.slice(positionalIndex)
                : parsed.positionals.slice(positionalIndex, positionalIndex + 1);
            positionalIndex += values.length;
            if (values.length > 0) {
                host.variables.set(
                    declaration.name,
                    inputValues(values, declaration.valueType, declaration.many),
                );
            } else if (declaration.defaultValue) {
                host.variables.set(declaration.name, host.evaluate(declaration.defaultValue));
                validateInput(host.variables, declaration.name, declaration.valueType, declaration.many);
            } else {
                throw new RankError(`missing argument: ${declaration.name}`);
            }
        } else {
            const optionName = kebabCase(declaration.name);
            knownOptions.add(optionName);
            const supplied = parsed.options.get(optionName);
            if (host.variables.has(declaration.name)) {
                validateInput(host.variables, declaration.name, 'boolean', false);
            } else if (supplied) {
                host.variables.set(declaration.name, true);
            } else {
                host.variables.set(declaration.name, declaration.defaultValue ?? false);
            }
        }
    }

    const unknown = [...parsed.options.keys()].filter(name => !knownOptions.has(name));
    if (unknown.length > 0) throw new RankError(`unknown option: --${unknown[0]}`);
    if (positionalIndex < parsed.positionals.length) {
        throw new RankError(`unexpected argument: ${parsed.positionals[positionalIndex]}`);
    }
}

function validateInput(variables: ReadonlyMap<string, RankValue>, name: string, valueType: string, many: boolean): void {
    const value = variables.get(name)!;
    const values = many && isRankArray(value) ? value.items : [value];
    if (many && !isRankArray(value)) {
        throw new RankError(`${name} expects multiple ${valueType} values`);
    }
    for (const item of values) validateInputValue(name, valueType, item);
}
