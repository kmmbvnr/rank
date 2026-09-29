import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo } from './support.js';

const PEOPLE = [
    'id,team,score,city,tier',
    '1,red,10.5,Oslo,1',
    '2,blue,20,Rome,2',
    '3,red,,Oslo,1',
    '4,green,15.25,Rome,2',
    '5,blue,20,,3',
    '6,red,7,Oslo,1',
    '7,,3,Paris,3',
].join('\n');
const TEAMS = 'team,boss,size\nred,Ann,3\nblue,Bo,2\nyellow,Cy,9\n';

/** Runs `program` twice, over the column table `T` and over its object rows, and returns both outputs. */
function bothWays(program: string, observe: string) {
    const run = (rows: boolean) => {
        const io = new MemoryIo({ '/people.csv': PEOPLE, '/teams.csv': TEAMS });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute('use tables\nuse stats\nuse sequences\nuse core\nP = "/people.csv" csv\nQ = "/teams.csv" csv\n'
            + (rows ? 'T = P array\nU = Q array' : 'T = P\nU = Q'));
        try { return formatValue(runtime.execute(`${program}\n${observe}`)!); } catch (error) {
            return `error: ${(error as Error).message.split('\n')[0]}`;
        }
    };
    return { fresh: run(false), old: run(true) };
}

describe('column table operations agree with the object-row implementation', () => {
    const cases: [string, string, string][] = [
        ['filter by a comparison', 'R = T filter .team equal "red"', 'R .id'],
        ['filter by two conditions', 'R = T filter .tier equal 1 and .id greater 1', 'R .id'],
        ['filter to nothing', 'R = T filter .id greater 99', 'R len'],
        ['select computed columns', 'R = T select\n  .id = .id\n  .double = .id * 2\nend', 'R .double'],
        ['select with a scalar', 'R = T select\n  .id = .id\n  .k = 5\nend', 'R .k'],
        ['select keeps absent cells', 'R = T select\n  .score = .score\nend', 'R .score default -1'],
        ['sort ascending, absent last', 'R = T sort by .score', 'R .id'],
        ['sort descending then ascending', 'R = T sort by .tier .descending .id', 'R .id'],
        ['sort text', 'R = T sort by .city .id', 'R .id'],
        ['rank after sort', 'R = T sort by .tier\nS = R select\n  .id = .id\n  .rank = ranknumber\nend', 'S .rank'],
        ['row number', 'S = T select\n  .id = .id\n  .n = rownumber\nend', 'S .n'],
        ['group count and mean', 'G = T group by .team\nR = G select\n  .n = count\n  .avg = .score mean\nend', 'R .avg default -1'],
        ['group keys in first-seen order', 'G = T group by .city\nR = G select\n  .n = count\nend', 'R .n'],
        ['group by two fields', 'G = T group by .tier .team\nR = G select\n  .n = count\n  .top = .score max\nend', 'R .top default -1'],
        ['group sum and median', 'G = T group by .tier\nR = G select\n  .total = .score sum\n  .mid = .score median\nend', 'R .total'],
        ['rollup', 'G = T rollup by .tier .team\nR = G select\n  .n = count\nend', 'R .n'],
        ['group then sort', 'G = T group by .team\nR = G select\n  .n = count\nend\nS = R sort by .n .descending .team', 'S .n'],
        ['inner join', 'R = T U innerjoin by .team', 'R .id'],
        ['left join', 'R = T U leftjoin by .team', 'R .boss default "none"'],
        ['left join size', 'R = T U leftjoin by .team', 'R .size default 0'],
        ['join keeps left order and repeats', 'R = T U innerjoin by .team', 'R .team'],
        ['chained table operations', 'R = (T filter .tier at least 2) sort by .id .descending', 'R .id'],
        ['length', 'R = T filter .id greater 2', 'R len'],
    ];
    for (const [name, program, observe] of cases) {
        it(name, () => {
            const { fresh, old } = bothWays(program, observe);
            expect(fresh).toBe(old);
        });
    }
});
