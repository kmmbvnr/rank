"""Serial fresh-process delivery comparisons; no tests overlap the series."""
import json,statistics,subprocess,sys
legacy=['--import','./benchmarks/experiments/euler292-slice-legacy-loader.mjs']
cases=[('original compiled',True,'292','compiled','original','120'),('shipping compiled',False,'292','compiled','shipping','120'),('streamed60 before',True,'292','compiled','streamed','60'),('streamed60 after',False,'292','compiled','streamed','60'),('shipping reference',False,'292','reference','shipping','120'),('shipping fixture reference',False,'292','reference','shipping','fixture'),('shipping fixture compiled',False,'292','compiled','shipping','fixture'),('290 before',True,'290','compiled','shipping','18'),('290 after',False,'290','compiled','shipping','18')]
rows=[]
for sample in range(int(sys.argv[1])if len(sys.argv)>1 else 3):
 for name,before,task,mode,variant,n in (cases if sample%2==0 else list(reversed(cases))):
  cmd=['node']+(legacy if before else[])+[f'benchmarks/euler{task}-investigation.mjs',mode,variant,n]
  p=subprocess.run(cmd,capture_output=True,text=True,check=True,timeout=60)
  r=dict(name=name,sample=sample,before=before,result=json.loads(p.stdout.splitlines()[-1]));rows.append(r);print(json.dumps(r),flush=True)
summary=[]
for name,*_ in cases:
 rs=[r['result']for r in rows if r['name']==name]
 summary.append(dict(name=name,medianMs=statistics.median(r['ms']for r in rs),medianRssMiB=statistics.median(r['rssMiB']for r in rs)))
print(json.dumps(dict(summary=summary)),flush=True)
