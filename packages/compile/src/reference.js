import {readFileSync} from 'node:fs';
import {Interpreter} from '@arrrank/interpreter';

// One process per case keeps mutable interpreter state and timeouts isolated.
const {source, args} = JSON.parse(readFileSync(0, 'utf8'));
const lines = [];
const runtime = new Interpreter(line => lines.push(line), {args});
let result;
try {
  runtime.execute(source);
  result = {ok: true, stdout: lines.map(line => line + '\n').join('')};
} catch (error) {
  result = {ok: false, stdout: lines.map(line => line + '\n').join(''), error: error.message};
} finally { runtime.dispose(); }
process.stdout.write(JSON.stringify(result));
