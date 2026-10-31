"""Serial whole-source comparisons against the frozen 4a7cb2ae modules."""
import json,os,statistics,subprocess,sys
legacy=['--import','./benchmarks/experiments/euler291-legacy-loader.mjs']
main=['benchmarks/euler291-investigation.mjs']
cases=[('before original','compiled','original',True),('before compact','compiled','shipping',True),('after compact','compiled','shipping',False),('after reference','reference','shipping',False)]
jobs=[(name,before,main+[mode,variant,'5000000000000000'],60) for name,mode,variant,before in cases]
for kind,mode in [('fill','compiled'),('mixedfill','compiled'),('fill','reference'),('powmod','compiled')]:
 for before in [True,False]:jobs.append((f'{kind} {mode} '+('before' if before else 'after'),before,['benchmarks/euler291-kernels.mjs',kind,mode],30))
for file in ['026_reciprocal','104_pandigitalfib','129_repunitdiv','093_arithmeticexpr']:
 for before in [True,False]:jobs.append((file+' '+('before' if before else 'after'),before,['benchmarks/euler289-controls.mjs',f'demos/euler/{file}.ra'],30))
records=[]
for sample in range(int(sys.argv[1]) if len(sys.argv)>1 else 3):
 for name,before,args,timeout in (jobs if sample%2==0 else list(reversed(jobs))):
  cmd=['node']+(legacy if before else [])+args
  p=subprocess.run(cmd,env=dict(os.environ,WHOLE='1'),capture_output=True,text=True,timeout=timeout,check=True)
  lines=[json.loads(l) for l in p.stdout.splitlines()];r=dict(name=name,sample=sample,before=before,result=lines[-1]);records.append(r);print(json.dumps(r),flush=True)
summary=[]
for name,*_ in jobs:
 rows=[r['result'] for r in records if r['name']==name]
 summary.append(dict(name=name,medianMs=statistics.median(r['ms'] for r in rows),medianRssMiB=statistics.median(r['rssMiB'] for r in rows)))
print(json.dumps({'summary':summary}),flush=True)
