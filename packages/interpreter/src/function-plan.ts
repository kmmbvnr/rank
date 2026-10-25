import {
    inferCompiledExpression, flattenApplication, isNameExpression, isNumberLiteral, isBinaryExpression, isUnaryExpression,
    matchCompiledOperatorSignature,
    type Expression, type CompiledExpression, type CompiledScalarType, type CompiledFunctionType,
    type CompiledOperator,
} from '@arrrank/language';

export interface FunctionPlanDomain { readonly element: CompiledScalarType; readonly rank: 0 | 1 }
interface PlanInput {
    readonly name?: string;
    readonly stage?: FunctionPlan;
    readonly conversion?: 'integer0' | 'text';
    readonly operand?: FunctionPlan;
    readonly power?: readonly [FunctionPlan, FunctionPlan];
    readonly negative?: boolean;
}
export type FunctionPlan = CompiledExpression<FunctionPlanDomain, PlanInput>;
export type FunctionPlanTerminal = 'copy' | 'sum';
export interface FunctionPlanConsumer { readonly stage: FunctionPlan; readonly terminal: FunctionPlanTerminal }
const expansionSizes = new WeakMap<FunctionPlan, number>();
const expansionBudget = 512;

function expansionSize(plan: FunctionPlan): number {
    const known = expansionSizes.get(plan);
    if (known !== undefined) return known;
    const children = plan.kind === 'input' ? [plan.input.stage, plan.input.operand, ...plan.input.power ?? []].filter((node): node is FunctionPlan => !!node)
        : plan.kind === 'group' || plan.kind === 'unary' ? [plan.operand]
            : plan.kind === 'binary' ? [plan.left, plan.right] : [];
    const size = Math.min(expansionBudget + 1, 1 + children.reduce((size, node) => size + expansionSize(node), 0));
    expansionSizes.set(plan, size);
    return size;
}

/** A consumed helper has returned before its plan can fail. Its generated
 * consumer must not add that discarded helper frame to the demand error. */
export class FunctionPlanDemandError {
    constructor(readonly error: unknown) {}
}

export function functionPlanType(plan: FunctionPlan): CompiledFunctionType {
    return plan.type.rank ? { kind: 'array', element: plan.type.element, rank: 1 } : plan.type.element;
}

/** Retain captured stored arrays at the binding boundary, even when no recipe
 * object survives. Later writes through aliases must still use copy-on-write. */
export function functionPlanArrays(plan: FunctionPlan, names = new Set<string>(), seen = new Set<FunctionPlan>()): ReadonlySet<string> {
    if (seen.has(plan)) return names;
    seen.add(plan);
    if (plan.kind === 'input') {
        if (plan.input.name && plan.type.rank) names.add(plan.input.name);
        if (plan.input.stage) functionPlanArrays(plan.input.stage, names, seen);
        if (plan.input.operand) functionPlanArrays(plan.input.operand, names, seen);
        for (const node of plan.input.power ?? []) functionPlanArrays(node, names, seen);
    } else if (plan.kind === 'group' || plan.kind === 'unary') functionPlanArrays(plan.operand, names, seen);
    else if (plan.kind === 'binary') { functionPlanArrays(plan.left, names, seen); functionPlanArrays(plan.right, names, seen); }
    return names;
}

/** Pure scalar/vector recipes. Inputs are captured by immutable local slots;
 * unsupported callbacks and layouts never acquire this capability. */
