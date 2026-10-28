import { Builder } from 'flatbuffers';

/** Topologically ordered, statically shaped FP32 tensors. Node IDs are tensor IDs. */
export type RamNode = { readonly shape: readonly number[] } & ({ readonly kind: 'input'; readonly dtype?: 'i32' }
    | { readonly kind: 'constant'; readonly dtype?: 'i32'; readonly values: readonly number[] }
    | { readonly kind: 'relu' | 'tanh' | 'rsqrt'; readonly input: number }
    | { readonly kind: 'softmax'; readonly input: number }
    | { readonly kind: 'reshape'; readonly input: number }
    | { readonly kind: 'transpose'; readonly input: number; readonly permutation: number }
    | { readonly kind: 'slice'; readonly input: number; readonly begin: number; readonly size: number }
    | { readonly kind: 'concat'; readonly operands: readonly number[]; readonly axis: number }
    | { readonly kind: 'matmul' | 'gather'; readonly left: number; readonly right: number }
    | { readonly kind: 'add' | 'mul' | 'sub' | 'div' | 'sum' | 'linear'; readonly left: number; readonly right: number });

/** TFLite Model/SubGraph/Tensor/Operator/Buffer fields follow schema.fbs.
 * Includes internal SUM/SUB/DIV/RSQRT/TANH nodes for normalization and GELU. */
