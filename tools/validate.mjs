import fs from 'node:fs';

const file=process.argv[2] || new URL('../data/questions.json', import.meta.url).pathname;
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const errors=[];
const seenQ=new Set();
const setIds=new Set((data.sets||[]).map(s=>s.id));
const allowedSubjects=new Set(['quants','reasoning']);

for(const q of data.questions||[]){
  if(seenQ.has(q.id)) errors.push(`Duplicate question id: ${q.id}`);
  seenQ.add(q.id);
  for(const key of ['id','subject','subcategory','questionHtml','options','correctOption','solution']) if(q[key]===undefined) errors.push(`${q.id}: missing ${key}`);
  if(!allowedSubjects.has(q.subject)) errors.push(`${q.id}: invalid subject ${q.subject}`);
  if(q.setId && !setIds.has(q.setId)) errors.push(`${q.id}: unknown setId ${q.setId}`);
  if(!Array.isArray(q.options) || q.options.length<2) errors.push(`${q.id}: options missing/too short`);
  if(Array.isArray(q.options) && !q.options.some(o=>o.id===q.correctOption)) errors.push(`${q.id}: correctOption ${q.correctOption} not found in options`);
  if(!q.solution || !q.solution.finalAnswer) errors.push(`${q.id}: solution.finalAnswer missing`);
  if(!Array.isArray(q.solution?.steps) || q.solution.steps.length===0) errors.push(`${q.id}: solution.steps missing`);
}
for(const subject of ['quants','reasoning']){
  const order=data.subcategoryOrder?.[subject]||[];
  const found=new Set((data.questions||[]).filter(q=>q.subject===subject).map(q=>q.subcategory));
  for(const s of found) if(!order.includes(s)) errors.push(`${subject}: subcategory '${s}' is missing from subcategoryOrder`);
}
if(errors.length){
  console.error('Validation failed:\n'+errors.map(x=>' - '+x).join('\n'));
  process.exit(1);
}
console.log(`OK — ${data.questions.length} questions, ${(data.sets||[]).length} shared sets, dataset ${data.datasetVersion}`);
