import { pathToFileURL } from 'node:url';
const path = process.env.RANK559_CONVOLUTION ?? new URL('../packages/interpreter/out/runtime/convolution.js', import.meta.url).pathname;
const { modularConvolve } = await import(pathToFileURL(path));
const [size = '50000', modulus = '1000000123'] = process.argv.slice(2);
const n = Number(size), m = Number(modulus);
const a = {cells: Int32Array.from({length:n}, (_, i) => (i * 7919 + i * i) % m), shape:[n]};
const b = {cells: Int32Array.from({length:n - 13}, (_, i) => (i * 104729 + 31) % m), shape:[n - 13]};
let checksum = 0;
for (let i = 0; i < 2; i++) modularConvolve(a, b, m);
const start = performance.now();
for (let i = 0; i < 5; i++) {
    const out = modularConvolve(a, b, m);
    if (!out) throw Error('declined');
    for (const x of out.cells) checksum = (checksum + x) % m;
}
console.log(JSON.stringify({n,m,ms:(performance.now()-start)/5,checksum,rssMiB:process.resourceUsage().maxRSS/1024,node:process.version,arch:process.arch}));