export function ramModel(nodes: readonly RamNode[], output: number): Uint8Array {
    const b = new Builder(1024);
    const vector = (items: readonly number[], offsets = false): number => {
        b.startVector(4, items.length, 4);
        for (let i = items.length - 1; i >= 0; i--) offsets ? b.addOffset(items[i]) : b.addInt32(items[i]);
        return b.endVector();
    };
    b.startObject(3);
    const buffers = [b.endObject()];
    // FullyConnected stores weights as [N,K]; Rank's linear accepts [K,N].
    const tensorsToWrite: RamNode[] = [...nodes];
    const weights = new Map<number, number>();
    for (const node of nodes) if (node.kind === 'linear' && !weights.has(node.right)) {
        const weight = nodes[node.right];
        if (weight.kind !== 'constant') throw new Error('Expected baked linear weights');
        const [k, n] = weight.shape;
        const values = Array.from({ length: k * n }, (_, i) => weight.values[(i % k) * n + Math.floor(i / k)]);
        weights.set(node.right, tensorsToWrite.length);
        tensorsToWrite.push({ kind: 'constant', shape: [n, k], values });
    }
    // Only serialize constants consumed by operators. In particular linear's
    // original [K,N] data is unnecessary unless another operation uses it.
    const consumed = new Set<number>([output]);
    nodes.forEach(node => {
        if ('input' in node) consumed.add(node.input);
        if (node.kind === 'transpose') consumed.add(node.permutation);
        if (node.kind === 'slice') { consumed.add(node.begin); consumed.add(node.size); }
        if (node.kind === 'concat') node.operands.forEach(id => consumed.add(id));
        if ('left' in node) {
            consumed.add(node.left); consumed.add(node.kind === 'linear' ? weights.get(node.right)! : node.right);
        }
    });
    const constantBuffers = new Map<readonly number[], number>();
    const tensors = tensorsToWrite.map((node, index) => {
        let buffer = 0;
        if (node.kind === 'constant' && consumed.has(index)) {
            const existing = constantBuffers.get(node.values);
            if (existing !== undefined) buffer = existing;
            else {
            const bytes = new Uint8Array(node.values.length * 4);
            const view = new DataView(bytes.buffer);
            node.values.forEach((value, i) => node.dtype === 'i32' ? view.setInt32(i * 4, value, true) : view.setFloat32(i * 4, value, true));
            const data = b.createByteVector(bytes);
            b.startObject(3); b.addFieldOffset(0, data, 0);
            buffer = buffers.length; buffers.push(b.endObject());
            constantBuffers.set(node.values, buffer);
            }
        }
        const label = b.createString(`t${index}`), dimensions = vector(node.shape);
        b.startObject(10); b.addFieldOffset(0, dimensions, 0);
        if ((node.kind === 'constant' || node.kind === 'input') && node.dtype === 'i32') b.addFieldInt8(1, 2, 0);
        b.addFieldInt32(2, buffer, 0); b.addFieldOffset(3, label, 0);
        return b.endObject(); // FLOAT32 is the schema default.
    });
    const kinds = ['add', 'mul', 'relu', 'linear', 'reshape', 'softmax', 'sub', 'sum', 'rsqrt', 'tanh', 'div', 'transpose', 'slice', 'concat', 'matmul', 'gather'];
    const builtins = [0, 18, 19, 9, 22, 25, 41, 74, 76, 28, 42, 39, 65, 2, 126, 36];
    const operators: number[] = [];
    nodes.forEach((node, index) => {
        if (node.kind === 'input' || node.kind === 'constant') return;
        const inputs = vector(node.kind === 'concat' ? node.operands : node.kind === 'transpose' ? [node.input, node.permutation] : node.kind === 'slice' ? [node.input, node.begin, node.size] : 'input' in node ? [node.input] : node.kind === 'linear' ? [node.left, weights.get(node.right)!, -1] : [node.left, node.right]);
        const outputs = vector([index]);
        let options = 0;
        if (node.kind === 'gather') {
            b.startObject(2); options = b.endObject();
        } else if (node.kind === 'concat') {
            b.startObject(2); b.addFieldInt32(0, node.axis, 0); options = b.endObject();
        } else if (node.kind === 'transpose' || node.kind === 'slice' || node.kind === 'matmul') {
            b.startObject(node.kind === 'matmul' ? 3 : 0); options = b.endObject();
        } else if (node.kind === 'softmax') {
            b.startObject(1); b.addFieldFloat32(0, 1, 0); options = b.endObject();
        } else if (node.kind === 'reshape') {
            const dimensions = vector(node.shape);
            b.startObject(1); b.addFieldOffset(0, dimensions, 0); options = b.endObject();
        } else if (node.kind === 'sum') {
            b.startObject(1); b.addFieldInt8(0, 1, 0); options = b.endObject();
        } else if (['add', 'mul', 'sub', 'div', 'linear'].includes(node.kind)) { b.startObject(node.kind === 'linear' ? 5 : node.kind === 'add' ? 2 : 1); options = b.endObject(); }
        b.startObject(13);
        b.addFieldInt32(0, kinds.indexOf(node.kind), 0);
        b.addFieldOffset(1, inputs, 0); b.addFieldOffset(2, outputs, 0);
        if (options) {
            b.addFieldInt8(3, node.kind === 'gather' ? 23 : node.kind === 'transpose' ? 26 : node.kind === 'slice' ? 48 : node.kind === 'concat' ? 10 : node.kind === 'matmul' ? 101 : node.kind === 'div' ? 29 : node.kind === 'sum' ? 27 : node.kind === 'sub' ? 28 : node.kind === 'add' ? 11 : node.kind === 'linear' ? 8 : node.kind === 'reshape' ? 17 : node.kind === 'softmax' ? 9 : 21, 0);
            b.addFieldOffset(4, options, 0);
        }
        operators.push(b.endObject());
    });
    const tensorVector = vector(tensors, true), ops = vector(operators, true);
    const inputs = vector(nodes.flatMap((node, i) => node.kind === 'input' ? [i] : [])), outputs = vector([output]);
    b.startObject(6); b.addFieldOffset(0, tensorVector, 0); b.addFieldOffset(1, inputs, 0);
    b.addFieldOffset(2, outputs, 0); b.addFieldOffset(3, ops, 0);
    const subgraph = b.endObject();
    const codes = builtins.map(code => {
        b.startObject(4); b.addFieldInt8(0, code, 0); b.addFieldInt32(3, code, 0);
        return b.endObject();
    });
    const graphs = vector([subgraph], true), codeVector = vector(codes, true), bufferVector = vector(buffers, true);
    b.startObject(8); b.addFieldInt32(0, 3, 0); b.addFieldOffset(1, codeVector, 0);
    b.addFieldOffset(2, graphs, 0); b.addFieldOffset(4, bufferVector, 0);
    b.finish(b.endObject(), 'TFL3');
    return b.asUint8Array();
}
