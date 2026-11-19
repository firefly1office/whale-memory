import { randomInt, randomUUID } from 'node:crypto'
const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }
export function blindStudy(cases, rows) {
  const assignments = shuffle(cases.map((_, i) => i < Math.ceil(cases.length / 2)))
  const key = [], cards = []
  cases.forEach((item, i) => {
    const id = randomUUID()
    const arms = assignments[i] ? ['baseline', 'rhythm'] : ['rhythm', 'baseline']
    const options = arms.map(arm => {
      const row = rows.find(r => r.id === item.id && r.arm === arm)
      return row?.output ? { action: row.output.action, text: row.output.text } : { action: 'error', text: '（生成失败，无法比较）' }
    })
    cards.push({ id, persona: item.persona, context: item.context, state: item.state, text: item.text, options })
    key.push({ id, caseId: item.id, A: arms[0], B: arms[1] })
  })
  return { cards: shuffle(cards), key }
}

export function htmlFor(cards) {
  // Escape script delimiters and all dynamic display via textContent, never HTML.
  const data = JSON.stringify(cards).replaceAll('<', '\\u003c')
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>文字聊天盲评</title>
<style>body{font:16px/1.7 system-ui;background:#f5f5f2;color:#222;max-width:850px;margin:36px auto;padding:20px}article{background:white;padding:24px;margin:24px 0;border-radius:12px}pre{white-space:pre-wrap;font:inherit}label{margin-right:14px;display:inline-block}button{padding:12px 24px;cursor:pointer}h2{font-size:18px}small{color:#555}</style>
<h1>文字聊天盲评</h1><p>这些是虚构场景。请看同一段上下文后的两份回复，判断哪份更像 AI，以及哪份更贴合场景。允许选相近或无法判断；简短不必然更好。未发送消息是有效选项。页面不展示实验分组。</p><small>每位评阅者独立填写，完成后导出 JSON。此页面不联网，不含分组答案；刷新会清空未导出的选择。</small><main id="cards"></main><button id="export">导出我的评阅</button><p id="status"></p>
<script type="application/json" id="data">${data}</script><script>
const cards=JSON.parse(document.getElementById('data').textContent);
const add=(parent,tag,text)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e};
for(const [i,c] of cards.entries()){
 const a=add(document.getElementById('cards'),'article','');add(a,'h2','第 '+(i+1)+' 组');
 add(a,'small',c.persona);add(a,'pre',[...c.context,...Object.values(c.state),'朋友：'+c.text].join('\\n'));
 for(const [j,o] of c.options.entries())add(a,'pre',(j?'B':'A')+'：'+(o.action==='silent'?'（未发送消息）':o.text));
 for(const [field,title] of [['aiLike','哪份更像 AI？'],['fit','哪份更贴合场景？']]){
  add(a,'p',title);
  for(const [value,label] of [['A','A'],['B','B'],['tie','相近'],['unsure','无法判断']]){
   const l=add(a,'label','');const input=document.createElement('input');input.type='radio';input.name=c.id+':'+field;input.value=value;l.append(input,document.createTextNode(label));
  }
 }
}
document.getElementById('export').onclick=()=>{
 const ratings=cards.map(c=>({id:c.id,...Object.fromEntries(['aiLike','fit'].map(f=>[f,document.querySelector('input[name="'+c.id+':'+f+'"]:checked')?.value||null]))}));
 const blob=new Blob([JSON.stringify({schema:1,reviewerId:crypto.randomUUID(),ratings},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rhythm-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 document.getElementById('status').textContent='已导出。未回答的项目保留为空，不计作偏好。';
};</script></html>`
}
