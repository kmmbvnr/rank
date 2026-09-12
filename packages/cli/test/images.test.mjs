import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { nodeIo } from '../out/node-io.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

test('sorts JPEG/PNG images, resizes RGB, and runs Dogs vs Cats', async t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-images-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const train = path.join(temporary, 'train');
    const testImages = path.join(temporary, 'test1');
    fs.mkdirSync(train);
    fs.mkdirSync(testImages);
    const image = async (directory, name, gray) => sharp({
        create: { width: 2, height: 2, channels: 3,
            background: { r: gray, g: gray, b: gray } },
    }).toFile(path.join(directory, name));
    await Promise.all([
        image(train, 'cat.2.png', 10),
        image(train, 'cat.1.jpg', 20),
        image(train, 'dog.2.jpg', 245),
        image(train, 'dog.1.png', 255),
        image(testImages, '2.png', 250),
        image(testImages, '1.jpg', 15),
    ]);
    fs.writeFileSync(path.join(train, 'ignore.txt'), 'not an image');

    assert.deepEqual(nodeIo.listImages(train).map(image => image.name),
        ['cat.1.jpg', 'cat.2.png', 'dog.1.png', 'dog.2.jpg']);
    const pixels = nodeIo.resizeImages([path.join(testImages, '1.jpg')], 2, 3);
    assert.equal(pixels.length, 18);
    assert.ok([...pixels].every(value => Math.abs(value - 15) <= 1));

    const submission = path.join(temporary, 'submission.csv');
    const result = spawnSync(process.execPath, [cli,
        path.join(root, 'demos/kaggle/009_dogvscat.ra'),
        train, testImages, submission,
    ], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const rows = fs.readFileSync(submission, 'utf8').trim().split('\n');
    assert.equal(rows[0], 'id,label');
    assert.equal(rows.length, 3);
    const first = rows[1].split(',');
    const second = rows[2].split(',');
    assert.equal(first[0], '1');
    assert.equal(second[0], '2');
    assert.ok(Number(first[1]) >= 0 && Number(first[1]) < 0.5);
    assert.ok(Number(second[1]) > 0.5 && Number(second[1]) <= 1);
});
