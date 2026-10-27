import { Builder } from 'flatbuffers';
import { isApplicationExpression, isNameExpression, isOptionStatement, isReturnStatement,
    isUseStatement, type Program, type Statement } from '@arrrank/language';
import { parse } from './parser.js';
import { RankError } from './errors.js';
import { native } from './modules/shared.js';
import { ownedArray } from './array-storage.js';
import { isRankArray, type NativeFunction } from './value.js';

export interface RamGraph {
    readonly precision: 'f16' | 'f32';
    readonly shape: readonly number[];
    readonly operation: 'relu';
    readonly model: Uint8Array;
}
/** A synchronous host bridge. It must reject unavailable GPUs and partial delegation. */
export type RamGpu = (graph: RamGraph, input: readonly number[]) => readonly number[];
export interface RamModule { readonly name: string; readonly graph: RamGraph; readonly program: Program; readonly source: string }

/** The first compiler subset: a fixed tensor input and a single ReLU output. */
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
    const [input, output] = body;
    if (body.length !== 2 || !isOptionStatement(input) || !isReturnStatement(output))
        fail('RAM MVP expects one option input followed by return Input relu', body[0]);
    // Narrowing is repeated because fail also attaches a source location.
    if (!isOptionStatement(input) || !isReturnStatement(output)) throw new Error('unreachable');
    const precision = input.precision?.name;
    if (precision !== 'f16' && precision !== 'f32') fail('RAM input requires .f16 or .f32', input);
    if (input.defaultValue) fail('Baked weights are outside the RAM MVP', input);
    const shape = input.dimensions.map(dimension => Number(dimension.value));
    const size = shape.reduce((a, b) => a * b, 1);
    if (!shape.length || shape.length > 4 || shape.some(n => !Number.isSafeInteger(n) || n < 1)
        || !Number.isSafeInteger(size) || size > 1_048_576)
        fail('RAM shape requires 1–4 positive dimensions and at most 1048576 elements', input);
    const expression = output.value;
    if (!expression || !isApplicationExpression(expression) || !isNameExpression(expression.head)
        || expression.head.name !== input.name || expression.arguments.length !== 1
        || !isNameExpression(expression.arguments[0]) || expression.arguments[0].name !== 'relu')
        fail('RAM MVP supports only return Input relu', output);
    const name = id.split(/[\\/]/).at(-1)!.replace(/\.ram$/i, '');
    if (!/^[a-z][a-z0-9_]*$/.test(name)) fail('RAM file name must be a lowercase function name');
    const graph: RamGraph = { precision: precision as RamGraph['precision'], shape, operation: 'relu', model: reluModel(shape) };
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
        if (output.length !== input.length || output.some(n => !Number.isFinite(n)))
            throw new RankError('Invalid GPU output', 'GpuExecution');
        return ownedArray(output.map(n => ramRound(n, module.graph.precision)), module.graph.shape);
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

/** Minimal TFLite schema emitter: Model/SubGraph/Tensor/Operator/Buffer.
 * Field numbers follow tensorflow/compiler/mlir/lite/schema/schema.fbs. */
export function reluModel(shape: readonly number[]): Uint8Array {
    const b = new Builder(512);
    const vector = (items: readonly number[], offsets = false): number => {
        b.startVector(4, items.length, 4);
        for (let i = items.length - 1; i >= 0; i--) offsets ? b.addOffset(items[i]) : b.addInt32(items[i]);
        return b.endVector();
    };
    const tensors = ['X', 'Y'].map(name => {
        const label = b.createString(name), dimensions = vector(shape);
        b.startObject(10); b.addFieldOffset(0, dimensions, 0); b.addFieldOffset(3, label, 0);
        return b.endObject(); // FLOAT32 and buffer 0 are schema defaults.
    });
    const inputs = vector([0]), outputs = vector([1]);
    b.startObject(13); b.addFieldOffset(1, inputs, 0); b.addFieldOffset(2, outputs, 0);
    const op = b.endObject();
    const tensorVector = vector(tensors, true), ops = vector([op], true);
    b.startObject(6); b.addFieldOffset(0, tensorVector, 0); b.addFieldOffset(1, inputs, 0);
    b.addFieldOffset(2, outputs, 0); b.addFieldOffset(3, ops, 0);
    const subgraph = b.endObject();
    b.startObject(4); b.addFieldInt8(0, 19, 0); b.addFieldInt32(3, 19, 0); // RELU = 19
    const code = b.endObject();
    b.startObject(3); const buffer = b.endObject();
    const graphs = vector([subgraph], true), codes = vector([code], true), buffers = vector([buffer], true);
    b.startObject(8); b.addFieldInt32(0, 3, 0); b.addFieldOffset(1, codes, 0);
    b.addFieldOffset(2, graphs, 0); b.addFieldOffset(4, buffers, 0);
    b.finish(b.endObject(), 'TFL3');
    return b.asUint8Array();
}
