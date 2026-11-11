// Storage distribution only: stop Euler 792 after constructing Rows.
// This modified diagnostic run is not a timing or full-answer benchmark.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.argv[2]);
const {Interpreter} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const {readArrayItem} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/array-storage.js')));
const source = readFileSync(resolve(root, 'demos/euler/792_toomanytwos.ra'), 'utf8');
const boundary = source.indexOf('Emin =');
if (boundary < 0) throw Error('Missing Rows construction boundary');
const runtime = new Interpreter(() => {}, {args: []});
try {
    const rows = runtime.execute(source.slice(0, boundary) + '\nRows\n');
    const size = rows.shape.reduce((n, dimension) => n * dimension, 1);
    let int32 = 0, safeInteger = 0, int64 = 0, wide = 0;
    for (let index = 0; index < size; index++) {
        const value = readArrayItem(rows, index);
        if (typeof value !== 'bigint') throw Error('Expected integer Rows');
        if (value >= -2147483648n && value <= 2147483647n) int32++;
        else if (value >= -9007199254740991n && value <= 9007199254740991n) safeInteger++;
        else if (value >= -(1n << 63n) && value < (1n << 63n)) int64++;
        else wide++;
    }
    console.log(JSON.stringify({shape: rows.shape, size, int32, safeInteger, int64, wide,
        wideFraction: wide / size, node: process.version, arch: process.arch}));
} finally { runtime.dispose(); }
