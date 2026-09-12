import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function runKaggle(program, trainCsv, testCsv) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-kaggle-'));
    try {
        const train = path.join(temporary, 'train.csv');
        const testFile = path.join(temporary, 'test.csv');
        const output = path.join(temporary, 'submission.csv');
        fs.writeFileSync(train, trainCsv);
        fs.writeFileSync(testFile, testCsv);
        const result = spawnSync(process.execPath, [cli,
            path.join(root, `demos/kaggle/${program}.ra`), train, testFile, output,
        ], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr);
        return fs.readFileSync(output, 'utf8');
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

test('Digit Recognizer uses CSV pixel headers and writes ImageId,Label', () => {
    const submission = runKaggle('004_digitsreq',
        'label,pixel0,pixel1\n0,0,0\n1,255,255\n',
        'pixel0,pixel1\n5,5\n250,250\n');
    assert.equal(submission, 'ImageId,Label\n1,0\n2,1\n');
});

test('Disaster Tweets builds training vocabulary and writes id,target', () => {
    const submission = runKaggle('005_distweets',
        'id,text,target\n1,"FIRE, smoke!",1\n2,picnic music,0\n',
        'id,text\n3,fire\n4,picnic\n');
    assert.equal(submission, 'id,target\n3,1\n4,0\n');
});
