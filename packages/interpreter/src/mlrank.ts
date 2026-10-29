import { partitionRam, executeRamGraph, type RamPart } from './ram-plan.js';
import { ramState, retainRamState, registerRetainFunction, type RamStateDescriptor, type OwnRamState } from './ram-state.js';
import { fileTensorInput, type FileTensorInput } from './file-tensor.js';
import { demandValue } from './plan.js';
import { decodeRamWeights, ramWeightDigest, ramWeightName } from './ram-weights.js';
import { lowerRamStructure } from './ram-structure.js';
import { ramModel, type RamNode } from './ram-model.js';
import { isApplicationExpression, isNameExpression, isArgStatement, isReturnStatement,
    isUseStatement, isFunctionStatement, isDeclaredCallExpression, functionCallSignature, isParenthesizedExpression, isBinaryExpression,
    isStringLiteral, isAssignmentStatement, type Expression, type FunctionStatement, type Program, type Statement } from '@arrrank/language';
import { parse } from './parser.js';
import { RankError } from './errors.js';
import { native } from './modules/shared.js';
import { Interpreter } from './interpreter.js';
import { arrayValues, ownedArray } from './array-storage.js';
import { isRankArray, type NativeFunction } from './value.js';

export interface RamGraph {
    readonly parts?: readonly RamPart[];
    readonly memoryPlan?: {budgetBytes:number; peakBytes:number; peakStateBytes:number; peakStates:number};
    readonly precision: 'f16' | 'f32';
    readonly shape: readonly number[];
    readonly inputs: readonly { name: string; shape: readonly number[]; dtype?: 'i32'; indexLimit?: number }[];
    readonly nodes: readonly RamNode[];
    readonly outputShape: readonly number[];
    readonly output: number;
    readonly model: Uint8Array;
    /** Serialized graph plus nominal tensors, or largest part for a composite; excludes driver overhead. */
    readonly reservationBytes: number;
}
/** A synchronous host bridge. It must reject unavailable GPUs and partial delegation. */
export type RamGpu = ((graph: RamGraph, input: readonly number[], inputFiles?: readonly (FileTensorInput | null)[], options?: {inputStates?: readonly (string|null)[]; retainOutput?: boolean}) => readonly number[] | RamStateDescriptor) & {
    memory?: () => {memoryBudgetBytes:number; stateBytes:number; residentStates:number; maxStates:number};
    control?: (request: {action:'readState'|'releaseState';stateId:string;outputSize?:number}) => {output?:number[]};
};
export interface RamModule { readonly name: string; readonly graph: RamGraph; readonly program: Program; readonly source: string; readonly weights: Readonly<Record<string, string>> }

