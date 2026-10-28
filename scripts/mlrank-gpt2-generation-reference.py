"""Independent tokenizer and greedy-generation reference for the four-token demo."""
import hashlib,json,pathlib,random,struct,subprocess,sys
import numpy as np
from tokenizers import Tokenizer
from mlrank_gpt2_reference import norm,block
root=pathlib.Path(sys.argv[1]).resolve()
revision='607a30d783dfa663caf39e06633721c8d4cfcd7e'
config=root/'tokenizer.json'
if not config.exists():
 subprocess.run(['curl','-fLsS','-o',str(config),f'https://huggingface.co/openai-community/gpt2/resolve/{revision}/tokenizer.json'],check=True)
tokenizer=Tokenizer.from_file(str(config))
texts=['','Hello','Hello, world!',"We're WE'RE I'd I'd've",'  hello   world\n\t','Привет 👋','中文 日本語','a\u0085b\ufeffc','\ufeffHello','<|endoftext|>','a<|endoftext|>b','é é','\r\n\t  ','0123456789']
rng=random.Random(42);alphabet=list("abc XYZ012'\n\t \r")+['é','Ж','中','👋','\u0085','\u00a0','\ufeff','́']
texts += [''.join(rng.choice(alphabet) for _ in range(rng.randrange(1,60))) for _ in range(200)]
cases=[{'text':text,'ids':tokenizer.encode(text).ids,'decoded':tokenizer.decode(tokenizer.encode(text).ids,skip_special_tokens=False)} for text in texts]
json.dump({'revision':revision,'tokenizerSha256':hashlib.sha256(config.read_bytes()).hexdigest(),'cases':cases},open(root/'tokenizer-reference.json','w'),ensure_ascii=False)
path=root/'gpt2-forward.safetensors'
with open(path,'rb') as f:
 size=struct.unpack('<Q',f.read(8))[0];header=json.loads(f.read(size));base=8+size

def weight(name,rows=None):
 t=header[name];mapped=np.memmap(path,dtype='<f4',mode='r',offset=base+t['data_offsets'][0],shape=tuple(t['shape']))
 return (mapped if rows is None else mapped[rows]).astype(np.float64)
ids=tokenizer.encode('Hello').ids;steps=[]
for _ in range(3):
 padded=ids+[50256]*(4-len(ids))
 x=(weight('wte.weight',padded)+weight('wpe.weight',[0,1,2,3])).astype(np.float32).astype(np.float64).reshape(1,4,768)
 for layer in range(12):
  prefix=f'h.{layer}.';weights={name[len(prefix):]:weight(name) for name in header if name.startswith(prefix)}
  x=block(x,weights)['Output']
 hidden=norm(x,weight('ln_f.weight'),weight('ln_f.bias')).reshape(4,768)[len(ids)-1]
 logits=np.empty(50257,dtype=np.float64)
 for start in range(0,50257,1024):logits[start:start+1024]=hidden@weight('wte.weight',slice(start,start+1024)).T
 next_id=int(logits.argmax());steps.append({'input':ids.copy(),'logits':logits.tolist(),'next':next_id})
 if next_id==50256:break
 ids.append(next_id)
result={'revision':revision,'prompt':'Hello','maxNew':3,'steps':steps,'tokens':ids,'text':tokenizer.decode(ids,skip_special_tokens=False)}
json.dump(result,open(root/'generation-reference.json','w'),ensure_ascii=False)
print(json.dumps({'tokenizerCases':len(cases),'tokens':ids,'text':result['text'],'steps':len(steps),'tokenizerSha256':hashlib.sha256(config.read_bytes()).hexdigest()}))
