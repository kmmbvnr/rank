import { algoModule } from './algo.js';
import { bitsModule } from './bits.js';
import { cryptoModule } from './crypto.js';
import { graphModule } from './graph.js';
import { imagesModule } from './images.js';
import { ioModule } from './io.js';
import { jsonModule } from './json.js';
import { linalgModule } from './linalg.js';
import { numbersModule } from './numbers.js';
import { randomModule } from './random.js';
import { sequencesModule } from './sequences.js';
import { statsModule } from './stats.js';
import { tablesModule } from './tables.js';
import { textModule } from './text.js';
import type { RuntimeModule } from './types.js';

export const standardModules: Record<string, RuntimeModule> = {
    algo: algoModule,
    bits: bitsModule,
    cli: {},
    crypto: cryptoModule,
    graph: graphModule,
    images: imagesModule,
    io: ioModule,
    json: jsonModule,
    linalg: linalgModule,
    numbers: numbersModule,
    random: randomModule,
    ranges: {},
    sequences: sequencesModule,
    stats: statsModule,
    tables: tablesModule,
    testing: {},
    text: textModule,
};
