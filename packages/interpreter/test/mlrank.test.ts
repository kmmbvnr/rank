import { describe, expect, it } from 'vitest';
import { compileRam, ramRound, Interpreter } from '../src/index.js';

const hello = 'use ml\narg X .f16 shape 1 4\nreturn X relu\n';
describe('RAM ReLU MVP', () => {
    it('imports a callable graph and returns the host GPU result', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source: hello }),
            ramGpu: (graph, input) => {
                calls++;
                expect(graph.shape).toEqual([1, 4]);
                expect(new TextDecoder().decode(graph.model.subarray(4, 8))).toBe('TFL3');
                expect(input).toEqual([-2, 0, 1, 3]);
                return [0, 0, 1, 3];
            },
        });
        const value = runtime.execute('use sequences\nuse "hello.ram"\nX = (array -2.0 0.0 1.0 3.0) reshape 1 4\nX hello');
        expect(value).toMatchObject({ shape: [1, 4], items: [0, 0, 1, 3] });
        expect(calls).toBe(1);
    });
    it('supports aliases and recompiles changed attached source on the next call', () => {
        let source = hello;
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source }), ramGpu: (_graph, input) => input.map(n => Math.max(0, n)),
        });
        runtime.execute('use sequences\nuse "hello.ram" as M\nX = (array -2.0 0.0 1.0 3.0) reshape 1 4\nX M.hello');
        source = hello.replace('shape 1 4', 'shape 2 2');
        expect(() => runtime.execute('X M.hello')).toThrow('expects shape 2 2');
    });
    it('rejects unsupported graph bodies with a source location', () => {
        for (const source of [hello.replace('return X relu', 'return X + 1.0'), hello.replace('use ml', 'use io'),
            hello.replace('.f16', '.i8'), hello.replace('shape 1 4', 'shape 0 4')]) {
            expect(() => compileRam(source, 'hello.ram')).toThrow();
        }
        try { compileRam(hello.replace('return X relu', 'return X'), 'hello.ram'); }
        catch (error) { expect(error).toMatchObject({ location: { sourceId: 'hello.ram', line: 3 } }); }
    });
    it('requires a real GPU host and validates types before dispatch', () => {
        const runtime = new Interpreter(() => {}, { loadModule: name => ({ id: name, source: hello }) });
        runtime.execute('use sequences\nuse "hello.ram"\nX = (array -2.0 0.0 1.0 3.0) reshape 1 4');
        expect(() => runtime.execute('X hello')).toThrow('GPU runtime is unavailable');
        expect(() => runtime.execute('((array 1 2 3 4) reshape 1 4) hello')).toThrow('finite real');
        expect(() => runtime.execute('(array 1.0 2.0) hello')).toThrow('expects shape');
    });
    it('rejects malformed GPU outputs and f32 overflow', () => {
        for (const output of [[0], [0, NaN, 1, 3], [0, Infinity, 1, 3]]) {
            const runtime = new Interpreter(() => {}, {
                loadModule: name => ({ id: name, source: hello }), ramGpu: () => output,
            });
            expect(() => runtime.execute('use sequences\nuse "hello.ram"\n((array -2.0 0.0 1.0 3.0) reshape 1 4) hello'))
                .toThrow('Invalid GPU output');
        }
        expect(ramRound(1 + 2 ** -24, 'f32')).toBe(1);
        expect(() => ramRound(1e39, 'f32')).toThrow('outside .f32');
    });
    it('compiles same-shape constants and nested operations, invalidating model bytes when weights change', () => {
        const source = 'use ml\narg X .f32 shape 1 4\n'
            + 'arg Scale .f32 shape 1 4 = array shape 1 4 fill 2.0\n'
            + 'arg Bias .f32 shape 1 4 = array shape 1 4 fill 0.5\nreturn ((X * Scale) + Bias) relu';
        const module = compileRam(source, 'affine.ram');
        expect(module.graph.nodes.filter(node => ['mul', 'add', 'relu'].includes(node.kind)).map(node => node.kind)).toEqual(['mul', 'add', 'relu']);
        expect(module.graph.outputShape).toEqual([1, 4]);
        expect(module.graph.model).not.toEqual(compileRam(source.replace('fill 2.0', 'fill 3.0'), 'affine.ram').graph.model);
        for (const invalid of [source.replace('arg Bias .f32 shape 1 4', 'arg Bias .f32 shape 4'),
            source.replace('fill 0.5', 'fill 1e39'),
            source.replace('X * Scale', 'X / Scale'), source.replace('X * Scale', 'X * Unknown'),
            source.replace(/\.f32/g, '.f16'), source.replace('arg Bias', 'arg Scale')])
            expect(() => compileRam(invalid, 'affine.ram')).toThrow();
    });
    it('materializes ordinary Rank weight expressions and converts integers to f32', () => {
        const bake = (expression: string) => compileRam('use ml\narg X .f32 shape 2 3\n'
            + 'arg W .f32 shape 2 3 = ' + expression + '\nreturn X * W', 'weights.ram').graph.nodes[1];
        for (const expression of ['array shape 2 3 fill 1', 'array shape (1 + 1) 3 fill (2 - 1)',
            '(array 1 1 1 1 1 1) reshape 2 3'])
            expect(bake(expression)).toMatchObject({kind:'constant', values:[1,1,1,1,1,1]});
        for (const expression of ['(1 to 6) reshape 2 3', 'array 1 to 6 shape 2 3'])
            expect(bake(expression)).toMatchObject({values:[1,2,3,4,5,6]});
        expect(bake('(array 1 2 3 4 5 6 shape 3 2) transpose')).toMatchObject({values:[1,3,5,2,4,6]});
        expect(bake('(array 1 2 3 4 5 6 shape 2 3) * 2')).toMatchObject({values:[2,4,6,8,10,12]});
        const source = 'use ml\narg X .f32 shape 2 3\narg A .f32 shape 2 3 = (1 to 6) reshape 2 3\n'
            + 'arg B .f32 shape 2 3 = A * 2\nreturn X + B';
        expect(compileRam(source,'weights.ram').graph.nodes[2]).toMatchObject({values:[2,4,6,8,10,12]});
        for (const expression of ['X', 'Unknown', 'array shape 2 3 fill "text"', 'array shape 2 3 fill .NA',
            'array shape 2 3 fill 1e39', 'array shape 3 2 fill 1', 'array shape 2 3 fill (1 = 1)', '1'])
            expect(() => bake(expression)).toThrow();
    });
    it('bakes explicit vector constants', () => {
        const source = 'use ml\narg X .f32 shape 4\narg W .f32 shape 4 = array -2.0 0.0 1.0 3.0\nreturn X * W';
        expect(compileRam(source, 'scale.ram').graph.nodes[1]).toEqual({ kind: 'constant', shape: [4], values: [-2, 0, 1, 3] });
    });
    it('infers linear output shapes and returns a differently sized GPU tensor', () => {
        const source = 'use ml\narg X .f32 shape 2 3\n'
            + 'arg W .f32 shape 3 2 = array 1.0 2.0 3.0 4.0 5.0 6.0 shape 3 2\n'
            + 'return (X W linear) relu';
        const graph = compileRam(source, 'dense.ram').graph;
        expect(graph.outputShape).toEqual([2, 2]);
        expect(graph.nodes.map(node => node.shape)).toEqual([[2, 3], [3, 2], [2, 2], [2, 2]]);
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source }), ramGpu: () => [22, 28, 49, 64],
        });
        expect(runtime.execute('use sequences\nuse "dense.ram"\n(array 1.0 2.0 3.0 4.0 5.0 6.0 shape 2 3) dense'))
            .toMatchObject({ shape: [2, 2], items: [22, 28, 49, 64] });
        for (const invalid of [source.replace('shape 2 3', 'shape 2 4'),
            source.replace('X W linear', 'X X linear'), source.replace('X W linear', 'X + W'),
            source.replace('shape 3 2 =', 'shape 0 2 ='), source.replace('shape 3 2 =', 'shape 3 3 ='),
            source.replace('X W linear', '(X W linear) + X')])
            expect(() => compileRam(invalid, 'dense.ram')).toThrow();
    });
    it('supports explicit matrix rows and chained linear layers', () => {
        const source = 'use ml\narg X .f32 shape 2 3\n'
            + 'arg W .f32 shape 3 2 = array shape 3 2\n1.0 2.0\n3.0 4.0\n5.0 6.0\nend\n'
            + 'arg V .f32 shape 2 4 = array shape 2 4 fill 0.5\n'
            + 'arg B .f32 shape 2 4 = array shape 2 4 fill 1.0\n'
            + 'return (((X W linear) relu) V linear) + B';
        const graph = compileRam(source, 'dense.ram').graph;
        expect(graph.outputShape).toEqual([2, 4]);
        expect(graph.nodes[1]).toMatchObject({ values: [1, 2, 3, 4, 5, 6] });
        expect(() => compileRam(source.replace('shape 2 4 fill 1.0', 'shape 2 3 fill 1.0'), 'dense.ram')).toThrow();
    });
    it('broadcasts trailing axes and singleton dimensions in either operand order', () => {
        for (const [a, b, expected] of [
            [[2, 3], [3], [2, 3]], [[3], [2, 3], [2, 3]],
            [[2, 1, 3], [1, 4, 1], [2, 4, 3]], [[2, 3, 4, 5], [5], [2, 3, 4, 5]],
        ]) for (const op of ['+', '*']) {
            const source = `use ml\narg X .f32 shape ${a.join(' ')}\n`
                + `arg B .f32 shape ${b.join(' ')} = array shape ${b.join(' ')} fill 0.5\nreturn X ${op} B`;
            expect(compileRam(source, 'broadcast.ram').graph.outputShape).toEqual(expected);
        }
    });
    it('rejects incompatible broadcasting and oversized broadcast results', () => {
        for (const [a, b] of [['2 3', '2'], ['1024 1', '1 1025'], ['2 3 4 5', '2 1 1 5']]) {
            const source = `use ml\narg X .f32 shape ${a}\n`
                + `arg B .f32 shape ${b} = array shape ${b} fill 0.5\nreturn X + B`;
            expect(() => compileRam(source, 'broadcast.ram')).toThrow();
        }
    });
    it('binds assignments to immutable graph nodes and reuses computed tensors', () => {
        const graph = compileRam('use ml\narg X .f32 shape 2 3\nH = X relu\nOld = H\nH = H softmax\nreturn Old + H', 'steps.ram').graph;
        expect(graph.nodes.filter(n => n.kind === 'relu')).toHaveLength(1);
        expect(graph.nodes.filter(n => n.kind === 'softmax')).toEqual([{ kind: 'softmax', input: 2, shape: [1, 2, 3] }]);
        expect(graph.outputShape).toEqual([2, 3]);
        expect(compileRam('use ml\narg X .f32 shape 3\nX = X softmax\nreturn X', 'steps.ram').graph.output).toBe(3);
    });
    it('rejects unsupported assignments and forward references at the offending statement', () => {
        for (const statement of ['H = Missing relu', 'H += X', "H' = X", 'H = X / X']) {
            try {
                compileRam('use ml\narg X .f32 shape 3\n' + statement + '\nreturn X relu', 'steps.ram');
                expect.fail('Expected a compile error');
            } catch (error) {
                expect(error).toMatchObject({ location: { sourceId: 'steps.ram', line: 3 } });
            }
        }
        expect(() => compileRam(hello.replace('relu', 'softmax'), 'hello.ram')).toThrow('requires .f32');
    });
    it('invalidates models after assignment edits and bounds assignment graphs', () => {
        const source = 'use ml\narg X .f32 shape 3\nH = X relu\nreturn H softmax';
        expect(compileRam(source, 'steps.ram').graph.model)
            .not.toEqual(compileRam(source.replace('H = X relu', 'H = X softmax'), 'steps.ram').graph.model);
        expect(compileRam('use ml\narg X .f32 shape 3\n' + 'X = X relu\n'.repeat(128) + 'return X', 'steps.ram').graph.parts)
            .toHaveLength(2);
    });
    it('rounds binary16 ties to even and handles subnormals without silently overflowing', () => {
        expect(ramRound(1 + 2 ** -11, 'f16')).toBe(1);
        expect(ramRound(1 + 3 * 2 ** -11, 'f16')).toBe(1 + 2 ** -9);
        expect(ramRound(2 ** -25, 'f16')).toBe(0);
        expect(ramRound(3 * 2 ** -25, 'f16')).toBe(2 ** -23);
        expect(() => ramRound(65505, 'f16')).toThrow('outside .f16');
    });
});

