import {
    inferCompiledExpression, flattenApplication, isNameExpression, isNumberLiteral, isBinaryExpression, isUnaryExpression, isArrayExpression, isLabelLiteral, findCompiledOperator, applicationForm, findOperation,
    matchCompiledOperatorSignature,
    type Expression, type CompiledExpression, type CompiledScalarType, type CompiledFunctionType,
    type CompiledOperator, type ApplicationExpression,
} from '@arrrank/language';

export interface FunctionPlanDomain { readonly element: CompiledScalarType; readonly rank: 0 | 1 | 2 }
interface PlanInput {
    readonly vector?: readonly FunctionPlan[];
    readonly map?: { readonly key: number; readonly operand: FunctionPlan };
    readonly outer?: { readonly operation: CompiledOperator; readonly left: FunctionPlan; readonly right: FunctionPlan };
    readonly reduction?: { readonly name: 'count' | 'sum' | 'min' | 'max'; readonly operand: FunctionPlan; readonly rows: boolean };
    readonly native?: { readonly name: 'sort' | 'argsort' | 'unique'; readonly operand: FunctionPlan; readonly descending: boolean };
    readonly length?: FunctionPlan;
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
    const children = plan.kind === 'input' ? [plan.input.stage, plan.input.operand, ...plan.input.power ?? [], ...plan.input.vector ?? [], plan.input.map?.operand,
        plan.input.outer?.left, plan.input.outer?.right, plan.input.reduction?.operand, plan.input.native?.operand, plan.input.length].filter((node): node is FunctionPlan => !!node)
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
    return plan.type.rank ? { kind: 'array', element: plan.type.element, rank: plan.type.rank } : plan.type.element;
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
        for (const node of [...plan.input.power ?? [], ...plan.input.vector ?? [], plan.input.map?.operand,
            plan.input.outer?.left, plan.input.outer?.right, plan.input.reduction?.operand, plan.input.native?.operand, plan.input.length]) {
            if (node) functionPlanArrays(node, names, seen);
        }
    } else if (plan.kind === 'group' || plan.kind === 'unary') functionPlanArrays(plan.operand, names, seen);
    else if (plan.kind === 'binary') { functionPlanArrays(plan.left, names, seen); functionPlanArrays(plan.right, names, seen); }
    return names;
}

/** New callback snapshots belong to this construction, not referenced stages. */
export function functionPlanCallbacks(plan: FunctionPlan, keys = new Set<number>()): ReadonlySet<number> {
    if (plan.kind === 'input') {
        if (plan.input.stage) return keys;
        if (plan.input.map) keys.add(plan.input.map.key);
        for (const node of [plan.input.operand, ...plan.input.power ?? [], ...plan.input.vector ?? [], plan.input.map?.operand,
            plan.input.outer?.left, plan.input.outer?.right, plan.input.reduction?.operand, plan.input.native?.operand, plan.input.length]) {
            if (node) functionPlanCallbacks(node, keys);
        }
    } else if (plan.kind === 'group' || plan.kind === 'unary') functionPlanCallbacks(plan.operand, keys);
    else if (plan.kind === 'binary') { functionPlanCallbacks(plan.left, keys); functionPlanCallbacks(plan.right, keys); }
    return keys;
}

/** Pure scalar/vector recipes. Inputs are captured by immutable local slots;
 * unsupported callbacks and layouts never acquire this capability. */
