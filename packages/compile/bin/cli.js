#!/usr/bin/env node
import {prepare, task, verify} from '../src/index.js';
import {readFile} from 'node:fs/promises';

try {
  const args = process.argv.slice(2);
  if (args[0]?.endsWith('.ra')) args.unshift('task');
  const [command, file, ...rest] = args;
  if (command === '--version') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version);
  } else if (!command || command === '--help') {
    console.log(`LLM-aided Rust rewrite

rank-compile FILE.ra [--integers exact|i64] > task.md
rank-compile task FILE [--integers exact|i64]
rank-compile prepare FILE --out DIR [--integers exact|i64] [--cases FILE]
rank-compile verify DIR [--timeout MS]

The compiler needs no LLM. It writes a self-contained agent task to stdout.
prepare additionally creates a Cargo project and verification inputs.
Ask your coding agent to implement src/main.rs from task.md, then run verify.
exact is the default. i64 changes the numeric contract and checks overflow.
Initial validated examples: Project Euler 1–10. Rust/Cargo is needed for verify.`);
  } else {
    if (!file || file.startsWith('--')) throw new Error('A source file or project directory is required');
    const allowed = command === 'task' ? ['--integers'] : command === 'prepare'
      ? ['--integers', '--out', '--cases'] : command === 'verify' ? ['--timeout'] : [];
    if (!['task', 'prepare', 'verify'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      if (!allowed.includes(rest[i]) || !rest[i + 1] || options[rest[i]] !== undefined)
        throw new Error(`Invalid or repeated option: ${rest[i]}`);
      options[rest[i]] = rest[i + 1];
    }
    if (command === 'task') process.stdout.write(await task(file, {integers: options['--integers']}));
    if (command === 'prepare') {
      if (!options['--out']) throw new Error('prepare requires --out DIR');
      await prepare(file, {out: options['--out'], integers: options['--integers'], casesFile: options['--cases']});
      console.log(`Prepared ${options['--out']}. Ask your agent to follow task.md, then run rank-compile verify ${options['--out']}`);
    }
    if (command === 'verify') {
      const result = await verify(file, {timeout: options['--timeout'] === undefined ? undefined : Number(options['--timeout'])});
      console.log(`${result.passed}/${result.cases.length} cases passed (${result.integers}); ${file}/verification.json`);
      if (result.passed !== result.cases.length) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