describe('RAM normalization and GELU', () => {
    it('preserves every supported input rank and permits affine LayerNorm', () => {
        for (const shape of ['7', '2 7', '2 3 7', '2 2 3 7']) {
            for (const op of ['layernorm', 'gelu_new']) {
                const graph = compileRam(`use ml\narg X .f32 shape ${shape}\nreturn X ${op}`, 'norm.ram').graph;
                expect(graph.outputShape).toEqual(shape.split(' ').map(Number));
            }
            const source = `use ml\narg X .f32 shape ${shape}\n`
                + 'arg E .f32 shape 1 = array 0.01\n'
                + 'arg Scale .f32 shape 7 = array shape 7 fill 0.5\n'
                + 'arg Bias .f32 shape 7 = array shape 7 fill -0.1\n'
                + 'return (X E layernorm) * Scale + Bias';
            expect(compileRam(source, 'norm.ram').graph.outputShape).toEqual(shape.split(' ').map(Number));
        }
    });
    it('validates epsilon, precision, and expanded graph limits', () => {
        const source = 'use ml\narg X .f32 shape 3\narg E .f32 shape 1 = array 0.01\nreturn X E layernorm';
        for (const invalid of [source.replace('0.01', '0.0'), source.replace('0.01', '-0.01'),
            source.replace('X E layernorm', 'X X layernorm'),
            source.replace('shape 1 = array 0.01', 'shape 2 = array 0.01 0.02')])
            expect(() => compileRam(invalid, 'norm.ram')).toThrow('positive baked one-element');
        for (const op of ['layernorm', 'gelu_new']) {
            expect(() => compileRam(`use ml\narg X .f16 shape 3\nreturn X ${op}`, 'norm.ram')).toThrow('require .f32');
            expect(compileRam('use ml\narg X .f32 shape 3\n'
                + `X = X ${op}\n`.repeat(30) + 'return X', 'norm.ram').graph.parts!.length).toBeGreaterThan(1);
        }
        expect(compileRam(source, 'norm.ram').graph.model)
            .not.toEqual(compileRam(source.replace('0.01', '0.02'), 'norm.ram').graph.model);
    });
});

