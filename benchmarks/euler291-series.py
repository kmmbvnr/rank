import json,os,subprocess,statistics,sys
cases=[('compiled','original',None,'5000000000000000'),('compiled','powmod','powmod','5000000000000000'),('compiled','arrayrootswholepair','bulk','5000000000000000'),('reference','arrayrootswholepair','bulk','5000000000000000'),('reference','original',None,'100000000000'),('reference','bounded','bulk','100000000000')]
if '--balanced' in sys.argv: cases=[('compiled','original',None,'5000000000000000'),('compiled','boundedwholepair','both','5000000000000000'),('reference','boundedwholepair','both','5000000000000000')]
records=[]
for round in range(int(sys.argv[1]) if len(sys.argv)>1 else 3):
 for mode,variant,probe,limit in (cases if round%2==0 else list(reversed(cases))):
  cmd=['node']+([] if probe else ['--import','./benchmarks/experiments/euler291-legacy-loader.mjs'])
  env=dict(os.environ)
  if probe:
   cmd+=['--import','./benchmarks/experiments/euler291-probe-loader.mjs'];env['RANK291_PROBE']=probe
  cmd+=['benchmarks/euler291-investigation.mjs',mode,variant,limit]
  p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=60,check=True)
  lines=[json.loads(l) for l in p.stdout.splitlines()]
  record=dict(lines[-1],round=round,phases=lines[:-1]);records.append(record);print(json.dumps(record),flush=True)
summary=[]
for mode,variant,probe,limit in cases:
 rows=[r for r in records if (r['mode'],r['variant'],r['probe'],r['limit'])==(mode,variant,probe,limit)]
 summary.append(dict(mode=mode,variant=variant,probe=probe,limit=limit,medianMs=statistics.median(r['ms'] for r in rows),medianRssMiB=statistics.median(r['rssMiB'] for r in rows)))
print(json.dumps({'summary':summary}),flush=True)
