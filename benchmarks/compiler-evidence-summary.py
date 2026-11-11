"""Keep correctness, execution evidence and performance in separate tables."""
import json
import math
import random
import statistics as stats
import sys
from pathlib import Path


def interval(values):
    logs = [math.log(value) for value in values]
    rng = random.Random(565)
    draws = sorted(math.exp(stats.mean(rng.choices(logs, k=len(logs)))) for _ in range(10000))
    return math.exp(stats.mean(logs)), draws[250], draws[9749]


def summarize(report):
    if not report['checks'] or not all(row['correctness'] and row['hookedAdmission'] and row['counterAdmission'] for row in report['checks']):
        raise ValueError('Correctness/admission checks are missing or failed')
    rows = report['samples']
    result = []
    for case in dict.fromkeys(row['name'] for row in rows):
        for mode in ['reference', 'plain', 'counters', 'profile', 'trace']:
            selected = [row for row in rows if row['name'] == case and row['mode'] == mode]
            for stage in ['fresh', 'prepared']:
                times = [stats.median(row['samples'][stage][2:]) for row in selected]
                ratios = []
                for row, time in zip(selected, times):
                    plain = next(item for item in rows if item['name'] == case and item['mode'] == 'plain' and item['pair'] == row['pair'])
                    ratios.append(time / stats.median(plain['samples'][stage][2:]))
                result.append(dict(case=case, mode=mode, stage=stage, pairs=len(times),
                    milliseconds=stats.median(times), ratioToPlain=interval(ratios),
                    peakRssKiB=stats.median(row['memory']['peakRssKiB'] for row in selected)))
    return result


if __name__ == '__main__':
    destination, *paths = sys.argv[1:]
    runs = {Path(path).stem: json.load(open(path)) for path in paths}
    summaries = {host: summarize(report) for host, report in runs.items()}
    Path(destination + '.json').write_text(json.dumps({'runs': runs, 'summary': summaries}, indent=2) + '\n')
    text = '# Compiler evidence: independent correctness, coverage and performance\n\n'
    text += 'Issue #565, workstream 12. See `compiler-progress.md` for metric definitions.\n\n'
    for host, report in runs.items():
        text += f"## {host}\n\nRevision `{report['revision']}`; {report['host']}.\n\n"
        text += report['protocol'] + '\n\n'
        text += f"All {len(report['checks'])} case/process-pair correctness and admission checks passed.\n\n"
        text += 'Ratios compare each mode to uninstrumented compiled execution. Below 1 means less time.\n'
        text += 'Intervals bootstrap process pairs (10,000 draws, seed 565); system load is uncontrolled.\n'
        text += 'Reference/plain compares interpretation to compilation. Other ratios measure instrumentation overhead.\n\n'
        for stage in ['fresh', 'prepared']:
            text += f'### {stage}\n\n| Case | Mode | ms | Ratio to plain [95%] | Peak RSS KiB |\n| --- | --- | ---: | --- | ---: |\n'
            for row in summaries[host]:
                if row['stage'] != stage:
                    continue
                ratio, low, high = row['ratioToPlain']
                text += f"| {row['case']} | {row['mode']} | {row['milliseconds']:.3f} | {ratio:.3f} [{low:.3f}, {high:.3f}] | {row['peakRssKiB']:,.0f} |\n"
            text += '\n'
        text += '### Preparation and executed entries\n\n'
        text += 'Representative first process pair. Preparation uses profile mode; entries use trace mode.\n'
        text += 'Entry counts overlap through nested calls and are not percentages or cell counts.\n\n'
        text += '| Case | Observed preparation self ms | Compiled entries | Native entries | Interpreted entries | Omitted detail occurrences |\n| --- | ---: | ---: | ---: | ---: | ---: |\n'
        for name in dict.fromkeys(row['name'] for row in report['samples']):
            profile = next(row for row in report['samples'] if row['name'] == name and row['mode'] == 'profile')
            trace = next(row for row in report['samples'] if row['name'] == name and row['mode'] == 'trace')['evidence']
            preparation = sum(row['selfMilliseconds'] for row in profile['evidence']['preparation'].values())
            kinds = [sum(row['own'][kind] for row in trace['execution'].values()) for kind in ['compiled', 'native', 'interpreted']]
            text += f"| {name} | {preparation:.3f} | {' | '.join(map(str, kinds))} | {trace['observationsOmitted']} |\n"
        text += '\nRaw JSON retains backend timing, fallbacks/categories, known allocation/copy/cell work,\nall samples and the explicit language-error/effect outcomes. It does not assert that\na completed backend entry performed every operation itself. Detailed tracing is\nintentionally bounded; aggregate execution counts remain complete for observed backends.\n\n'
    Path(destination + '.md').write_text(text)