describe('RAM structural graphs', () => {
    const head = 'use ml\narg X .f32 shape 2 3\n';
    it('preserves Rank structural shapes and rejects invalid static arguments', () => {
        for (const [body, shape] of [
            ['X reshape 3 2', [3,2]], ['X transpose', [3,2]],
            ['X transpose axis 1 0', [3,2]], ['X # (1 till 3)', [2,2]],
            ['concat X X axis 1', [2,6]],
        ] as const) expect(compileRam(head+'return '+body,'s.ram').graph.outputShape).toEqual(shape);
        for (const body of ['X reshape 7','X reshape 0 3','X transpose axis 1 1',
            'X transpose axis 2 0','X # (1 till 4)','X # (1 till 1)', 'X # 1',
            'concat X (X transpose) axis 0','concat X X axis 2'])
            expect(()=>compileRam(head+'return '+body,'s.ram')).toThrow();
    });
    it('passes multiple validated arguments in declaration order and reloads changed shapes', () => {
        let source = head+'arg W .f32 shape 1 = array 1.0\narg Y .f32 shape 3 2\nreturn X matmul Y';
        let calls=0;
        const r=new Interpreter(()=>{}, {loadModule:name=>({id:name,source}), ramGpu:(g,x)=>{
            calls++; expect(g.inputs.map(i=>i.name)).toEqual(['X','Y']);
            expect(x).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]); return [58,64,139,154];
        }});
        r.execute('use "s.ram"');
        r.variables.set('X',{kind:'array',shape:[2,3],items:[1,2,3,4,5,6]});
        r.variables.set('Y',{kind:'array',shape:[3,2],items:[7,8,9,10,11,12]});
        expect(r.execute('X s Y')).toMatchObject({shape:[2,2],items:[58,64,139,154]});
        expect(()=>r.execute('Y s X')).toThrow('expects shape');
        source=source.replace('shape 3 2','shape 3 1');
        expect(()=>r.execute('X s Y')).toThrow('expects shape 3 1 for Y');
        expect(calls).toBe(1);
    });
    it('preserves the declared call signature for three runtime inputs', () => {
        const source='use ml\narg X .f32 shape 1\narg Y .f32 shape 1\narg Z .f32 shape 1\nreturn (X + Y) + Z';
        const r=new Interpreter(()=>{}, {loadModule:id=>({id,source}),ramGpu:(_graph,input)=>{
            expect(input).toEqual([1,2,3]); return [6];
        }});
        r.execute('use "three.ram"');
        for (const [i,name] of ['X','Y','Z'].entries()) r.variables.set(name,{kind:'array',shape:[1],items:[i+1]});
        expect(r.execute('X three Y Z')).toMatchObject({shape:[1],items:[6]});
        r.variables.set('Z',{kind:'array',shape:[1],items:[NaN]});
        expect(()=>r.execute('X three Y Z')).toThrow('finite real');
    });
    it('checks matrix contraction, batch broadcasting and batched linear shapes', () => {
        const source='use ml\narg X .f32 shape 2 1 3 5\narg Y .f32 shape 1 4 5 7\nreturn X matmul Y rank 2 2';
        expect(compileRam(source,'s.ram').graph.outputShape).toEqual([2,4,3,7]);
        for(const invalid of [source.replace('1 4 5 7','1 4 6 7'),source.replace('1 4 5 7','3 4 5 7'),source.replace(' rank 2 2','')])
            expect(()=>compileRam(invalid,'s.ram')).toThrow();
        expect(compileRam('use ml\narg X .f32 shape 2 3 5\narg W .f32 shape 5 7 = array shape 5 7 fill 0.5\nreturn X W linear','s.ram').graph.outputShape).toEqual([2,3,7]);
    });
});