/** Static tensor expressions with baked constants. */
export function compileRam(source: string, id: string, readBinary?: (name: string) => Uint8Array): RamModule {
    const ast = parse(source, id);
    const weights: Record<string, string> = {};
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
    const input = body.find(statement => !isFunctionStatement(statement)), output = body.at(-1);
    if (!isArgStatement(input) || input.defaultValue || !isReturnStatement(output))
        fail('RAM expects runtime options, optional baked weights, and a final return', body[0]);
    if (!isArgStatement(input) || !isReturnStatement(output)) throw new Error('unreachable');
    const firstType = input.precision?.name;
    const precision = firstType === 'i32' ? 'f32' : firstType;
    if (precision !== 'f16' && precision !== 'f32') fail('RAM input requires .f16 or .f32', input);
    const shape = input.dimensions.map(dimension => Number(dimension.value));
    const size = shape.reduce((a, b) => a * b, 1);
    if (!shape.length || shape.length > 4 || shape.some(n => !Number.isSafeInteger(n) || n < 1)
        || !Number.isSafeInteger(size) || size > 4_194_304)
        fail('RAM input shape requires 1–4 positive dimensions and at most 4194304 elements', input);
    const nodes: RamNode[] = [{ kind: 'input', shape, ...(firstType === 'i32' ? {dtype:'i32' as const} : {}) }];
    let constantSize = 0;
    const validShape = (dimensions: readonly number[], statement: Statement, limit = 1_048_576): number => {
        const count = dimensions.reduce((a, b) => a * b, 1);
        if (!dimensions.length || dimensions.length > 4 || dimensions.some(n => !Number.isSafeInteger(n) || n < 1)
            || !Number.isSafeInteger(count) || count > limit)
            fail(`RAM tensor requires 1–4 positive dimensions and at most ${limit} elements`, statement);
        return count;
    };
    const inputs: {name:string;shape:number[];dtype?:'i32';indexLimit?:number}[] = [{ name: input.name, shape, ...(firstType === 'i32' ? {dtype:'i32' as const} : {}) }];
    const moduleNames = new Map<string, number>([[input.name, 0]]);
    let names = moduleNames;
    const inputSpecs = new Map([[0, inputs[0]]]);
    const functions = new Map<string, FunctionStatement>();
    const activeFunctions: string[] = [];
    const simpleAssignment = (statement: Statement) => isAssignmentStatement(statement)
        && statement.operator === '=' && !statement.deferred && !statement.accumulate;
    const declareFunction = (statement: FunctionStatement): void => {
        if (!statement.gpu) fail('RAM functions must be declared with gpu, not fun or memo', statement);
        const signature = functionCallSignature(statement);
        if (!signature.arity || statement.memo || statement.ranks.length || signature.words.length
            || signature.parameters.some(parameter => parameter.kind !== 'data' || parameter.deferred))
            fail('RAM functions require positional tensor parameters without memo, rank or deferred modifiers', statement);
        if (functions.has(statement.name)) fail('Duplicate RAM function: ' + statement.name, statement);
        const result = statement.statements.at(-1);
        if (!isReturnStatement(result) || !result.value)
            fail('RAM function requires a final tensor return', statement);
        for (const inner of statement.statements.slice(0, -1))
            if (!simpleAssignment(inner)) fail('RAM function permits simple tensor assignments and a final return', inner);
        functions.set(statement.name, statement);
    };
    const declareWeight = (weight: Statement): void => {
        if (!isArgStatement(weight) || !weight.defaultValue)
            fail('RAM permits only baked option declarations before return', weight);
        if (!isArgStatement(weight) || !weight.defaultValue) throw new Error('unreachable');
        if (precision !== 'f32' || weight.precision?.name !== 'f32')
            fail('Baked arithmetic currently requires .f32 inputs and weights', weight);
        if (names.has(weight.name)) fail('Duplicate RAM option: ' + weight.name, weight);
        const shape = weight.dimensions.map(d => Number(d.value));
        const size = validShape(shape, weight);
        constantSize += size;
        if (constantSize > 8_388_608) fail('RAM constant storage exceeds 32 MiB', weight);
        let value = weight.defaultValue;
        while (isParenthesizedExpression(value)) value = value.value;
        if (isStringLiteral(value)) {
            if (!ramWeightName.test(value.value)) fail('Binary weights require a simple .rwt attachment name', weight);
            if (!readBinary) fail('Binary weights are unavailable on this host', weight);
            try {
                const bytes = readBinary!(value.value);
                const values = decodeRamWeights(bytes, shape);
                weights[value.value] = ramWeightDigest(bytes);
                names.set(weight.name, nodes.length); nodes.push({ kind: 'constant', values, shape });
            } catch (error) { fail(String(error), weight); }
            if (nodes.length > 4096) fail('RAM graph exceeds 4096 tensors', weight);
            return;
        }
        const evaluator = new Interpreter(() => {});
        let values: number[] = [];
        try {
            // Weights use ordinary Rank array semantics in an isolated compile-time scope.
            // Only earlier baked tensors are available, never runtime inputs or host I/O.
            evaluator.execute('use sequences\nuse numbers\nuse linalg');
            for (const [name, index] of names) {
                const node = nodes[index];
                if (node.kind === 'constant') evaluator.variables.set(name, ownedArray([...node.values], node.shape));
            }
            const result = evaluator.evaluate(value);
            if (!isRankArray(result)) fail('Baked weights must evaluate to a numeric array', weight);
            if (!isRankArray(result)) throw new Error('unreachable');
            if (result.shape.length !== shape.length || result.shape.some((n, i) => n !== shape[i]))
                fail('Baked array shape does not match its option', weight);
            for (const item of arrayValues(result)) {
                if (typeof item !== 'number' && typeof item !== 'bigint')
                    fail('Baked weights require finite numeric elements', weight);
                values.push(ramRound(Number(item), 'f32'));
                if (values.length > size) fail('Baked array length does not match its option', weight);
            }
            if (values.length !== size) fail('Baked array length does not match its option', weight);
        } catch (error) { fail(String(error), weight); }
        finally { evaluator.dispose(); }
        names.set(weight.name, nodes.length); nodes.push({ kind: 'constant', values, shape });
        if (nodes.length > 4096) fail('RAM graph exceeds 4096 tensors', weight);
    };
    let current: Statement = output;
    const lower = (expression: Expression, argument = false): number => {
        if (isParenthesizedExpression(expression)) return lower(expression.value, argument);
        if (isNameExpression(expression)) {
            const index = names.get(expression.name);
            if (index === undefined) return fail('Unknown RAM tensor: ' + expression.name, current);
            if (!argument && nodes[index].kind === 'input' && 'dtype' in nodes[index] && nodes[index].dtype === 'i32')
                return fail('Integer RAM inputs are only supported as gather indices', current);
            return index;
        }
        let call: { definition: FunctionStatement; arguments: readonly Expression[] } | undefined;
        if (isDeclaredCallExpression(expression)) {
            if (!isNameExpression(expression.callee)) return fail('RAM call requires a named local function', current);
            const definition = functions.get(expression.callee.name);
            if (!definition) return fail('Unknown RAM function: ' + expression.callee.name, current);
            if (expression.ranks.length || expression.axes.length)
                return fail('RAM function call modifiers are not supported', current);
            call = { definition, arguments: expression.arguments };
        } else if (isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0])) {
            const definition = functions.get(expression.arguments[0].name);
            if (definition?.parameters.length === 1) call = {definition, arguments:[expression.head]};
            else if (definition?.parameters.length === 2 && isApplicationExpression(expression.head)
                && expression.head.arguments.length === 1)
                call = {definition, arguments:[expression.head.head, expression.head.arguments[0]]};
        }
        if (call) {
            const {definition} = call;
            if (activeFunctions.includes(definition.name))
                return fail('Recursive RAM function: ' + definition.name, current);
            if (activeFunctions.length >= 64) return fail('RAM function nesting exceeds 64 calls', current);
            if (call.arguments.length !== definition.parameters.length)
                return fail('RAM function argument count mismatch: ' + definition.name, current);
            // Evaluate each argument once in the caller, then use the module's lexical
            // environment. Caller locals must not become free variables of the callee.
            const values = call.arguments.map(value => lower(value, true));
            const previousNames = names, previousStatement = current;
            names = new Map(moduleNames);
            definition.parameters.forEach((name, index) => names.set(name, values[index]));
            activeFunctions.push(definition.name);
            try {
                for (const statement of definition.statements) {
                    current = statement;
                    if (isReturnStatement(statement)) return lower(statement.value!, argument);
                    if (isAssignmentStatement(statement)) names.set(statement.name, lower(statement.value));
                }
                return fail('RAM function requires a final tensor return', definition);
            } finally {
                activeFunctions.pop(); names = previousNames; current = previousStatement;
            }
        }
        // Normalization is centered before squaring, avoiding E[X²] - E[X]² cancellation.
        const append = (node: RamNode): number => {
            if (nodes.length >= 4096) return fail('RAM graph exceeds 4096 tensors', current);
            nodes.push(node); return nodes.length - 1;
        };
        if (isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0])) {
            const name = expression.arguments[0].name;
            const right = names.get(name), indexNode = right === undefined ? undefined : nodes[right];
            const spec = right === undefined ? undefined : inputSpecs.get(right);
            if (spec && indexNode?.kind === 'input' && indexNode.dtype === 'i32' && right !== undefined) {
                const left = lower(expression.head);
                const shape = [...spec.shape, ...nodes[left].shape.slice(1)];
                validShape(shape, current);
                spec.indexLimit = Math.min(spec.indexLimit ?? Infinity, nodes[left].shape[0]);
                return append({kind:'gather',left,right,shape});
            }
        }
        const activation = isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0]) ? expression.arguments[0].name : undefined;
        if (activation === 'gelu_new' || activation === 'layernorm') {
            if (precision !== 'f32') return fail('RAM normalization and GELU require .f32', current);
            if (!isApplicationExpression(expression)) throw new Error('unreachable');
            let operand = expression.head, epsilon = 1e-5;
            if (activation === 'layernorm' && isApplicationExpression(operand) && operand.arguments.length === 1) {
                const eps = nodes[lower(operand.arguments[0])];
                if (eps.kind !== 'constant' || eps.values.length !== 1 || !(eps.values[0] > 0))
                    return fail('RAM layernorm epsilon must be a positive baked one-element tensor', current);
                epsilon = eps.values[0]; operand = operand.head;
            }
            const input = lower(operand), logicalShape = nodes[input].shape;
            const shape = [...Array(Math.max(0, 3 - logicalShape.length)).fill(1), ...logicalShape];
            const x = logicalShape.length < 3 ? append({kind:'reshape', input, shape}) : input;
            const constant = (value: number) => append({kind:'constant', shape:shape.map(()=>1), values:[Math.fround(value)]});
            const binary = (kind: 'add' | 'sub' | 'mul' | 'div', left: number, right: number, out = shape) =>
                append({kind,left,right,shape:out});
            let result: number;
            if (activation === 'gelu_new') {
                const cube = binary('mul', binary('mul', x, x), x);
                const inner = binary('mul', binary('add', x, binary('mul', cube, constant(0.044715))), constant(Math.sqrt(2 / Math.PI)));
                const tanh = append({kind:'tanh',input:inner,shape});
                result = binary('mul', binary('mul', x, constant(0.5)), binary('add', tanh, constant(1)));
            } else {
                const reduced = [...shape.slice(0,-1),1];
                const axis = append({kind:'constant',dtype:'i32',shape:[1],values:[shape.length-1]});
                // The MEAN pattern loses variance in the full graph on Metal.
                // SUM / width keeps the centered variance accurate on all tested GPUs.
                const width = constant(shape.at(-1)!);
                const mean = (left: number) => binary('div',
                    append({kind:'sum',left,right:axis,shape:reduced}), width, reduced);
                // Recenter the small residual to remove reduction rounding at large offsets.
                // In exact arithmetic its mean is zero.
                const residual = binary('sub',x,mean(x));
                const centered = binary('sub',residual,mean(residual));
                const variance = mean(binary('mul',centered,centered));
                const inverse = append({kind:'rsqrt',input:binary('add',variance,constant(epsilon),reduced),shape:reduced});
                result = binary('mul',centered,inverse);
            }
            return logicalShape.length < 3 ? append({kind:'reshape',input:result,shape:logicalShape}) : result;
        }
        const structural = lowerRamStructure(expression, nodes, lower, append,
            message => fail(message, current), dimensions => validShape(dimensions, current), precision!);
        if (structural !== undefined) return structural;
        let node: RamNode;
        if (isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0]) && ['relu', 'softmax'].includes(expression.arguments[0].name)) {
            const input = lower(expression.head);
            const kind = expression.arguments[0].name as 'relu' | 'softmax';
            if (kind === 'softmax' && precision !== 'f32') return fail('RAM softmax currently requires .f32', current);
            const shape = nodes[input].shape;
            if (kind === 'softmax' && shape.length < 3) {
                // Explicit HWC keeps the last logical axis in GPU channels, including vectors.
                const aligned = [...Array(3 - shape.length).fill(1), ...shape];
                const operand = nodes[input];
                nodes.push(operand.kind === 'constant'
                    ? { kind: 'constant', values: operand.values, shape: aligned }
                    : { kind: 'reshape', input, shape: aligned });
                nodes.push({ kind, input: nodes.length - 1, shape: aligned });
                node = { kind: 'reshape', input: nodes.length - 1, shape };
            } else node = { kind, input, shape };
        } else if (isApplicationExpression(expression) && expression.arguments.length === 1
            && isNameExpression(expression.arguments[0]) && expression.arguments[0].name === 'linear'
            && isApplicationExpression(expression.head) && expression.head.arguments.length === 1) {
            if (precision !== 'f32') return fail('RAM linear currently requires .f32', current);
            const left = lower(expression.head.head), right = lower(expression.head.arguments[0]);
            const x = nodes[left], w = nodes[right];
            if (x.shape.length < 2 || w.shape.length !== 2 || x.shape.at(-1) !== w.shape[0])
                return fail('RAM linear expects X[...,M,K] and W[K,N]', current);
            if (w.kind !== 'constant') return fail('RAM linear requires baked weights', current);
            const shape = [...x.shape.slice(0, -1), w.shape[1]];
            validShape(shape, current);
            if (x.shape.length > 2) {
                const rows = x.shape.slice(0, -1).reduce((a,b) => a*b, 1);
                const flat = append({kind:'reshape',input:left,shape:[rows,x.shape.at(-1)!]});
                const projected = append({kind:'linear',left:flat,right,shape:[rows,w.shape[1]]});
                return append({kind:'reshape',input:projected,shape});
            }
            node = { kind: 'linear', left, right, shape };
        } else if (isBinaryExpression(expression) && (expression.operator === '+' || expression.operator === '*')) {
            if (precision !== 'f32') return fail('RAM arithmetic currently requires .f32', current);
            const left = lower(expression.left), right = lower(expression.right);
            const a = nodes[left].shape, b = nodes[right].shape;
            const rank = Math.max(a.length, b.length);
            const shape = Array.from({ length: rank }, (_, i) => {
                const x = a[i - (rank - a.length)] ?? 1;
                const y = b[i - (rank - b.length)] ?? 1;
                if (x !== y && x !== 1 && y !== 1)
                    fail('RAM arithmetic requires compatible trailing dimensions', current);
                return Math.max(x, y);
            });
            validShape(shape, current);
            // LiteRT maps rank-2 runtime tensors to BC, but matrix constants to WC.
            // Use explicit HWC shapes so both operands agree on spatial axes.
            const storageRank = Math.max(3, rank);
            const align = (input: number): number => {
                if (nodes[input].kind === 'constant' && nodes[input].shape.length === 4 && nodes[input].shape[0] !== 1)
                    fail('RAM arithmetic does not support baked constants varying along the batch axis of rank-4 tensors', current);
                if (nodes[input].shape.length === storageRank) return input;
                const aligned = [...Array(storageRank - nodes[input].shape.length).fill(1), ...nodes[input].shape];
                const operand = nodes[input];
                nodes.push(operand.kind === 'constant'
                    ? { kind: 'constant', values: operand.values, shape: aligned }
                    : { kind: 'reshape', input, shape: aligned });
                return nodes.length - 1;
            };
            node = { kind: expression.operator === '+' ? 'add' : 'mul', left: align(left), right: align(right),
                shape: [...Array(storageRank - rank).fill(1), ...shape] };
            if (storageRank !== rank) {
                nodes.push(node);
                node = { kind: 'reshape', input: nodes.length - 1, shape };
            }
        } else return fail('RAM supports tensor names, +, *, relu, softmax, gelu_new, layernorm, and linear', current);
        if (nodes.length >= 4096) return fail('RAM graph exceeds 4096 tensors', current);
        nodes.push(node); return nodes.length - 1;
    };
    for (const statement of body.slice(0, -1)) {
        if (statement === input) continue;
        current = statement;
        if (isFunctionStatement(statement)) declareFunction(statement);
        else if (isArgStatement(statement)) {
            if (statement.defaultValue) declareWeight(statement);
            else {
                if (precision !== 'f32' || !['f32','i32'].includes(statement.precision?.name ?? ''))
                    fail('Multiple RAM inputs require .f32 or .i32', statement);
                if (names.has(statement.name)) fail('Duplicate RAM option: ' + statement.name, statement);
                const shape = statement.dimensions.map(d => Number(d.value));
                validShape(shape, statement, 4_194_304);
                const dtype = statement.precision?.name === 'i32' ? {dtype:'i32' as const} : {};
                inputs.push({name:statement.name,shape,...dtype});
                inputSpecs.set(nodes.length, inputs.at(-1)!);
                names.set(statement.name, nodes.length); nodes.push({kind:'input',shape,...dtype});
                if (nodes.length > 4096) fail('RAM graph exceeds 4096 tensors', statement);
            }
        } else if (isAssignmentStatement(statement) && statement.operator === '='
            && !statement.deferred && !statement.accumulate) {
            names.set(statement.name, lower(statement.value));
        } else fail('RAM permits baked options and simple tensor assignments before return', statement);
    }
    current = output;
    if (!output.value) fail('RAM requires an output tensor', output);
    const result = lower(output.value!);
    if (nodes[result].kind === 'input' || nodes[result].kind === 'constant') fail('RAM output must contain a GPU operation', output);
    if (inputs.reduce((sum, input) => sum + input.shape.reduce((a,b) => a*b, 1), 0) > 16_777_216)
        fail('RAM runtime input storage exceeds 64 MiB');
    for (const node of nodes) if (node.kind !== 'input') validShape(node.shape, output);
    const name = id.split(/[\\/]/).at(-1)!.replace(/\.ram$/i, '');
    if (!/^[a-z][a-z0-9_]*$/.test(name)) fail('RAM file name must be a lowercase function name');
    const graph = partitionRam(precision as RamGraph['precision'], nodes, result, inputs, shape);
    // Ordinary import discovery sees a standard function with the declared inputs. Its runtime
    // implementation is installed by useFile, rather than evaluating this stub.
    const program = parse(`fun ${inputs[0].name} ${name} ${inputs.slice(1).map(input => input.name).join(' ')}\nreturn ${input.name}\nend\n`, id);
    return { name, graph, program, source, weights };
}

