"""Summarize paired processes; individual warm samples are not independent trials."""
import json
import math
import random
import statistics
import sys


def summarize(rows, baseline, candidate, selector, mode):
    def sample(row):
        values = row['prepared'][3:] if mode == 'prepared' else (
            row['fresh'][1:6] if mode == 'first-five' else row['fresh'][3:])
        return statistics.median(values)

    pairs = []
    for pair in sorted({row['pair'] for row in rows}):
        values = {row['version']: row for row in rows
                  if row['pair'] == pair and row['selector'] == selector}
        pairs.append((values[baseline], values[candidate]))
    logs = [math.log(sample(after) / sample(before)) for before, after in pairs]
    rng = random.Random(565)
    bootstrap = sorted(math.exp(statistics.mean(rng.choices(logs, k=len(logs))))
                       for _ in range(10000))
    return {
        'baseline': baseline, 'candidate': candidate, 'selector': selector,
        'mode': mode, 'pairs': len(pairs),
        'baselineMs': statistics.median(sample(before) for before, _ in pairs),
        'candidateMs': statistics.median(sample(after) for _, after in pairs),
        'pairedRatio': math.exp(statistics.mean(logs)),
        'ratio95': [bootstrap[250], bootstrap[9749]],
        'baselinePeakRssKiB': statistics.median(before['rssKiB'] for before, _ in pairs),
        'candidatePeakRssKiB': statistics.median(after['rssKiB'] for _, after in pairs),
    }


if __name__ == '__main__':
    with open(sys.argv[1]) as source:
        report = json.load(source)
    result = {}
    for name, group in report['runs'].items():
        result[name] = [summarize(group['rows'], baseline, candidate, selector, mode)
                        for baseline, candidate in group['comparisons']
                        for selector in ['literal', 'bound']
                        for mode in ['first-five', 'fresh', 'prepared']]
    for host, rows in report.get('originalProtocol', {}).items():
        adapted = [{**row, 'selector': 'literal', 'fresh': [row['cold'], *row['samples']]} for row in rows]
        result[host + '-original'] = [summarize(adapted, baseline, candidate, 'literal', 'first-five')
                                    for baseline, candidate in [('before', 'shipped'), ('shipped', 'candidate')]]
    print(json.dumps(result, indent=2))
