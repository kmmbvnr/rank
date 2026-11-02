const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function distribution(results) {
 const edges = [100, 300, 1000, 3000, 10000, 30000, 60000, 180000, 600000, Infinity];
 const labels = ['<100 ms', '100–300 ms', '0.3–1 s', '1–3 s', '3–10 s', '10–30 s', '30–60 s', '1–3 min', '3–10 min', '≥10 min'];
 const times = results.filter(x => x.status === 'ok' && Number.isFinite(x.ms) && x.ms >= 0).map(x => x.ms).sort((a,b) => a-b);
 const counts = edges.map(() => 0);
 const timeoutCounts = edges.map(() => 0);
 const errorCounts = edges.map(() => 0);
 for (const row of results.filter(x => ['error','memory-limit','interrupted'].includes(x.status))) {
  if (Number.isFinite(row.ms) && row.ms >= 0) errorCounts[edges.findIndex(edge => row.ms < edge)]++;
 }
 for (const row of results.filter(x => x.status === 'timeout')) {
  const ms = Number.isFinite(row.ms) && row.ms >= 0 ? row.ms : 600000;
  timeoutCounts[edges.findIndex(edge => ms < edge)]++;
 }
 for (const ms of times) counts[edges.findIndex(edge => ms < edge)]++;
 const percentile = p => times.length ? times[Math.max(0, Math.ceil(p * times.length) - 1)] : null;
 return {labels, counts, timeoutCounts, errorCounts, count: times.length, median: times.length ? (times[Math.floor((times.length-1)/2)] + times[Math.floor(times.length/2)]) / 2 : null, p90: percentile(0.9)};
}
function histogram(run) {
 const data = distribution(run.results);
 const time = ms => ms == null ? '—' : ms < 1000 ? ms.toFixed(0) + ' ms' : ms < 60000 ? (ms/1000).toFixed(1) + ' s' : (ms/60000).toFixed(1) + ' min';
 const max = Math.max(1, ...data.counts.map((n,i) => n + data.timeoutCounts[i] + data.errorCounts[i]));
 const bars = data.counts.map((n,i) => {
  const x = 55 + i * 91, height = n / max * 170;
  const timeouts = data.timeoutCounts[i], errors = data.errorCounts[i];
  const redHeight = (timeouts + errors) / max * 170;
  const count = n + timeouts + errors;
  return `<rect x="${x}" y="${205-height}" width="65" height="${height}" rx="4" fill="#70b8ee"><title>${data.labels[i]}: ${n} successful demos</title></rect><rect x="${x}" y="${205-height-redHeight}" width="65" height="${redHeight}" rx="4" fill="#ff9696"><title>${data.labels[i]}: ${errors} errors, ${timeouts} timeouts</title></rect><text x="${x+32.5}" y="${195-height-redHeight}" text-anchor="middle" fill="#dae2ef" font-size="16">${count || ''}</text><text x="${x+32.5}" y="232" text-anchor="middle" fill="#aabbd2" font-size="13">${data.labels[i]}</text>`;
 }).join('');
 const timeouts = run.results.filter(x => x.status === 'timeout').length;
 const errors = run.results.filter(x => ['error','memory-limit','interrupted'].includes(x.status)).length;
 return `<section id="distribution"><h2>Execution time distribution</h2><p><strong>Median ${time(data.median)}</strong> · 90% of successful demos finish within <strong>${time(data.p90)}</strong></p><svg viewBox="0 0 1000 265" role="img" aria-label="Distribution of demo execution times including errors and timeouts" style="width:100%;max-height:320px"><text x="55" y="18" fill="#9eacc0" font-size="14">Number of demos</text><line x1="45" y1="205" x2="965" y2="205" stroke="#475569"/>${bars}<text x="500" y="260" text-anchor="middle" fill="#9eacc0" font-size="14">Execution time · fixed time buckets</text></svg><small>${data.count} successful demos · ${run.results.length}/${run.total} processed · ${timeouts} timeouts · ${errors} errors. <span style="color:#70b8ee">Blue: successful</span> · <span style="color:#ff9696">Red: errors / timeouts</span>. Median and percentile use successful runs. This overview covers the whole run, regardless of table filters.</small></section>`;
}
export function render(run, previous) {
 const json = x => JSON.stringify(x).replaceAll('<', '\\u003c');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rank nightly benchmarks</title>
<style>
:root{font:15px system-ui;color:#dae2ef;background:#101722}body{max-width:1400px;margin:auto;padding:28px}h1{font-size:30px;margin-bottom:8px}a{color:#8cc8ff}small,.muted{color:#9eacc0}header{border-bottom:1px solid #334155;padding-bottom:22px}.cards{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.card{background:#1b2636;padding:16px 24px;border-radius:10px}.card strong{display:block;font-size:25px}input,select,button{font:inherit;color:inherit;background:#1b2636;border:1px solid #475569;padding:8px;border-radius:5px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:9px;border-bottom:1px solid #2b3749}th{cursor:pointer;color:#aabbd2}td.num{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#ff9696}.good{color:#80dfb1}details{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;font:12px monospace}svg{vertical-align:middle}.tools{display:flex;gap:12px;flex-wrap:wrap}#detail{background:#1b2636;padding:18px;margin-top:20px;border-radius:8px}tr:hover{background:#1b2636}code{font-size:13px}section{margin-top:28px}@media(max-width:750px){body{padding:12px}td,th{padding:7px;font-size:12px}.wide{display:none}}
</style><header><h1>Rank · nightly benchmarks</h1><p>${escape(run.host)} · ${escape(run.cpu)} · Node ${escape(run.node)}</p><p><a href="https://github.com/kmmbvnr/rank/commit/${escape(run.commit)}">${escape(run.commit.slice(0,12))}</a> ${escape(run.subject)}</p><small>${escape(run.started)} · <b>${escape(run.status)}</b> · updated ${escape(run.updated)}<br>${escape(run.method)} Timeout: ${run.timeoutMs / 60000} minutes per workload. JS heap: 4 GiB; Linux memory cap: 6 GiB (RSS fallback). Other host activity can affect timings.</small><p>${escape(run.current ? 'Running: ' + run.current : run.error || '')}</p><a href="latest.json">Latest JSON</a> · <a href="runs/">Run archive</a></header>
<p id="job" class="muted"></p><div class="cards" id="cards"></div>${histogram(run)}<div class="tools"><input id="query" placeholder="Filter demo path"><select id="status"><option value="">All statuses</option><option>ok</option><option>error</option><option>timeout</option><option>memory-limit</option><option>no-workload</option></select><select id="baseline"><option value="">Previous completed run</option></select><button onclick="location.reload()">Refresh</button></div>
<section><h2>Groups</h2><small>Change is the geometric mean of ratios for successful, matching workloads ≥100 ms in both runs. Positive means slower. Source/test changes are excluded; dependency or environment changes can still affect results.</small><table id="groups"></table></section>
<section><h2>Individual demos</h2><small>Click a demo for output and recent history. Single samples are noisy; startup imports are excluded. Click column titles to sort.</small><table><thead><tr><th data-sort="path">Demo</th><th data-sort="kind">Workload</th><th data-sort="status">Status</th><th data-sort="ms">Time ↓</th><th>Baseline</th><th>Change</th></tr></thead><tbody id="rows"></tbody></table><div id="detail" hidden></div></section>
<script>
const run=${json(run)}, initial=${json(previous || null)};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let baseline=initial, history=[], sort='ms', direction=-1;
const time=x=>x==null?'—':x<1000?x.toFixed(1)+' ms':x<60000?(x/1000).toFixed(2)+' s':(x/60000).toFixed(2)+' min';
const ratio=(a,b)=>baseline?.method===run.method&&baseline?.node===run.node&&baseline?.cpu===run.cpu&&a?.status==='ok'&&b?.status==='ok'&&a.workloadHash===b.workloadHash&&a.kind===b.kind&&a.ms>=100&&b.ms>=100?a.ms/b.ms:null;
const delta=x=>x==null?'—':((x-1)*100>=0?'+':'')+((x-1)*100).toFixed(1)+'%';
function paint(){
 const old=new Map((baseline?.results||[]).map(x=>[x.path,x]));
 const counts=Object.groupBy(run.results,x=>x.status);
 document.querySelector('#cards').innerHTML=[['Progress',run.results.length+'/'+run.total],['Passed',counts.ok?.length||0],['Timeouts',counts.timeout?.length||0],['Errors',(counts.error?.length||0)+(counts['memory-limit']?.length||0)]].map(([k,v])=>'<div class="card"><strong>'+v+'</strong>'+k+'</div>').join('');
 const grouped=Object.groupBy(run.results,x=>x.group);
 document.querySelector('#groups').innerHTML='<tr><th>Group</th><th>OK / total</th><th>Elapsed</th><th>Matched</th><th>Change</th></tr>'+Object.entries(grouped).sort().map(([name,rows])=>{const ratios=rows.map(x=>ratio(x,old.get(x.path))).filter(x=>x!=null);const r=ratios.length?Math.exp(ratios.reduce((n,x)=>n+Math.log(x),0)/ratios.length):null;return '<tr><td>'+esc(name)+'</td><td>'+rows.filter(x=>x.status==='ok').length+'/'+rows.length+'</td><td>'+time(rows.reduce((n,x)=>n+(x.ms||0),0))+'</td><td>'+ratios.length+'</td><td>'+delta(r)+'</td></tr>'}).join('');
 const query=document.querySelector('#query').value.toLowerCase(),status=document.querySelector('#status').value;
 const rows=run.results.filter(x=>x.path.toLowerCase().includes(query)&&(!status||x.status===status)).sort((a,b)=>direction*(typeof a[sort]==='string'?a[sort].localeCompare(b[sort]):(a[sort]||0)-(b[sort]||0)));
 document.querySelector('#rows').innerHTML=rows.map(x=>{const b=old.get(x.path),r=ratio(x,b);return '<tr><td><a href="#detail" data-path="'+esc(x.path)+'">'+esc(x.path.replace('demos/',''))+'</a></td><td>'+x.kind+'</td><td class="'+(x.status==='ok'?'good':'bad')+'">'+x.status+'</td><td class="num">'+time(x.ms)+'</td><td class="num">'+time(b?.ms)+'</td><td class="num '+(r>1.1?'bad':r<0.9&&r!=null?'good':'')+'">'+(b&&b.workloadHash!==x.workloadHash?'source changed':delta(r))+'</td></tr>'}).join('');
}
for(const id of ['query','status'])document.getElementById(id).addEventListener('input',paint);
document.querySelectorAll('[data-sort]').forEach(x=>x.onclick=()=>{direction=sort===x.dataset.sort?-direction:1;sort=x.dataset.sort;paint()});
document.querySelector('#baseline').onchange=async e=>{baseline=e.target.value?await fetch('runs/'+e.target.value+'.json').then(r=>r.json()):initial;paint()};
document.querySelector('#rows').onclick=async e=>{const path=e.target.dataset.path;if(!path)return;e.preventDefault();const row=run.results.find(x=>x.path===path);const panel=document.querySelector('#detail');panel.hidden=false;panel.innerHTML='<h3>'+esc(path)+'</h3><p>'+esc(row.workload)+' · '+time(row.ms)+'</p><pre>'+esc(row.log)+'</pre><p id="trend">Loading history…</p>';
 try {const samples=await Promise.all(history.filter(h=>h.method===run.method&&h.node===run.node&&h.cpu===run.cpu&&(h.status==='complete'||h.id===run.id)).slice(-20).map(async h=>{const data=await fetch('metrics/'+h.id+'.json').then(r=>r.json());return {id:h.id,commit:h.commit,row:data.find(x=>x.path===path)}}));const points=samples.map((x,i)=>({x:i,y:x.row?.status==='ok'?x.row.ms:null})).filter(x=>x.y!=null);const max=Math.max(1,...points.map(x=>x.y));const coords=points.map(p=>(20+p.x*560/Math.max(1,samples.length-1)).toFixed(1)+','+(140-p.y/max*120).toFixed(1)).join(' ');const chart='<svg viewBox="0 0 600 160" style="max-width:600px;width:100%" role="img" aria-label="Recent execution times"><line x1="20" y1="140" x2="580" y2="140" stroke="#475569"/><polyline points="'+coords+'" fill="none" stroke="#8cc8ff" stroke-width="3"/>'+points.map(p=>'<circle cx="'+(20+p.x*560/Math.max(1,samples.length-1))+'" cy="'+(140-p.y/max*120)+'" r="4" fill="#80dfb1"/>').join('')+'</svg><br>';document.querySelector('#trend').innerHTML=chart+samples.map(x=>'<span title="'+esc(x.commit)+'">'+esc(x.id.slice(0,10))+': '+time(x.row?.ms)+' ('+esc(x.row?.status||'missing')+')</span>').join('<br>')}catch{document.querySelector('#trend').textContent='History unavailable';}};
fetch('history.json').then(r=>r.json()).then(data=>{history=data;document.querySelector('#baseline').innerHTML+=[...data].reverse().filter(x=>x.id!==run.id&&x.status==='complete'&&x.method===run.method&&x.node===run.node&&x.cpu===run.cpu).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.id.slice(0,19))+' · '+esc(x.commit.slice(0,8))+'</option>').join('')}).catch(()=>{});
fetch('job.json').then(r=>r.json()).then(x=>{document.querySelector('#job').textContent='Nightly job: '+(x.phase||('exit '+x.exitCode))+' · '+(x.updated||x.finished)}).catch(()=>{});
paint();
</script></html>`;
}
