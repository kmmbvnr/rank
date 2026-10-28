import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { compileRam } from '../packages/interpreter/out/index.js';

const fixtures = [2, 3].map(scale => {
    const source = `use ml
arg X .f32 shape 16 256
arg W .f32 shape 16 256 = array shape 16 256 fill ${scale}.0
arg B .f32 shape 16 256 = array shape 16 256 fill 0.5
return ((X * W) + B) relu
`;
    return { scale, model: Buffer.from(compileRam(source, 'affine.ram').graph.model).toString('base64') };
});
mkdirSync('output/playwright', { recursive: true });
writeFileSync('output/playwright/ram-affine.js',
    readFileSync('packages/web/test/ram-affine.playwright.js', 'utf8').replace('__RAM_FIXTURES__', JSON.stringify(fixtures)));
