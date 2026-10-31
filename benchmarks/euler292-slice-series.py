"""Compare the same slice programs before/after the compiler improvement."""
import json,os,statistics,subprocess,sys
legacy=['--import','./benchmarks/experiments/euler292-slice-legacy-loader.mjs']
cases=[('streamed60 before',True,'292','streamed','60'),('streamed60 after',False,'292','streamed','60'),('streamed120 after',False,'292','streamed','120'),('compact120 after',False,'292','compact','120'),('snapshot120 before',True,'292','slices','120'),('snapshot120 after',False,'292','slices','120'),('290 before',True,'290','shipping','18'),('290 after',False,'290','shipping','18')]
rows=[]
for sample in range(int(sys.argv[1])if len(sys.argv)>1 else 3):
 for name,before,task,variant,n in (cases if sample%2==0 else list(reversed(cases))):
  cmd=['node']+(legacy if before else[])+[f'benchmarks/euler{task}-investigation.mjs','compiled',variant,n]
  p=subprocess.run(cmd,capture_output=True,text=True,check=True,timeout=30)
  r=dict(name=name,sample=sample,before=before,result=json.loads(p.stdout.splitlines()[-1]));rows.append(r);print(json.dumps(r),flush=True)
summary=[]
for name,*_ in cases:
 rs=[r['result']for r in rows if r['name']==name]
 summary.append(dict(name=name,medianMs=statistics.median(r['ms']for r in rs),medianRssMiB=statistics.median(r['rssMiB']for r in rs)))
print(json.dumps(dict(summary=summary)),flush=True)
