import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, openSync, writeSync, ftruncateSync, closeSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interpreter, formatValue } from '@arrrank/interpreter';
import { nodeIo } from '../out/node-io.js';

test('ordinary Rank reads a tensor beyond 2 GiB without materializing the file', t => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-safetensors-'));
    const path = join(directory, 'large.safetensors');
    const before = 2 ** 31 + 64;
    const header = Buffer.from(JSON.stringify({
        padding: { dtype: 'U8', shape: [before], data_offsets: [0, before] },
        weight: { dtype: 'F32', shape: [2, 3], data_offsets: [before, before + 24] },
    }));
    const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
    const fd = openSync(path, 'wx');
    try {
        writeSync(fd, prefix); writeSync(fd, header);
        ftruncateSync(fd, 8 + header.length + before + 24);
        const values = Buffer.alloc(24); [1, -2, 3, 4, 5, 6].forEach((v, i) => values.writeFloatLE(v, i * 4));
        writeSync(fd, values, 0, values.length, 8 + header.length + before);
    } finally { closeSync(fd); }
    let bytes = 0, maximum = 0;
    const io = { ...nodeIo, open(path, mode) {
        const handle = nodeIo.open(path, mode), read = handle.read.bind(handle);
        handle.read = count => { maximum = Math.max(maximum, count); const result = read(count); bytes += result.length; return result; };
        return handle;
    } };
    const interpreter = new Interpreter(undefined, { io, persistentResources: true });
    try {
        interpreter.execute(`use io\nF = "${path}" open\nF`);
        const metadata = interpreter.execute('F safetensors');
        assert.equal(metadata.shape[0], 2);
        assert.equal(bytes, 8 + header.length);
        interpreter.execute('W = F tensor "weight"');
        assert.equal(formatValue(interpreter.execute('W 1 2')), '6');
        assert.equal(formatValue(interpreter.execute('W 0 1')), '-2');
        assert.equal(formatValue(interpreter.execute('F position')), '0');
        assert.ok(bytes < 4096, `Read ${bytes} bytes`);
        assert.ok(maximum <= 65536);
        // A selected small array participates in ordinary Rank arithmetic.
        assert.equal(formatValue(interpreter.execute('use sequences\nW sum')), '17');
        interpreter.execute("P' = F tensor \"padding\"");
        assert.equal(formatValue(interpreter.execute('P 0')), '0');
        assert.equal(formatValue(interpreter.execute('P 2147483648')), '0');
        assert.ok(bytes < 70000, `Read ${bytes} bytes`);
        t.diagnostic(JSON.stringify({fileBytes:8 + header.length + before + 24,bytesRead:bytes,maximumRead:maximum,peakRssBytes:process.resourceUsage().maxRSS*1024}));
        interpreter.execute('F close');
        assert.throws(() => interpreter.execute('F tensor "weight"'), /closed/);
    } finally { interpreter.dispose(); rmSync(directory, { recursive: true }); }
});

test('invalid Safetensors ranges, duplicates and truncated data are rejected', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-safetensors-bad-'));
    const path = join(directory, 'bad.safetensors');
    const tensor = '{"dtype":"F32","shape":[1],"data_offsets":[0,4]}';
    for (const [header, length] of [
        [`{"x":${tensor},"x":${tensor}}`, 4],
        ['{"x":{"dtype":"F32","shape":[2],"data_offsets":[0,4]}}', 4],
        [`{"x":${tensor}}`, 3],
        [`{"x":${tensor}}`, 5],
        ['{"x":{"dtype":"F32","shape":[1],"data_offsets":[4,8]}}', 8],
    ]) {
        const raw = Buffer.from(header), prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(raw.length));
        writeFileSync(path, Buffer.concat([prefix, raw, Buffer.alloc(length)]));
        const interpreter = new Interpreter(undefined, { io: nodeIo });
        try { assert.throws(() => interpreter.execute(`use io\nF = "${path}" open\nF safetensors`)); }
        finally { interpreter.dispose(); }
    }
    rmSync(directory, { recursive: true });
});

test('tensor views preserve numeric dtypes and reject changes while open', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-safetensors-types-'));
    const path = join(directory, 'types.safetensors');
    const header = Buffer.from(JSON.stringify({
        half: {dtype:'F16',shape:[3],data_offsets:[0,6]},
        bfloat: {dtype:'BF16',shape:[2],data_offsets:[6,10]},
        integers: {dtype:'I64',shape:[2],data_offsets:[10,26]},
        scalar: {dtype:'F32',shape:[],data_offsets:[26,30]},
        empty: {dtype:'U8',shape:[0],data_offsets:[30,30]},
    }));
    const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
    const data = Buffer.alloc(30);
    [0x3c00,0xc000,1,0x3f80,0xbf00].forEach((v,i)=>data.writeUInt16LE(v,i*2));
    data.writeBigInt64LE(-9007199254740993n,10); data.writeBigInt64LE(9007199254740993n,18);data.writeFloatLE(0.25,26);
    writeFileSync(path,Buffer.concat([prefix,header,data]));
    const interpreter = new Interpreter(undefined,{io:nodeIo,persistentResources:true});
    try {
        interpreter.execute(`use io\nF = "${path}" open`);
        assert.deepEqual(interpreter.execute('F tensor "half"').items,[1,-2,2**-24]);
        assert.deepEqual(interpreter.execute('F tensor "bfloat"').items,[1,-0.5]);
        assert.deepEqual(interpreter.execute('F tensor "integers"').items,[-9007199254740993n,9007199254740993n]);
        assert.equal(interpreter.execute('F tensor "scalar"'),0.25);
        assert.deepEqual(interpreter.execute('F tensor "empty"').items,[]);
        const view=interpreter.execute('F tensor "half"');
        assert.equal(view.itemAt(0),1);
        // Change the same file without changing its size: cached pages must not hide it.
        data.writeUInt16LE(0x4000,0);
        writeFileSync(path,Buffer.concat([prefix,header,data]));
        assert.throws(()=>view.itemAt(0),/file changed/);
    } finally {interpreter.dispose();rmSync(directory,{recursive:true});}
});
