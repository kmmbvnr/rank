import functools,itertools,json
@functools.cache
def win(pos,silver):
 if silver==0:return True
 if not win(pos[1:],silver-1):return True
 for i,x in enumerate(pos):
  for y in range(pos[i-1]+1 if i else 0,x):
   if not win(pos[:i]+(y,)+pos[i+1:],silver):return True
 return False
cases=[]
for n in range(1,11):
 for c in range(min(n,6)):
  answer=sum(win(pos,s) for pos in itertools.combinations(range(n),c+1) for s in range(c+1))
  cases.append({'n':n,'c':c,'answer':str(answer)})
assert next(r['answer'] for r in cases if r['n']==10 and r['c']==2)=='324'
print(json.dumps({'oracle':'direct minimax of regular moves and leftmost pocketing, silver coin identity retained','cases':cases,'states':win.cache_info().currsize}))
