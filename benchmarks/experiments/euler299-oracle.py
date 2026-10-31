"""Direct integer geometry; no primitive parametrization or gcd counting."""
import json
limit=100
counts=[0]*limit
for b in range(2,limit-2):
    for d in range(2,limit-b):
        for a in range(1,min(b,d)):
            for x in range(1,a):
                y=a-x
                bp=(b-x)**2+y*y
                dp=x*x+(d-y)**2
                left=sorted(((b-a)**2,2*y*y,bp))
                right=sorted(((d-a)**2,2*x*x,dp))
                if left[0]*right[1]!=right[0]*left[1] or left[0]*right[2]!=right[0]*left[2]:
                    continue
                bottom=sorted((b*b+d*d,bp,dp))
                if left[0]*bottom[1]==bottom[0]*left[1] and left[0]*bottom[2]==bottom[0]*left[2]:
                    counts[b+d]+=1
                    break
answers=[0]
for n in range(1,limit+1):answers.append(answers[-1]+counts[n-1])
assert answers[100]==92
out={'method':'Direct (a,b,d,x) enumeration, sorted squared side lengths, exact similarity cross-products, each triple counted once','answers':answers}
open('benchmarks/baselines/2026-10-31-euler299-oracle.json','w').write(json.dumps(out,indent=2)+'\n')
print('Direct geometry: Limit=100 ->',answers[100])
