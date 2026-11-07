import { pathToFileURL } from 'node:url';
const [beforeRoot, afterRoot] = process.argv.slice(2);
const runtimes = {};
for (const [variant, root] of [['before', beforeRoot], ['after', afterRoot]]) {
 const index = await import(pathToFileURL(root + '/packages/interpreter/out/sorted-search.js'));
 const storage = await import(pathToFileURL(root + '/packages/interpreter/out/array-storage.js'));
 runtimes[variant] = { ...index, ...storage };
}
const size = 200000, count = 100000;
for (const wide of [false, true]) for (const ordered of [true, false]) for (const upper of [false, true]) {
 const values = Array.from({length:size},(_,i)=>2*Math.floor(i/2));
 const queries = Array.from({length:count},(_,i)=>ordered?i*2:(i*7919)%size);
 const expected = queries.reduce((sum,x)=>sum+Math.min(size,upper?2*(Math.floor(x/2)+1):2*Math.ceil(x/2)),0);
 const inputs = {};
 for(const variant of ['before','after']) {
  const r=runtimes[variant];
  const build=xs=>r.typedArray(wide?BigInt64Array.from(xs,x=>BigInt(x)*1000000000000n):Int32Array.from(xs));
  inputs[variant]=[build(values),build(queries)];
  for(let warm=0;warm<2;warm++)r.sortedIndexBatch(...inputs[variant],upper);
 }
 for(let pair=0;pair<3;pair++)for(const variant of pair%2?['after','before']:['before','after']) {
  const r=runtimes[variant], start=performance.now();
  const result=r.sortedIndexBatch(...inputs[variant],upper);
  const ms=performance.now()-start;
  let checksum=0;for(const cell of r.integer32Cells(result))checksum+=cell;
  if(checksum!==expected)throw Error('checksum');
  console.log(JSON.stringify({variant,pair,wide,ordered,upper,size,count,ms,checksum,node:process.version,arch:process.arch}));
 }
}
