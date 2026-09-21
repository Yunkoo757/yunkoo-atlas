const root = document.querySelector('#app');
const errorBox = document.querySelector('#error');
let trainings = [], selected = null, view = 'list', busy = false;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function error(message) {
  errorBox.hidden = !message;
  errorBox.innerHTML = message ? `${escape(message)} <button id="retry">重试</button>` : '';
  errorBox.querySelector('button')?.addEventListener('click', () => refresh());
  if (message) errorBox.scrollIntoView({ block:'nearest' });
}
async function request(operation) {
  if (busy) return null;
  busy = true; root.setAttribute('aria-busy', 'true');
  const buttons = [...root.querySelectorAll('button')].map(button => [button, button.disabled]);
  buttons.forEach(([button]) => button.disabled = true);
  try {
    const result = await operation();
    if (result.error) { error(result.error); return null; }
    trainings = result.trainings; error(''); return result;
  } catch { error('无法连接记录服务，请关闭并重新打开工具。'); return null; }
  finally { busy = false; root.setAttribute('aria-busy', 'false'); buttons.forEach(([button, disabled]) => button.disabled = disabled); }
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motion = (node, frames, duration) => {
  if (!node || reducedMotion.matches) return;
  const styles = getComputedStyle(document.documentElement);
  node.getAnimations().forEach(animation => animation.cancel());
  return node.animate(frames, { duration: parseFloat(styles.getPropertyValue(duration)), easing: styles.getPropertyValue('--ease-out').trim() });
};
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) document.getAnimations().forEach(animation => animation.cancel());
});
let renderedKey = null;
function render() {
  const key = view + ':' + (view === 'detail' ? selected : '');
  const samePage = key === renderedKey;
  const oldTotal = Number(root.querySelector('.count-value')?.textContent);
  const oldRatio = Number(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) / Number(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax'));
  const expanded = [...root.querySelectorAll('details[open]')].map(node => node.id);
  renderContent();
  renderedKey = key;
  if (!samePage) motion(root, [{ opacity:0, transform:'translateY(4px)' }, { opacity:1, transform:'translateY(0)' }], '--motion-dialog-in');
  else {
    expanded.forEach(id => { const node = document.getElementById(id); if (node) node.open = true; });
    const value = root.querySelector('.count-value');
    if (value && Number(value.textContent) > oldTotal) {
      motion(value, [{ opacity:0.4, transform:'translateY(3px)' }, { opacity:1, transform:'translateY(0)' }], '--motion-panel');
      motion(root.querySelector('.today-value'), [{ opacity:0.5 }, { opacity:1 }], '--motion-panel');
      const progress = root.querySelector('[role="progressbar"]');
      const ratio = Number(progress.getAttribute('aria-valuenow')) / Number(progress.getAttribute('aria-valuemax'));
      motion(progress.firstElementChild, [{ transform:`scaleX(${oldRatio || 0})` }, { transform:`scaleX(${ratio})` }], '--motion-panel');
    }
  }
}
function renderContent() {
  if (view === 'create') return renderForm();
  const training = trainings.find(t => t.id === selected);
  if (view === 'detail' && training) return renderTraining(training);
  view = 'list';
  root.innerHTML = `<div class="stack"><div class="row"><h1>训练</h1><button id="new" ${trainings.length ? '' : 'class="primary"'}>新建训练</button></div>${trainings.length ? `<div class="list">${trainings.map(t => `<button class="training" data-id="${t.id}"><span class="training-name">${escape(t.name)}</span><span class="training-count">${t.total} / ${t.target}${t.finished ? ' · 已完成' : ''}</span></button>`).join('')}</div>` : '<div class="section tight"><p>完成你承诺的次数。</p><p class="metadata">定义一个训练，设定总次数和每日最低量。</p></div>'}</div>`;
  document.querySelector('#new').onclick = () => { view = 'create'; render(); };
  root.querySelectorAll('[data-id]').forEach(button => button.onclick = () => { selected = button.dataset.id; view = 'detail'; render(); document.querySelector('#complete')?.focus(); });
}
function renderForm() {
  root.innerHTML = `<div class="stack"><h1>新建训练</h1><form novalidate><label>训练名称<input id="name" maxlength="80" required placeholder="例如：复盘" aria-describedby="name-error"><span class="field-error" id="name-error"></span></label><div class="number-fields"><label>总次数<input id="target" type="number" min="1" max="100000" step="1" value="100" required aria-describedby="target-error"><span class="field-error" id="target-error"></span></label><label>每日最低量<input id="daily" type="number" min="1" step="1" value="3" required aria-describedby="daily-error"><span class="field-error" id="daily-error"></span></label></div><p class="metadata">从今天开始。创建后目标固定，完成记录不可撤销或删除。最后一天完成剩余次数即达标。</p><div class="actions"><button type="submit" class="primary">创建训练</button><button id="cancel" type="button">取消</button></div></form></div>`;
  document.querySelector('#name').focus();
  document.querySelector('#cancel').onclick = () => { view = selected ? 'detail' : 'list'; render(); };
  const form = root.querySelector('form');
  form.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const input = { name: form.querySelector('#name').value.trim(), target: Number(form.querySelector('#target').value), daily: Number(form.querySelector('#daily').value) };
    const issues = { name: !input.name ? '请输入训练名称。' : '', target: !Number.isSafeInteger(input.target) || input.target < 1 || input.target > 100000 ? '请输入 1–100000 的整数。' : '', daily: !Number.isSafeInteger(input.daily) || input.daily < 1 || input.daily > input.target ? '请输入 1 到总次数之间的整数。' : '' };
    for (const [key, text] of Object.entries(issues)) { form.querySelector(`#${key}-error`).textContent = text; form.querySelector(`#${key}`).setAttribute('aria-invalid', String(Boolean(text))); }
    const first = Object.keys(issues).find(key => issues[key]);
    if (first) { form.querySelector(`#${first}`).focus(); return; }
    const result = await request(() => window.trainer.create(input));
    if (result) { selected = result.selected; view = 'detail'; render(); document.querySelector('#complete')?.focus(); }
  };
}
function renderTraining(t) {
  const today = t.today;
  const markup = `<div class="stack"><div class="row heading"><h1>${escape(t.name)}</h1><button class="ghost" id="back" aria-label="所有训练">训练 ↗</button></div><div class="tight"><div class="counter" aria-live="polite"><strong class="count-value">${t.total}</strong> <span>/ ${t.target}</span></div><div class="progress" role="progressbar" aria-valuenow="${t.total}" aria-valuemin="0" aria-valuemax="${t.target}" aria-label="训练总进度"><i></i></div></div><section class="stack"><div class="row"><span class="metadata">${t.finished ? '训练完成' : '今日'}</span><span class="today-value">${today ? `${today.actual} / ${today.minimum}` : 'DONE'}${today?.status === 'DONE' ? '<span class="status"> · DONE</span>' : ''}</span></div><button class="primary complete" id="complete" ${t.finished ? 'disabled' : ''}>${t.finished ? '全部完成' : '完成一次'}</button></section><div class="row stats metadata"><span>第 ${t.days.length} 天</span><span>${t.settledDays ? `${t.completedDays} / ${t.settledDays} 天达标` : '今日尚未结算'}</span></div><details id="history"><summary>记录</summary><div class="tight"><p class="metadata">剩余 ${t.remaining} 次 · ${escape(t.zone)}<br>未结束的当天不计入完成率；训练完成时立即结算。</p>${[...t.days].reverse().map(d => `<div class="day"><span>${d.day}</span><span>${d.actual} / ${d.minimum}</span><span class="status">${d.status}</span></div>`).join('')}<details id="timestamps"><summary>完成时间 · ${t.total} 次</summary>${t.records.length ? [...t.records].reverse().map((r, i) => `<div class="row record metadata"><span>#${t.total - i}</span><time>${escape(new Intl.DateTimeFormat('zh-CN', { timeZone:t.zone, dateStyle:'medium', timeStyle:'medium', hour12:false }).format(new Date(r.at)))}</time></div>`).join('') : '<p class="metadata">还没有完成记录。</p>'}</details></div></details></div>`;
  if (root.dataset.training === t.id && root.querySelector('#complete')) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    const updated = template.content;
    root.querySelector('.counter').parentElement.replaceWith(updated.querySelector('.counter').parentElement);
    root.querySelector('section .row').replaceWith(updated.querySelector('section .row'));
    const button = root.querySelector('#complete');
    button.textContent = t.finished ? '全部完成' : '完成一次';
    button.disabled = t.finished;
    root.querySelector('.stats').replaceWith(updated.querySelector('.stats'));
    root.querySelector('#history').replaceWith(updated.querySelector('#history'));
  } else root.innerHTML = markup;
  root.dataset.training = t.id;
  root.querySelector('.progress i').style.transform = `scaleX(${t.total / t.target})`;
  document.querySelector('#back').onclick = () => { view = 'list'; render(); document.querySelector('#new').focus(); };
  document.querySelector('#complete').onclick = () => {
    if (t.finished) return;
    completionQueue.push(t.id);
    drainCompletions();
  };
  document.querySelector('#complete').onkeydown = event => { if (event.repeat) event.preventDefault(); };
}
const completionQueue = [];
let completing = false;
async function drainCompletions() {
  if (completing) return;
  completing = true;
  try {
    while (completionQueue.length) {
      const id = completionQueue.shift();
      if (trainings.find(t => t.id === id)?.finished) continue;
      const result = await window.trainer.complete(id);
      if (result.error) {
        completionQueue.length = 0;
        error(result.error + ' 后续排队点击已停止，请检查后重新点击。');
        break;
      }
      trainings = result.trainings;
      error('');
      if (view !== 'create') render();
    }
  } catch {
    completionQueue.length = 0;
    error('保存连接中断，请重新打开工具核对进度后继续。');
  } finally { completing = false; }
}
async function refresh() {
  if (busy || completing) return;
  const before = JSON.stringify(trainings);
  const focused = document.activeElement?.id;
  const expanded = [...root.querySelectorAll('details[open]')].map(d => d.id);
  const result = await request(() => window.trainer.list());
  if (result) {
    if (view === 'create') return;
    if (before === JSON.stringify(trainings) && root.innerHTML) return;
    if (!selected && trainings.length === 1) { selected = trainings[0].id; view = 'detail'; }
    render(); expanded.forEach(id => { const node = document.getElementById(id); if (node) node.open = true; });
    if (focused && document.activeElement === document.body) document.getElementById(focused)?.focus();
  }
}
document.querySelector('#minimize').onclick = () => window.trainer.windowAction('minimize');
document.querySelector('#close-window').onclick = async () => {
  while (completing) await new Promise(resolve => setTimeout(resolve, 10));
  window.trainer.windowAction('close');
};
await refresh();
setInterval(refresh, 30000);
window.addEventListener('focus', refresh);
