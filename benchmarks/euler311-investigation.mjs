import {readFileSync} from 'node:fs';
const {Interpreter, RuntimeDiagnostics} = await import(process.env.RANK_BENCH_RUNTIME
    || new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const [mode = 'compiled', limit = '1000000', block = '4000000', variant = 'original'] = process.argv.slice(2);
if (!['compiled', 'reference', 'exact', 'prefix'].includes(mode)
    || !['original', 'inline', 'online'].includes(variant)
    || !/^\d+$/.test(limit) || !/^\d+$/.test(block) || Number(block) < 1) {
    throw Error('mode limit block variant');
}
const file = new URL(variant === 'online' ? './experiments/euler311-online.ra'
    : '../demos/euler/311_biclinic.ra', import.meta.url);
let source = readFileSync(file, 'utf8')
    .replace('arg Limit integer = 10 ** 10', `arg Limit integer = ${limit}`)
    .replace(/arg Block integer = \d+/, `arg Block integer = ${block}`);
if (variant === 'inline') {
    const [head, body] = source.split('fun Low biclinic_block High\n');
    source = head.replace('Answer = 0', 'Total = 0')
        .replace('  Answer += Low biclinic_block High', body.split('  return Answer\nend')[0] + '  Total += Answer')
        .replace('Answer print', 'Answer = Total\nAnswer print');
}
const interpreter = new Interpreter(() => {}, {
    compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact',
    ...(mode === 'prefix' ? {scalarFunctionCompilation: false} : {}),
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now(), cpuStart = process.cpuUsage();
    diagnostics.run(() => interpreter.execute(source));
    const cpu = process.cpuUsage(cpuStart), answer = String((interpreter.variables.get('Answer') ?? interpreter.lastResult));
    if (limit === '10000000000' && answer !== '2466018557') throw Error('full answer mismatch');
    console.log(JSON.stringify({mode, limit, block, variant, ms: performance.now() - start,
        cpuMs: (cpu.user + cpu.system) / 1000, rssMiB: process.resourceUsage().maxRSS / 1024,
        answer, diagnostics}));
} finally {
    interpreter.dispose();
}
