import { ramModel, type RamNode } from './ram-model.js';
import { isApplicationExpression, isNameExpression, isOptionStatement, isReturnStatement,
    isUseStatement, isParenthesizedExpression, isBinaryExpression, isArrayExpression,
    isNumberLiteral, isUnaryExpression, type Expression, type Program, type Statement } from '@arrrank/language';
import { parse } from './parser.js';
import { RankError } from './errors.js';
import { native } from './modules/shared.js';
import { ownedArray } from './array-storage.js';
import { isRankArray, type NativeFunction } from './value.js';

export interface RamGraph {
    readonly precision: 'f16' | 'f32';
    readonly shape: readonly number[];
    readonly nodes: readonly RamNode[];
    readonly outputShape: readonly number[];
    readonly output: number;
    readonly model: Uint8Array;
}
/** A synchronous host bridge. It must reject unavailable GPUs and partial delegation. */
export type RamGpu = (graph: RamGraph, input: readonly number[]) => readonly number[];
export interface RamModule { readonly name: string; readonly graph: RamGraph; readonly program: Program; readonly source: string }

/** Static tensor expressions with baked constants. */
export function compileRam(source: string, id: string): RamModule {
    const ast = parse(source, id);
    const fail = (message: string, node?: Statement): never => {
        const error = new RankError(message, 'RamCompile');
        const start = node?.$cstNode?.range.start;
        error.location = { sourceId: id, line: (start?.line ?? 0) + 1,
            column: (start?.character ?? 0) + 1, sourceLine: source.split('\n')[start?.line ?? 0] ?? '' };
        throw error;
    };
    const body = ast.statements.filter(statement => !isUseStatement(statement));
    if (!ast.statements.some(statement => isUseStatement(statement) && statement.module === 'ml'))
        fail('RAM module requires use ml');
    for (const statement of ast.statements) {
        if (isUseStatement(statement) && (statement.module !== 'ml' || statement.path))
            fail('RAM MVP permits only use ml', statement);
    }
    const input = body[0], output = body.at(-1);
    if (!isOptionStatement(input) || input.defaultValue || !isReturnStatement(output))
        fail('RAM expects one runtime option, optional baked weights, and a final return', body[0]);
    if (!isOptionStatement(input) || !isReturnStatement(output)) throw new Error('unreachable');
    const precision = input.precision?.name;
    if (precision !== 'f16' && precision !== 'f32') fail('RAM input requires .f16 or .f32', input);
    const shape = input.dimensions.map(dimension => Number(dimension.value));
    const size = shape.reduce((a, b) => a * b, 1);
    if (!shape.length || shape.length > 4 || shape.some(n => !Number.isSafeInteger(n) || n < 1)
        || !Number.isSafeInteger(size) || size > 1_048_576)
        fail('RAM shape requires 1–4 positive dimensions and at most 1048576 elements', input);
    const nodes: RamNode[] = [{ kind: 'input', shape }];
    let constantSize = 0;
    const validShape = (dimensions: number[], statement: Statement): number => {
        const count = dimensions.reduce((a, b) => a * b, 1);
        if (!dimensions.length || dimensions.length > 4 || dimensions.some(n => !Number.isSafeInteger(n) || n < 1)
            || !Number.isSafeInteger(count) || count > 1_048_576)
            fail('RAM tensor requires 1–4 positive dimensions and at most 1048576 elements', statement);
        return count;
    };
    const names = new Map<string, number>([[input.name, 0]]);
    const scalar = (expression: Expression): number => {
        if (isParenthesizedExpression(expression)) return scalar(expression.value);
        if (isNumberLiteral(expression) && typeof expression.value === 'number') return expression.value;
        if (isUnaryExpression(expression) && (expression.operator === '-' || expression.operator === '+'))
            return (expression.operator === '-' ? -1 : 1) * scalar(expression.operand);
        return fail('Baked values must be real literals', input);
    };
    for (const weight of body.slice(1, -1)) {
        if (!isOptionStatement(weight) || !weight.defaultValue)
            fail('RAM permits only baked option declarations before return', weight);
        if (!isOptionStatement(weight) || !weight.defaultValue) throw new Error('unreachable');
        if (precision !== 'f32' || weight.precision?.name !== 'f32')
            fail('Baked arithmetic currently requires .f32 inputs and weights', weight);
        if (names.has(weight.name)) fail('Duplicate RAM option: ' + weight.name, weight);
        const shape = weight.dimensions.map(d => Number(d.value));
        const size = validShape(shape, weight);
        constantSize += size;
        if (constantSize > 8_388_608) fail('RAM constant storage exceeds 32 MiB', weight);
        let value = weight.defaultValue;
        while (isParenthesizedExpression(value)) value = value.value;
        if (!isArrayExpression(value)) fail('Baked weights require an array literal or array shape ... fill', weight);
        if (!isArrayExpression(value)) throw new Error('unreachable');
        let values: number[];
        if (value.dimensions.length) {
            if (value.dimensions.length !== shape.length || value.dimensions.some((d, i) =>
                !isNumberLiteral(d.value) || Number(d.value.value) * (d.sign === '-' ? -1 : 1) !== shape[i]))
                fail('Baked array shape does not match its option', weight);
        } else if (shape.length !== 1) fail('Baked matrix literals require an explicit shape', weight);
        if (value.fill) {
            values = Array(size).fill(scalar(value.fill));
        } else {
            if (value.range) fail('Baked array ranges are not supported', weight);
            values = [...value.items, ...value.rows.flatMap(row => row.items)]
                .map(item => (item.sign === '-' ? -1 : 1) * scalar(item.value));
            if (values.length !== size) fail('Baked array length does not match its option', weight);
        }
        values = values.map(value => ramRound(value, 'f32'));
        names.set(weight.name, nodes.length); nodes.push({ kind: 'constant', values, shape });
    }
    const lower = (expression: Expression): number => {
        if (nodes.length >= 128) return fail('RAM graph exceeds 128 tensors', output);
        if (isParenthesizedExpression(expression)) return lower(expression.value);
        if (isNameExpression(expression)) {
            const index = names.get(expression.name);
            if (index === undefined) return fail('Unknown RAM tensor: ' + expression.name, output);
            return index;
        }
        let node: RamNode;
        if (isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0]) && expression.arguments[0].name === 'relu') {
            const input = lower(expression.head);
            node = { kind: 'relu', input, shape: nodes[input].shape };
        } else if (isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0]) && expression.arguments[0].name === 'linear'
            && isApplicationExpression(expression.head) && expression.head.arguments.length === 1) {
            if (precision !== 'f32') return fail('RAM linear currently requires .f32', output);
            const left = lower(expression.head.head), right = lower(expression.head.arguments[0]);
            const x = nodes[left], w = nodes[right];
            if (x.shape.length !== 2 || w.shape.length !== 2 || x.shape[1] !== w.shape[0])
                return fail('RAM linear expects X[M,K] and W[K,N]', output);
            if (w.kind !== 'constant') return fail('RAM linear requires baked weights', output);
            const shape = [x.shape[0], w.shape[1]];
            validShape(shape, output);
            node = { kind: 'linear', left, right, shape };
        } else if (isBinaryExpression(expression) && (expression.operator === '+' || expression.operator === '*')) {
            if (precision !== 'f32') return fail('RAM arithmetic currently requires .f32', output);
            const left = lower(expression.left), right = lower(expression.right);
            const shape = nodes[left].shape;
            if (shape.length !== nodes[right].shape.length || shape.some((n, i) => n !== nodes[right].shape[i]))
                return fail('RAM arithmetic requires equal shapes; broadcasting is not supported', output);
            node = { kind: expression.operator === '+' ? 'add' : 'mul', left, right, shape };
        } else return fail('RAM supports tensor names, +, *, relu, and linear', output);
        nodes.push(node); return nodes.length - 1;
    };
    if (!output.value) fail('RAM requires an output tensor', output);
    const result = lower(output.value!);
    if (nodes[result].kind === 'input' || nodes[result].kind === 'constant') fail('RAM output must contain a GPU operation', output);
    const name = id.split(/[\\/]/).at(-1)!.replace(/\.ram$/i, '');
    if (!/^[a-z][a-z0-9_]*$/.test(name)) fail('RAM file name must be a lowercase function name');
    const graph: RamGraph = { precision: precision as RamGraph['precision'], shape, nodes, outputShape: nodes[result].shape, output: result, model: ramModel(nodes, result) };
    // Ordinary import discovery sees a standard one-argument function. Its runtime
    // implementation is installed by useFile, rather than evaluating this stub.
    const program = parse(`fun ${input.name} ${name}\nreturn ${input.name}\nend\n`, id);
    return { name, graph, program, source };
}

