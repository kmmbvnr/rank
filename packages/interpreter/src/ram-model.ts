import { Builder } from 'flatbuffers';

/** Topologically ordered, same-shape FP32 tensors. Node IDs are tensor IDs. */
export type RamNode = { readonly kind: 'input' }
    | { readonly kind: 'constant'; readonly values: readonly number[] }
    | { readonly kind: 'relu'; readonly input: number }
    | { readonly kind: 'add' | 'mul'; readonly left: number; readonly right: number };

/** TFLite Model/SubGraph/Tensor/Operator/Buffer fields follow schema.fbs.
 * ADD=0, MUL=18, RELU=19; AddOptions=11, MulOptions=21. */
export function ramModel(shape: readonly number[], nodes: readonly RamNode[], output: number): Uint8Array {
    const b = new Builder(1024);
    const vector = (items: readonly number[], offsets = false): number => {
        b.startVector(4, items.length, 4);
        for (let i = items.length - 1; i >= 0; i--) offsets ? b.addOffset(items[i]) : b.addInt32(items[i]);
        return b.endVector();
    };
    b.startObject(3);
    const buffers = [b.endObject()];
    const tensors = nodes.map((node, index) => {
        let buffer = 0;
        if (node.kind === 'constant') {
            const bytes = new Uint8Array(node.values.length * 4);
            const view = new DataView(bytes.buffer);
            node.values.forEach((value, i) => view.setFloat32(i * 4, value, true));
            const data = b.createByteVector(bytes);
            b.startObject(3); b.addFieldOffset(0, data, 0);
            buffer = buffers.length; buffers.push(b.endObject());
        }
        const label = b.createString(`t${index}`), dimensions = vector(shape);
        b.startObject(10); b.addFieldOffset(0, dimensions, 0);
        b.addFieldInt32(2, buffer, 0); b.addFieldOffset(3, label, 0);
        return b.endObject(); // FLOAT32 is the schema default.
    });
    const builtins = [0, 18, 19];
    const operators: number[] = [];
    nodes.forEach((node, index) => {
        if (node.kind === 'input' || node.kind === 'constant') return;
        const inputs = vector(node.kind === 'relu' ? [node.input] : [node.left, node.right]);
        const outputs = vector([index]);
        let options = 0;
        if (node.kind !== 'relu') { b.startObject(node.kind === 'add' ? 2 : 1); options = b.endObject(); }
        b.startObject(13);
        b.addFieldInt32(0, node.kind === 'add' ? 0 : node.kind === 'mul' ? 1 : 2, 0);
        b.addFieldOffset(1, inputs, 0); b.addFieldOffset(2, outputs, 0);
        if (options) {
            b.addFieldInt8(3, node.kind === 'add' ? 11 : 21, 0);
            b.addFieldOffset(4, options, 0);
        }
        operators.push(b.endObject());
    });
    const tensorVector = vector(tensors, true), ops = vector(operators, true);
    const inputs = vector([0]), outputs = vector([output]);
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