export function ramFunction(module: RamModule, gpu?: RamGpu, reload?: () => RamModule, own?: OwnRamState, retain = false): NativeFunction {
    const declaration = module.program.statements[0];
    if (!isFunctionStatement(declaration)) throw new Error('Missing RAM function declaration');
    const callSignature = functionCallSignature(declaration);
    const fn = { ...native(module.name, module.graph.inputs.length, (values) => {
        if (reload) module = reload();
        if (values.length !== module.graph.inputs.length)
            throw new RankError('RAM input count changed; import the module again', 'DimensionMismatch');
        if (retain && (module.graph.precision !== 'f32' || !gpu?.control))
            throw new RankError('gpukeep requires .f32 and GPU state support', 'GpuUnavailable');
        const inputFiles: (FileTensorInput | null)[] = [];
        const inputStates: (string|null)[] = [];
        const input = module.graph.inputs.flatMap((spec, i) => {
            const value = demandValue(values[i]);
            const state = ramState(value);
            if (state) {
                if (state.gpu !== gpu) throw new RankError('GPU state belongs to a different host', 'GpuState');
                if (spec.dtype === 'i32' || module.graph.precision !== 'f32') throw new RankError('GPU states require F32 inputs', 'TypeError');
                if (state.descriptor.shape.length !== spec.shape.length || state.descriptor.shape.some((n,j)=>n!==spec.shape[j]))
                    throw new RankError(`${module.name} expects shape ${spec.shape.join(' ')} for ${spec.name}`, 'DimensionMismatch');
                inputFiles.push(null); inputStates.push(state.descriptor.id); return [];
            }
            inputStates.push(null);
            if (!isRankArray(value) || value.shape.length !== spec.shape.length
                || value.shape.some((n, j) => n !== spec.shape[j]))
                throw new RankError(`${module.name} expects shape ${spec.shape.join(' ')} for ${spec.name}`, 'DimensionMismatch');
            const descriptor = fileTensorInput(value);
            inputFiles.push(descriptor ?? null);
            if (descriptor) {
                if (spec.dtype === 'i32' || descriptor.dtype !== 'F32' || module.graph.precision !== 'f32')
                    throw new RankError('File tensor GPU inputs currently require F32 data and .f32 options', 'TypeError');
                return [];
            }
            if (value.shape.reduce((a,b) => a*b, 1) > 1_048_576)
                throw new RankError('RAM inputs above 1048576 elements require a file tensor', 'TypeError');
            return value.items.map(cell => {
                if (spec.dtype === 'i32') {
                    if (typeof cell !== 'bigint' || cell < -2147483648n || cell > 2147483647n)
                        throw new RankError('RAM .i32 input requires signed 32-bit integers', 'TypeError');
                    if (spec.indexLimit !== undefined && (cell < 0n || cell >= BigInt(spec.indexLimit)))
                        throw new RankError(`RAM gather index must be between 0 and ${spec.indexLimit - 1}`, 'IndexError');
                    return Number(cell);
                }
                if (typeof cell !== 'number' || !Number.isFinite(cell))
                    throw new RankError('RAM input requires finite real values', 'TypeError');
                return ramRound(cell, module.graph.precision);
            });
        });
        if (!gpu) throw new RankError('RAM GPU runtime is unavailable on this host', 'GpuUnavailable');
        const output = executeRamGraph(module.graph, gpu, input, inputFiles.some(Boolean) ? inputFiles : undefined,
            retain || inputStates.some(Boolean) ? {...(retain ? {retainOutput:true} : {}), ...(inputStates.some(Boolean) ? {inputStates} : {})} : undefined);
        if ('id' in output) {
            if (!retain || output.dtype !== 'f32' || output.shape.length !== module.graph.outputShape.length || output.shape.some((n,i)=>n!==module.graph.outputShape[i]))
                throw new RankError('Invalid GPU state result', 'GpuExecution');
            return retainRamState(output, gpu, own);
        }
        if (retain) throw new RankError('GPU runtime did not retain the output', 'GpuExecution');
        if (output.length !== module.graph.outputShape.reduce((a, b) => a * b, 1) || output.some(n => !Number.isFinite(n)))
            throw new RankError('Invalid GPU output', 'GpuExecution');
        return ownedArray(output.map(n => ramRound(n, module.graph.precision)), module.graph.outputShape);
    }), callSignature };
    return registerRetainFunction(fn, () => ramFunction(module, gpu, reload, own, true));
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
