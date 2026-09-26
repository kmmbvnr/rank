import { algoModule } from './algo.js';
import { bitsModule } from './bits.js';
import { coreModule } from './core.js';
import { cryptoModule } from './crypto.js';
import { datesModule } from './dates.js';
import { graphModule } from './graph.js';
import { gridsModule } from './grids.js';
import { imagesModule } from './images.js';
import { ioModule } from './io.js';
import { jsonModule } from './json.js';
import { linalgModule } from './linalg.js';
import { numbersModule } from './numbers.js';
import { randomModule } from './random.js';
import { sequencesModule } from './sequences.js';
import { sqliteModule } from './sqlite.js';
import { statsModule } from './stats.js';
import { tablesModule } from './tables.js';
import { textModule } from './text.js';
import { xmlModule } from './xml.js';
import type { RuntimeModule } from './types.js';

export const standardModules: Record<string, RuntimeModule> = {
    algo: algoModule,
    bits: bitsModule,
    cli: {},
    core: coreModule,
    crypto: cryptoModule,
    dates: datesModule,
    graph: graphModule,
    grids: gridsModule,
    images: imagesModule,
    io: ioModule,
    json: jsonModule,
    linalg: linalgModule,
    numbers: numbersModule,
    random: randomModule,
    sequences: sequencesModule,
    stats: statsModule,
    tables: { ...tablesModule, ...sqliteModule },
    testing: {},
    text: textModule,
    xml: xmlModule,
};