export function ramFunction(module: RamModule, gpu?: RamGpu, reload?: () => RamModule): NativeFunction {
    return native(module.name, 1, ([value]) => {
        if (reload) module = reload();
        if (!isRankArray(value) || value.shape.length !== module.graph.shape.length
            || value.shape.some((n, i) => n !== module.graph.shape[i]))
            throw new RankError(`${module.name} expects shape ${module.graph.shape.join(' ')}`, 'DimensionMismatch');
        const input = value.items.map(cell => {
            if (typeof cell !== 'number' || !Number.isFinite(cell))
                throw new RankError('RAM input requires finite real values', 'TypeError');
            return ramRound(cell, module.graph.precision);
        });
        if (!gpu) throw new RankError('RAM GPU runtime is unavailable on this host', 'GpuUnavailable');
        const output = gpu(module.graph, input);
        if (output.length !== module.graph.outputShape.reduce((a, b) => a * b, 1) || output.some(n => !Number.isFinite(n)))
            throw new RankError('Invalid GPU output', 'GpuExecution');
        return ownedArray(output.map(n => ramRound(n, module.graph.precision)), module.graph.outputShape);
    });
}

/** Round at the declared boundary; LiteRT uses float32 transport tensors.
 * ReLU preserves every finite binary16 value exactly with either GPU precision. */
export function ramRound(value: number, precision: 'f16' | 'f32'): number {
    if (precision === 'f32') {
        const rounded = Math.fround(value);
        if (!Number.isFinite(rounded)) throw new RankError('RAM value is outside .f32 range', 'TypeError');
        return rounded;
    }
    const magnitude = Math.abs(value);
    if (!Number.isFinite(value) || magnitude > 65504) throw new RankError('RAM value is outside .f16 range', 'TypeError');
    if (!magnitude) return value;
    const step = 2 ** Math.max(-24, Math.floor(Math.log2(magnitude)) - 10);
    const units = magnitude / step;
    const floor = Math.floor(units);
    const rounded = units - floor === 0.5 ? floor + floor % 2 : Math.round(units);
    return Math.sign(value) * rounded * step;
}

/** Compatibility helper for the standalone ReLU probe. */
export function reluModel(shape: readonly number[]): Uint8Array {
    return ramModel([{ kind: 'input', shape }, { kind: 'relu', input: 0, shape }], 1);
}
