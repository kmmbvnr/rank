"""NumPy float64 GPT-2 inference reference, with no Rank/GPU implementation calls."""
import numpy as np

def norm(x,g,b):
 centered=x-x.mean(axis=-1,keepdims=True)
 return centered/np.sqrt((centered*centered).mean(axis=-1,keepdims=True)+1e-5)*g+b
def block(x, weights):
 def w(n):return weights[n]
 length=x.shape[1]
 n=norm(x,w('ln_1.weight'),w('ln_1.bias'));p=n@w('attn.c_attn.weight')+w('attn.c_attn.bias')
 q,k,v=[a.reshape(1,length,12,64).transpose(0,2,1,3) for a in np.split(p,3,axis=-1)]
 scores=(q@k.transpose(0,1,3,2))*0.125+np.where(np.triu(np.ones((length,length)),1),-10000.,0.)
 probs=np.exp(scores-scores.max(axis=-1,keepdims=True));probs/=probs.sum(axis=-1,keepdims=True)
 context=(probs@v).transpose(0,2,1,3).reshape(1,length,768)
 a=context@w('attn.c_proj.weight')+w('attn.c_proj.bias');h=x+a
 n2=norm(h,w('ln_2.weight'),w('ln_2.bias'));up=n2@w('mlp.c_fc.weight')+w('mlp.c_fc.bias')
 gelu=.5*up*(1+np.tanh(np.sqrt(2/np.pi)*(up+.044715*up**3)))
 result=h+gelu@w('mlp.c_proj.weight')+w('mlp.c_proj.bias')
 return {'Norm1':n,'Projection':p,'Probabilities':probs,'Attention':a,'Residual1':h,'Norm2':n2,'Up':up,'Activated':gelu,'Output':result}
