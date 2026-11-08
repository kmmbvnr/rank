import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const runtime = process.env.RANK489_RUNTIME ? pathToFileURL(process.env.RANK489_RUNTIME)
 : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter } = await import(runtime);
const { compileScalarFunction } = await import(new URL('./jit/scalar-function-kernel.js', runtime));
const source = readFileSync('demos/euler/489_commonfactors.ra', 'utf8');
const r = new Interpreter(() => {}, { args: ['--ma=0', '--nb=0'] });
try {
 r.execute(source);
 const integerArray = { kind: 'array', element: 'integer', rank: 1 };
 for (const [name, types] of [['simple_roots', Array(4).fill('integer')], ['roots', Array(4).fill('integer')],
  ['extend', [integerArray, integerArray]], ['common', ['integer', 'integer']]]) {
  const definition = r.functions.definitionOf(r.variables.get(name));
  const kernel = definition && compileScalarFunction(definition.statement, types, true);
  console.log(JSON.stringify({ name, compiled: !!kernel, sourceSha256: kernel
   ? createHash('sha256').update(kernel.source).digest('hex') : undefined,
   numberSourceSha256: kernel?.numberDirect ? createHash('sha256').update(String(kernel.numberDirect)).digest('hex') : undefined,
   ...(process.argv.includes('--source') && kernel ? { source: kernel.source } : {}) }));
 }
} finally { r.dispose(); }