export function proveFunctionPlan(expression: Expression, host: {
    input(name: string): FunctionPlanDomain | undefined;
    stage(name: string): FunctionPlan | undefined;
    builtin(name: string): boolean;
    nonnegative(expression: Expression): boolean;
    capture(name: string): void;
    operator?(name: string): boolean;
    callback?(name: string, element: CompiledScalarType): { readonly key: number; readonly element: CompiledScalarType } | undefined;
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
                if (isArrayExpression(source) && source.items.length && !source.dimensions.length
                    && !source.fill && !source.rows.length && !source.range && source.items.every(item => !item.sign)) {
                    const vector = source.items.map(item => parse(item.value));
                    if (vector.every((item): item is FunctionPlan => !!item && item.type.rank === 0)
                        && vector.every(item => item.type.element === vector[0].type.element)) {
                        return { type: { element: vector[0].type.element, rank: 1 }, input: { vector } };
                    }
                }
                const parts = flattenApplication(source);
                if (parts.length === 4 && isNameExpression(parts[1]) && isNameExpression(parts[2])
                    && parts[2].name === 'rank' && isNumberLiteral(parts[3]) && parts[3].value === 0n) {
                    const operand = parse(parts[0]);
                    const callback = operand?.type.rank === 1 ? host.callback?.(parts[1].name, operand.type.element) : undefined;
                    if (operand && callback) return { type: { element: callback.element, rank: 1 },
                        input: { map: { key: callback.key, operand } } };
                }
                const outer = applicationForm(source, name => host.input(name) || host.stage(name) ? false : findOperation(name));
                if (outer.kind === 'outer' && outer.operands.length === 2 && (host.operator?.(outer.operator) ?? true)) {
                    const left = parse(outer.operands[0]), right = parse(outer.operands[1]);
                    const operation = findCompiledOperator(outer.operator);
                    const signature = operation && left && right && matchCompiledOperatorSignature(operation.scalarFunction, [left.type.element, right.type.element]);
                    if (operation && signature && left?.type.rank === 1 && right?.type.rank === 1
                        && !['and', 'or', '**'].includes(operation.name)) return { type: { element: signature.result, rank: 2 },
                        input: { outer: { operation, left, right } } };
                }
                const tail = parts.at(-1);
                const rows = parts.length === 4 && isNameExpression(parts[2]) && parts[2].name === 'rank'
                    && isNumberLiteral(parts[3]) && parts[3].value === 1n;
                const reduction = rows ? parts[1] : parts.length === 2 ? tail : undefined;
                if (reduction && isNameExpression(reduction) && ['count', 'sum', 'min', 'max'].includes(reduction.name)
                    && host.builtin(reduction.name)) {
                    const operand = parse(parts[0]), name = reduction.name as 'count' | 'sum' | 'min' | 'max';
                    if (operand?.type.rank === (rows ? 2 : 1)
                        && (name === 'count' ? operand.type.element === 'boolean' : operand.type.element === 'integer')) {
                        return { type: { element: 'integer', rank: rows ? 1 : 0 }, input: { reduction: { name, operand, rows } } };
                    }
                }
                if (parts.length >= 2 && isNameExpression(tail) && tail.name === 'len' && host.builtin('len')) {
                    const operand = parse(parts.length === 2 ? parts[0] : { $type: 'ApplicationExpression', head: parts[0], arguments: parts.slice(1, -1) } as ApplicationExpression);
                    let producer = operand;
                    while (producer?.kind === 'group') producer = producer.operand;
                    // Broader metadata-only demands retain the reference path.
                    if (operand?.type.rank === 1 && producer?.kind === 'input' && producer.input.native) {
                        return { type: { element: 'integer', rank: 0 }, input: { length: operand } };
                    }
                }
                if ((parts.length === 2 || parts.length === 3 && isLabelLiteral(tail)) && isNameExpression(parts[1])
                    && ['sort', 'argsort', 'unique'].includes(parts[1].name) && host.builtin(parts[1].name)) {
                    const name = parts[1].name as 'sort' | 'argsort' | 'unique';
                    const operand = parse(parts[0]);
                    if (operand?.type.rank === 1 && (parts.length === 2 || name !== 'unique' && isLabelLiteral(tail)
                        && ['ascending', 'descending'].includes(tail.name))) {
                        return { type: { element: name === 'argsort' ? 'integer' : operand.type.element, rank: 1 },
                            input: { native: { name, operand, descending: isLabelLiteral(tail) && tail.name === 'descending' } } };
                    }
                }
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
                if (inputs.some(input => input.rank === 2)) return undefined;
                const signature = matchCompiledOperatorSignature(operation.scalarFunction, inputs.map(input => input.element));
                return signature ? { inputs, result: { element: signature.result,
                    rank: inputs.some(input => input.rank) ? 1 : 0 } } : undefined;
            },
            call: () => undefined,
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
    locate(expression: Expression, lines: string[], demandLocation: string): void;
    capture(key: number, lines: string[]): void;
    callback(key: number, value: string, lines: string[]): string;
    binary(operation: CompiledOperator, left: string, right: string, lines: string[], type: CompiledScalarType, inputs?: readonly CompiledScalarType[]): string;
}
interface PreparedPlan { readonly value?: string; readonly shape?: string; readonly rows?: string; readonly columns?: string; readonly size?: string; read(index: string, lines: string[]): string }

