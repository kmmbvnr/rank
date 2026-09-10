import { algoModule } from './algo.js';
import { bitsModule } from './bits.js';
import { cryptoModule } from './crypto.js';
import { ioModule } from './io.js';
import { jsonModule } from './json.js';
import { numbersModule } from './numbers.js';
import { sequencesModule } from './sequences.js';
import { textModule } from './text.js';
import type { RuntimeModule } from './types.js';

export const standardModules: Record<string, RuntimeModule> = {
    algo: algoModule,
    bits: bitsModule,
    cli: {},
    crypto: cryptoModule,
    io: ioModule,
    json: jsonModule,
    numbers: numbersModule,
    ranges: {},
    sequences: sequencesModule,
    testing: {},
    text: textModule,
};
