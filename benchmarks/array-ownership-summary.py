"""Summarize independent process pairs, not correlated within-process samples."""
import json
import math
import random
import statistics as stats
import sys


def summarize(report):
    rows = report['samples']
    results = []
    for case in dict.fromkeys(row['name'] for row in rows):
        pairs = []
        for pair in sorted({row['pair'] for row in rows if row['name'] == case}):
            values = {row['variant']: row for row in rows
                      if row['pair'] == pair and row['name'] == case}
            pairs.append((values['before'], values['after']))
        for mode in ['fresh', 'prepared']:
            def sample(row):
                return stats.median(row[mode][3:])
            logs = [math.log(sample(after) / sample(before)) for before, after in pairs]
            rng = random.Random(565)
            bootstrap = sorted(math.exp(stats.mean(rng.choices(logs, k=len(logs))))
                               for _ in range(10000))
            results.append({
                'case': case, 'mode': mode, 'pairs': len(pairs),
                'beforeMs': stats.median(sample(before) for before, _ in pairs),
                'afterMs': stats.median(sample(after) for _, after in pairs),
                'pairedRatio': math.exp(stats.mean(logs)),
                'ratio95': [bootstrap[250], bootstrap[9749]],
                'beforeRssKiB': stats.median(before['rssKiB'] for before, _ in pairs),
                'afterRssKiB': stats.median(after['rssKiB'] for _, after in pairs),
            })
    return results


if __name__ == '__main__':
    report = json.load(open(sys.argv[1]))
    print(json.dumps({host: summarize(run) for host, run in report['runs'].items()}, indent=2))