/** Emit a consumer directly in the scalar function. Preparation evaluates scalar
 * operands at demand; vector cells stream through the consumer in source order. */
export function emitFunctionPlan(consumer: FunctionPlanConsumer, lines: string[], host: PlanEmitter): string {
    for (const key of functionPlanCallbacks(consumer.stage)) host.capture(key, lines);
    const demandLocation = host.variable();
    lines.push(`const ${demandLocation} = location;`);
    function prepare(node: FunctionPlan): PreparedPlan {
        if (node.kind === 'group') return prepare(node.operand);
        if (node.kind === 'literal') {
            const code = typeof node.value === 'bigint' ? `${node.value}n`
                : typeof node.value === 'number' && Object.is(node.value, -0) ? '-0' : JSON.stringify(node.value);
            return { read: () => code };
        }
        if (node.kind === 'input') {
            if (node.input.stage) return prepare(node.input.stage);
            if (node.input.vector) {
                const values = node.input.vector.map(prepare).map(item => item.read('0', lines));
                const array = host.variable();
                lines.push(`const ${array} = [${values.join(',')}];`);
                return { size: String(values.length), read: index => `${array}[${index}]` };
            }
            if (node.input.map) {
                const map = node.input.map, operand = prepare(map.operand);
                return { size: operand.size, read: (index, body) => {
                    const value = operand.read(index, body);
                    host.locate(node.source, body, demandLocation);
                    return host.callback(map.key, value, body);
                } };
            }
            if (node.input.outer) {
                const { operation, left: a, right: b } = node.input.outer;
                const left = prepare(a), right = prepare(b);
                return { size: `(${left.size} * ${right.size})`, shape: `[${left.size}, ${right.size}]`, rows: left.size, columns: right.size,
                    read: (index, body) => {
                        const x = left.read(`Math.floor((${index}) / ${right.size})`, body), y = right.read(`((${index}) % ${right.size})`, body);
                        host.locate(node.source, body, demandLocation);
                        return host.binary(operation, x, y, body, node.type.element, [a.type.element, b.type.element]);
                    } };
            }
            if (node.input.reduction) {
                const { name, operand, rows } = node.input.reduction, input = prepare(operand);
                const read = (row: string, body: string[]) => {
                    const result = host.variable(), index = host.variable();
                    body.push(`let ${result} = 0n;`);
                    const size = rows ? input.columns! : input.size!;
                    host.locate(node.source, body, demandLocation);
                    if (name === 'min' || name === 'max') body.push(`location = ${demandLocation}; if (${size} === 0) throw new RankError('${name} requires at least one value', 'EmptyReduction');`);
                    const loop: string[] = [];
                    const value = input.read(rows ? `((${row}) * ${size} + ${index})` : index, loop);
                    loop.push(name === 'count' ? `if (${value}) ${result}++;` : name === 'sum' ? `${result} += ${value};`
                        : `if (${index} === 0 || ${value} ${name === 'min' ? '<' : '>'} ${result}) ${result} = ${value};`);
                    body.push(`for (let ${index} = 0; ${index} < ${size}; ${index}++) { checkpoint('reducing function plan'); ${loop.join('\n')} }`);
                    return result;
                };
                if (rows) return { size: input.rows, read };
                const result = read('0', lines);
                return { read: () => result };
            }
            if (node.input.native) {
                const { name, operand, descending } = node.input.native;
                const source = prepare(operand), array = complete(source), result = host.variable();
                lines.push(`location = ${demandLocation};`);
                lines.push(`const ${result} = ${name === 'sort' ? 'sortValue' : name === 'argsort' ? 'argsortValue' : 'uniqueValue'}(${array}, ${descending});`);
                return { value: result, size: `${result}.shape[0]`, read: (index, body) => {
                    const value = host.variable(); body.push(`const ${value} = readArrayItem(${result}, ${index});`); return value;
                } };
            }
            if (node.input.length) {
                const operand = prepare(node.input.length), result = host.variable();
                lines.push(`const ${result} = BigInt(${operand.size});`);
                return { read: () => result };
            }
            if (node.input.name) {
                const slot = host.slot(node.input.name);
                return node.type.rank ? { value: slot, size: node.type.rank === 2 ? `(${slot}.shape[0] * ${slot}.shape[1])` : `${slot}.shape[0]`,
                    shape: node.type.rank === 2 ? `${slot}.shape` : undefined,
                    rows: node.type.rank === 2 ? `${slot}.shape[0]` : undefined,
                    columns: node.type.rank === 2 ? `${slot}.shape[1]` : undefined, read: (index, body) => {
                    const value = host.variable();
                    host.locate(node.source, body, demandLocation);
                    body.push(`const ${value} = readArrayItem(${slot}, ${index});`);
                    return value;
                } } : { read: () => slot };
            }
            if (node.input.power) {
                const [left, right] = node.input.power.map(prepare);
                const exponent = right.read('0', lines);
                const read = (index: string, body: string[]) => {
                    const base = left.read(index, body), value = host.variable();
                    host.locate(node.source, body, demandLocation);
                    body.push(`const ${value} = ${node.input.negative ? '-' : ''}((${base}) ** (${exponent}));`);
                    return value;
                };
                if (left.size) return { size: left.size, read };
                const scalar = read('0', lines);
                return { read: () => scalar };
            }
            const operand = prepare(node.input.operand!);
            const value = operand.read('0', lines), converted = host.variable();
            host.locate(node.source, lines, demandLocation);
            if (node.input.conversion === 'text') {
                lines.push(`const ${converted} = formatValue(${value});`);
                return { read: () => converted };
            }
            lines.push(`const ${converted} = textPoints(${value});`);
            return { size: `${converted}.length`, read: (index, body) => {
                const result = host.variable();
                host.locate(node.source, body, demandLocation);
                body.push(`const ${result} = integerValue(${converted}[${index}]);`);
                return result;
            } };
        }
        if (node.kind === 'unary') {
            const operand = prepare(node.operand);
            const read = (index: string, body: string[]) => {
                const value = operand.read(index, body), result = host.variable();
                host.locate(node.source, body, demandLocation);
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
            host.locate(node.source, lines, demandLocation);
            lines.push(`const ${size} = broadcastShape([${left.size}], [${right.size}])[0];`);
        }
        const read = (index: string, body: string[]) => {
            const a = left.read(left.size && right.size ? `(${left.size} === 1 ? 0 : ${index})` : index, body);
            const b = right.read(left.size && right.size ? `(${right.size} === 1 ? 0 : ${index})` : index, body);
            host.locate(node.source, body, demandLocation);
            return host.binary(node.operation, a, b, body, node.type.element, [node.left.type.element, node.right.type.element]);
        };
        if (size) return { size, read };
        const scalar = read('0', lines);
        return { read: () => scalar };
    }
    function complete(source: PreparedPlan): string {
        if (source.value) return source.value;
        if (!source.size) return source.read('0', lines);
        const result = host.variable(), index = host.variable(), body: string[] = [];
        const value = source.read(index, body);
        body.push(`${result}.push(${value});`);
        lines.push(`const ${result} = []; for (let ${index} = 0; ${index} < ${source.size}; ${index}++) { checkpoint('consuming function plan'); ${body.join('\n')} }`);
        return `ownedArray(${result}, ${source.shape ?? `[${source.size}]`}, true)`;
    }
    const source = prepare(consumer.stage);
    if (consumer.terminal === 'copy' && source.value) { lines.push('planConsumed?.();'); return source.value; }
    if (!source.size) return source.read('0', lines);
    const result = host.variable(), index = host.variable();
    lines.push(`let ${result} = ${consumer.terminal === 'copy' ? '[]' : '0n'};`);
    const body: string[] = [];
    const value = source.read(index, body);
    body.push(consumer.terminal === 'copy' ? `${result}.push(${value});`
        : `${result} = typeof ${result} === 'bigint' && typeof ${value} === 'bigint' ? ${result} + ${value} : Number(${result}) + Number(${value});`);
    lines.push(`for (let ${index} = 0; ${index} < ${source.size}; ${index}++) { checkpoint('consuming function plan'); ${body.join('\n')} }`);
    lines.push('planConsumed?.();');
    return consumer.terminal === 'copy' ? `ownedArray(${result}, ${source.shape ?? `[${source.size}]`}, true)` : result;
}