export function proveFunctionPlan(expression: Expression, host: {
    input(name: string): FunctionPlanDomain | undefined;
    stage(name: string): FunctionPlan | undefined;
    builtin(name: string): boolean;
    nonnegative(expression: Expression): boolean;
    capture(name: string): void;
    readonly budget: { remaining: number };
}): FunctionPlan | undefined {
    const parse = (source: Expression): FunctionPlan | undefined => {
        const result = inferCompiledExpression<FunctionPlanDomain, PlanInput>(source, {
            atom: type => ['integer', 'real', 'boolean', 'text'].includes(type)
                ? { element: type as CompiledScalarType, rank: 0 } : undefined,
            read: source => {
                if (isNameExpression(source)) {
                    const stage = host.stage(source.name);
                    if (stage) { host.capture(source.name); return { type: stage.type, input: { stage } }; }
                    const domain = host.input(source.name);
                    if (domain) { host.capture(source.name); return { type: domain, input: { name: source.name } }; }
                }
                if (isBinaryExpression(source) && source.operator === '**') {
                    const signed = isUnaryExpression(source.left) && ['+', '-'].includes(source.left.operator) ? source.left : undefined;
                    const left = parse(signed?.operand ?? source.left), right = parse(source.right);
                    if (left?.type.element === 'integer' && right?.type.element === 'integer'
                        && right.type.rank === 0 && host.nonnegative(source.right)) {
                        return { type: left.type, input: { power: [left, right], negative: signed?.operator === '-' } };
                    }
                    return undefined;
                }
                const parts = flattenApplication(source);
                if (parts.length === 4 && isNameExpression(parts[1]) && parts[1].name === 'integer'
                    && isNameExpression(parts[2]) && parts[2].name === 'rank'
                    && isNumberLiteral(parts[3]) && parts[3].value === 0n && host.builtin('integer')) {
                    const operand = parse(parts[0]);
                    if (operand?.type.element === 'text' && operand.type.rank === 0) return {
                        type: { element: 'integer', rank: 1 }, input: { conversion: 'integer0', operand },
                    };
                }
                if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'text' && host.builtin('text')) {
                    const operand = parse(parts[0]);
                    if (operand?.type.rank === 0) return {
                        type: { element: 'text', rank: 0 }, input: { conversion: 'text', operand },
                    };
                }
                return undefined;
            },
            isBound: name => !!host.input(name) || !!host.stage(name),
            operator: (operation, inputs) => {
                // Short-circuit scalar plans and broader tensor domains retain
                // their ordinary demand path until their control flow is lowered.
                if (!['+', '-', '*', '/', '//', 'mod', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal'].includes(operation.name)) return undefined;
                const signature = matchCompiledOperatorSignature(operation.scalarFunction, inputs.map(input => input.element));
                return signature ? { inputs, result: { element: signature.result,
                    rank: inputs.some(input => input.rank) ? 1 : 0 } } : undefined;
            },
            budget: host.budget,
        });
        return result.expression;
    };
    const result = parse(expression);
    // Shared stages form a DAG, but naive emission expands each reference.
    // Bound the expanded tree before handing it to code generation.
    return result && expansionSize(result) <= expansionBudget ? result : undefined;
}

interface PlanEmitter {
    variable(): string;
    slot(name: string): string;
    locate(expression: Expression, lines: string[]): void;
    binary(operation: CompiledOperator, left: string, right: string, lines: string[], type: CompiledScalarType): string;
}
interface PreparedPlan { readonly size?: string; read(index: string, lines: string[]): string }

/** Emit a consumer directly in the scalar function. Preparation evaluates scalar
 * operands at demand; vector cells stream through the consumer in source order. */
export function emitFunctionPlan(consumer: FunctionPlanConsumer, lines: string[], host: PlanEmitter): string {
    function prepare(node: FunctionPlan): PreparedPlan {
        if (node.kind === 'group') return prepare(node.operand);
        if (node.kind === 'literal') {
            const code = typeof node.value === 'bigint' ? `${node.value}n`
                : typeof node.value === 'number' && Object.is(node.value, -0) ? '-0' : JSON.stringify(node.value);
            return { read: () => code };
        }
        if (node.kind === 'input') {
            if (node.input.stage) return prepare(node.input.stage);
            if (node.input.name) {
                const slot = host.slot(node.input.name);
                return node.type.rank ? { size: `${slot}.shape[0]`, read: (index, body) => {
                    const value = host.variable();
                    host.locate(node.source, body);
                    body.push(`const ${value} = readArrayItem(${slot}, ${index});`);
                    return value;
                } } : { read: () => slot };
            }
            if (node.input.power) {
                const [left, right] = node.input.power.map(prepare);
                const exponent = right.read('0', lines);
                const read = (index: string, body: string[]) => {
                    const base = left.read(index, body), value = host.variable();
                    host.locate(node.source, body);
                    body.push(`const ${value} = ${node.input.negative ? '-' : ''}((${base}) ** (${exponent}));`);
                    return value;
                };
                if (left.size) return { size: left.size, read };
                const scalar = read('0', lines);
                return { read: () => scalar };
            }
            const operand = prepare(node.input.operand!);
            const value = operand.read('0', lines), converted = host.variable();
            host.locate(node.source, lines);
            if (node.input.conversion === 'text') {
                lines.push(`const ${converted} = formatValue(${value});`);
                return { read: () => converted };
            }
            lines.push(`const ${converted} = textPoints(${value});`);
            return { size: `${converted}.length`, read: (index, body) => {
                const result = host.variable();
                host.locate(node.source, body);
                body.push(`const ${result} = integerValue(${converted}[${index}]);`);
                return result;
            } };
        }
        if (node.kind === 'unary') {
            const operand = prepare(node.operand);
            const read = (index: string, body: string[]) => {
                const value = operand.read(index, body), result = host.variable();
                host.locate(node.source, body);
                body.push(`const ${result} = ${node.operation.unary}(${value});`);
                return result;
            };
            if (operand.size) return { size: operand.size, read };
            const value = read('0', lines);
            return { read: () => value };
        }
        if (node.kind !== 'binary') throw Error('unproved function plan');
        const left = prepare(node.left), right = prepare(node.right);
        let size = left.size ?? right.size;
        if (left.size && right.size) {
            size = host.variable();
            host.locate(node.source, lines);
            lines.push(`const ${size} = broadcastShape([${left.size}], [${right.size}])[0];`);
        }
        const read = (index: string, body: string[]) => {
            const a = left.read(left.size && right.size ? `(${left.size} === 1 ? 0 : ${index})` : index, body);
            const b = right.read(left.size && right.size ? `(${right.size} === 1 ? 0 : ${index})` : index, body);
            host.locate(node.source, body);
            return host.binary(node.operation, a, b, body, node.type.element);
        };
        if (size) return { size, read };
        const scalar = read('0', lines);
        return { read: () => scalar };
    }
    const source = prepare(consumer.stage);
    if (!source.size) return source.read('0', lines);
    const result = host.variable(), index = host.variable();
    lines.push(`let ${result} = ${consumer.terminal === 'copy' ? '[]' : '0n'};`);
    const body: string[] = [];
    const value = source.read(index, body);
    body.push(consumer.terminal === 'copy' ? `${result}.push(${value});`
        : `${result} = typeof ${result} === 'bigint' && typeof ${value} === 'bigint' ? ${result} + ${value} : Number(${result}) + Number(${value});`);
    lines.push(`for (let ${index} = 0; ${index} < ${source.size}; ${index}++) { checkpoint('consuming function plan'); ${body.join('\n')} }`);
    lines.push('planConsumed?.();');
    return consumer.terminal === 'copy' ? `ownedArray(${result}, [${source.size}], true)` : result;
}
