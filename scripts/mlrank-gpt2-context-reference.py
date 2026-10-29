"""Independent full-prefix NumPy reference for the fixed 16-token GPU KV profile."""
import hashlib,json,pathlib,struct,sys
import numpy as np
from tokenizers import Tokenizer
from mlrank_gpt2_reference import norm,block
root=pathlib.Path(sys.argv[1]).resolve()
config=root/'tokenizer.json'
assert hashlib.sha256(config.read_bytes()).hexdigest()=='8414cab924d8b9b33013f0d221c5862f365ee9be39c5c2bfae8a5a9e970478a6'
tokenizer=Tokenizer.from_file(str(config))
path=root/'gpt2-forward.safetensors'
with open(path,'rb') as file:
 size=struct.unpack('<Q',file.read(8))[0];header=json.loads(file.read(size));base=8+size

def weight(name,rows=None):
 t=header[name];mapped=np.memmap(path,dtype='<f4',mode='r',offset=base+t['data_offsets'][0],shape=tuple(t['shape']))
 return (mapped if rows is None else mapped[rows]).astype(np.float64)

def forward(ids):
 # Recompute the whole prefix with a triangular causal mask. No KV cache here.
 length=len(ids)
 x=(weight('wte.weight',ids)+weight('wpe.weight',list(range(length)))).astype(np.float32).astype(np.float64).reshape(1,length,768)
 for layer in range(12):
  prefix=f'h.{layer}.';weights={name[len(prefix):]:weight(name) for name in header if name.startswith(prefix)}
  x=block(x,weights)['Output']
 hidden=norm(x,weight('ln_f.weight'),weight('ln_f.bias'))[0,-1]
 logits=np.empty(50257,dtype=np.float64)
 for start in range(0,50257,1024):logits[start:start+1024]=hidden@weight('wte.weight',slice(start,start+1024)).T
 return logits

cases=[]
for name,prompt,max_new in [('prefill','Hello, world! My name is',2),('decode','Hello',6),('edge',' '.join(['Hello']*15),2),('masked','Hello',1)]:
 ids=tokenizer.encode(prompt).ids;prompt_ids=ids.copy();steps=[];reason='token limit'
 while len(steps)<max_new:
  if len(ids)>=16:reason='context limit';break
  if ids[-1]==50256:reason='eos';break
  logits=forward(ids);next_id=int(logits.argmax())
  steps.append({'input':ids.copy(),'logits':logits.tolist(),'next':next_id})
  if next_id==50256:reason='eos';break
  ids.append(next_id)
 cases.append({'name':name,'prompt':prompt,'promptTokens':prompt_ids,'maxNew':max_new,'steps':steps,'tokens':ids,'text':tokenizer.decode(ids,skip_special_tokens=False),'reason':reason,'poison':name=='masked'})
 assert len(prompt_ids)<=16
assert len(cases[0]['promptTokens'])>4 and len(cases[1]['tokens'])>4
assert len(cases[2]['promptTokens'])==15 and len(cases[2]['tokens'])==16
boundaries=[{'prompt':' '.join(['Hello']*16),'maxNew':2,'reason':'context limit'}, {'prompt':'Hello','maxNew':0,'reason':'token limit'}, {'prompt':'<|endoftext|>','maxNew':3,'reason':'eos'}]
invalid=[{'prompt':'','maxNew':2,'message':'at least one'},{'prompt':' '.join(['Hello']*17),'maxNew':2,'message':'at most sixteen'},{'prompt':'Hello','maxNew':-1,'message':'nonnegative'},{'prompt':'Hello','maxNew':1.5,'message':'integer'}]
result={'context':16,'cases':cases,'boundaries':boundaries,'invalid':invalid}
json.dump(result,open(root/'context-reference.json','w'),ensure_ascii=False)
print(json.dumps([{k:v for k,v in c.items() if k!='steps'} for c in cases],ensure_ascii=False))
