import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Interpreter} from '../../packages/interpreter/out/index.js';

const files = ['benchmarks/experiments/euler400-original.ra',
    'demos/euler/400_fibtree.ra',
    'benchmarks/experiments/euler400-rolling.ra',
    'benchmarks/experiments/euler400-scalar.ra'];
const ks = [0,1,2,3,4,5,6,7,8,9,10,15,30,63,64,65,99,100,127,128,129,1000];
let checked = 0;
for (const k of ks) {
    let expected;
    for (const file of files) for (const compilation of [false,true]) {
        if (!compilation && file.includes('scalar') && k > 129) continue;
        const runtime = new Interpreter(() => {}, {compilation, args:[`--k=${k}`]});
        try {
            runtime.execute(readFileSync(file,'utf8'));
            const answer = runtime.variables.get('Answer');
            if (expected === undefined) expected = answer;
            assert.equal(answer, expected, `${file}, K=${k}, compilation=${compilation}`);
            checked++;
        } finally { runtime.dispose(); }
    }
}
console.log(JSON.stringify({ks, checked}));