describe('file-backed projection budgets', () => {
    const projection = 'use ml\narg X .f32 shape 1 768\narg W .f32 shape 768 2304\nreturn X matmul W';
    it('allows a large runtime matrix without embedding its payload in the model', () => {
        const graph = compileRam(projection, 'projection.ram').graph;
        expect(graph.model.length).toBeLessThan(1024);
        expect(graph.outputShape).toEqual([1, 2304]);
        expect(graph.nodes.some(n => n.kind === 'constant')).toBe(false);
    });
    it('keeps separate limits for inputs, computed tensors and total runtime storage', () => {
        expect(() => compileRam(projection.replace('768 2304', '768 8192'), 'projection.ram')).toThrow('4194304');
        expect(() => compileRam(projection.replace('return X matmul W', 'H = W relu\nreturn X matmul H'), 'projection.ram')).toThrow('1048576');
        const inputs = Array.from({length:5}, (_,i) => `arg W${i} .f32 shape 1024 4096`).join('\n');
        expect(() => compileRam(`use ml\narg X .f32 shape 1 1024\n${inputs}\nreturn X matmul W0`, 'projection.ram')).toThrow('64 MiB');
    });
    it('rejects a large ordinary input before reading its cells', () => {
        const runtime = new Interpreter(() => {}, {loadModule:()=>({id:'projection.ram',source:projection}),ramGpu:()=>{throw Error('GPU must not run');}});
        try {
            runtime.execute('use "projection.ram"');
            runtime.variables.set('X', {kind:'array',shape:[1,768],items:Array(768).fill(1)});
            runtime.variables.set('W', {kind:'array',shape:[768,2304],get items(): never {throw Error('Cells must not be read');}});
            expect(() => runtime.execute('X projection W')).toThrow('require a file tensor');
        } finally { runtime.dispose(); }
    });
});
