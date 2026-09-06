import { lessons, lessonGroups } from './content.js';
import {
  maintenanceOptions,
  searchIndex,
  shortcutRows,
  sourceCards,
  teachingStats,
  teachingTrade,
} from './data.js';
import { icon } from './icons.js';

const root = document.querySelector('#app');
const STORAGE_KEY = 'atlas-teaching-progress-v1';

if (!root) {
  throw new Error('Atlas 教学站缺少 #app 根节点');
}

let toast = null;
let toastTimer = 0;

const defaultState = () => ({
  lessonId: 'orientation',
  stepIndex: 0,
  completedLessons: [],
  lessonProgress: {},
  platform: detectPlatform(),
  quizSelection: null,
  quizCorrect: false,
  quizIncorrect: false,
  actionState: 'idle',
  demo: {
    intent: null,
    record: {
      instrument: null,
      direction: null,
      status: null,
      strategy: null,
    },
    detail: {
      attributes: false,
      summary: '',
      supplemental: false,
    },
    review: {
      fact: '',
      action: '',
      completed: false,
      rating: null,
    },
    case: {
      added: false,
      sourceViewed: false,
    },
    statsScope: null,
    source: null,
    maintenance: null,
    shortcut: {
      platform: null,
      opened: false,
    },
  },
});

let state = loadState();
let searchOpen = false;
let resetOpen = false;
let searchQuery = '';

function detectPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'macos' : 'windows';
}

function mergeState(saved) {
  const initial = defaultState();
  if (!saved || typeof saved !== 'object') return initial;
  return {
    ...initial,
    ...saved,
    completedLessons: Array.isArray(saved.completedLessons) ? saved.completedLessons : [],
    lessonProgress: saved.lessonProgress && typeof saved.lessonProgress === 'object' ? saved.lessonProgress : {},
    demo: {
      ...initial.demo,
      ...(saved.demo ?? {}),
      record: { ...initial.demo.record, ...(saved.demo?.record ?? {}) },
      detail: { ...initial.demo.detail, ...(saved.demo?.detail ?? {}) },
      review: { ...initial.demo.review, ...(saved.demo?.review ?? {}) },
      case: { ...initial.demo.case, ...(saved.demo?.case ?? {}) },
      shortcut: { ...initial.demo.shortcut, ...(saved.demo?.shortcut ?? {}) },
    },
  };
}

function loadState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return mergeState(saved ? JSON.parse(saved) : null);
  } catch {
    return defaultState();
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 教学进度不是核心数据；存储不可用时仍允许完整浏览。
  }
}

function currentLesson() {
  return lessons.find((lesson) => lesson.id === state.lessonId) ?? lessons[0];
}

function currentStep() {
  const lesson = currentLesson();
  return lesson.steps[Math.min(state.stepIndex, lesson.steps.length - 1)];
}

function isComplete(lessonId) {
  return state.completedLessons.includes(lessonId);
}

function isUnlocked(lesson) {
  return lesson.prerequisite?.every((id) => isComplete(id)) ?? true;
}

function completedCount() {
  return state.completedLessons.length;
}

function progressPercent() {
  return Math.round((completedCount() / lessons.length) * 100);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function platformLabel(platform = state.platform) {
  return platform === 'macos' ? 'macOS' : 'Windows';
}

function modifierLabel(platform = state.platform) {
  return platform === 'macos' ? 'Command' : 'Ctrl';
}

function showToast(message, tone = 'neutral') {
  toast = { message, tone };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = null;
    render();
  }, 3200);
  render();
}

function markActionSuccess() {
  state.actionState = 'success';
  persist();
}

function resetTransientStepState() {
  state.quizSelection = null;
  state.quizCorrect = false;
  state.quizIncorrect = false;
  state.actionState = 'idle';
}

function isActionReady(step = currentStep()) {
  const demo = state.demo;
  switch (step.action) {
    case 'intent':
      return Boolean(demo.intent);
    case 'recordFields':
      return Object.values(demo.record).every(Boolean);
    case 'detailFields':
      return Boolean(demo.detail.attributes && demo.detail.summary.trim() && demo.detail.supplemental);
    case 'reviewFields':
      return Boolean(demo.review.fact.trim() && demo.review.action.trim() && demo.review.completed);
    case 'caseLink':
      return Boolean(demo.case.added && demo.case.sourceViewed);
    case 'statsScope':
      return Boolean(demo.statsScope);
    case 'reviewRating':
      return Boolean(demo.review.rating);
    case 'sourceMapping':
      return Boolean(demo.source);
    case 'maintenanceChoice':
      return Boolean(demo.maintenance);
    case 'shortcutPractice':
      return Boolean(demo.shortcut.platform && demo.shortcut.opened);
    default:
      return true;
  }
}

function canAdvance(step = currentStep()) {
  if (step.type === 'operate') return isActionReady(step);
  if (step.type === 'quiz') return state.quizCorrect;
  return true;
}

function nextLessonAfterCurrent() {
  const index = lessons.findIndex((lesson) => lesson.id === state.lessonId);
  return lessons.slice(index + 1).find((lesson) => isUnlocked(lesson) && !isComplete(lesson.id))
    ?? lessons.slice(index + 1).find(isUnlocked)
    ?? lessons.find((lesson) => isUnlocked(lesson) && !isComplete(lesson.id));
}

function selectLesson(lessonId, { scroll = true } = {}) {
  const lesson = lessons.find((item) => item.id === lessonId);
  if (!lesson || !isUnlocked(lesson)) return;
  state.lessonId = lesson.id;
  state.stepIndex = Math.min(
    Number(state.lessonProgress[lesson.id] ?? 0),
    lesson.steps.length - 1,
  );
  resetTransientStepState();
  persist();
  render({ focusHeading: true });
  if (scroll) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

function completeCurrentLesson() {
  const lesson = currentLesson();
  if (!state.completedLessons.includes(lesson.id)) {
    state.completedLessons.push(lesson.id);
  }
  state.lessonProgress[lesson.id] = lesson.steps.length - 1;
  state.actionState = 'success';
  state.quizCorrect = true;
  persist();
  render.pendingFocusHeading = true;
  showToast(`已完成「${lesson.title}」`, 'success');
}

function advanceStep() {
  const lesson = currentLesson();
  const step = currentStep();
  if (!canAdvance(step)) {
    state.actionState = 'blocked';
    persist();
    showToast(step.type === 'quiz' ? '请先选择并验证正确答案。' : '请先完成右侧教练台提示的动作。', 'error');
    return;
  }
  if (state.stepIndex >= lesson.steps.length - 1) {
    completeCurrentLesson();
    return;
  }
  state.stepIndex += 1;
  state.lessonProgress[lesson.id] = state.stepIndex;
  resetTransientStepState();
  persist();
  render({ focusHeading: true });
}

function reviewCurrentLesson() {
  state.stepIndex = 0;
  state.lessonProgress[state.lessonId] = 0;
  state.completedLessons = state.completedLessons.filter((id) => id !== state.lessonId);
  resetTransientStepState();
  persist();
  render({ focusHeading: true });
}

function nextLesson() {
  const next = nextLessonAfterCurrent();
  if (!next) {
    showToast('全部教学章节已完成，可以从地图回看任意内容。', 'success');
    return;
  }
  selectLesson(next.id);
}

function render() {
  const lesson = currentLesson();
  const step = currentStep();
  document.title = `${lesson.title} · Atlas 教学站`;
  root.innerHTML = `
    <a class="skip-link" href="#lesson-main">跳到当前教学内容</a>
    ${renderTopbar()}
    <div class="site-layout">
      ${renderMap()}
      <main class="lesson-stage" id="lesson-main" tabindex="-1">
        ${renderLessonHeader(lesson)}
        ${renderStepProgress(lesson, step)}
        ${state.completedLessons.includes(lesson.id) ? renderCompletion(lesson) : renderCurrentStep(lesson, step)}
      </main>
      ${renderCoach(lesson, step)}
    </div>
    ${searchOpen ? renderSearchDialog() : ''}
    ${resetOpen ? renderResetDialog() : ''}
    ${toast ? `<div class="toast-region" role="status" aria-live="polite"><div class="toast ${toast.tone === 'success' ? 'is-success' : toast.tone === 'error' ? 'is-error' : ''}">${escapeHtml(toast.message)}</div></div>` : ''}
  `;
  if (render.pendingFocusHeading) {
    window.requestAnimationFrame(() => {
      document.querySelector('#step-heading, #completion-heading')?.focus();
    });
    render.pendingFocusHeading = false;
  }
  updateInteractiveButtonState();
}

render.pendingFocusHeading = false;

function renderTopbar() {
  return `
    <header class="site-topbar">
      <div class="topbar-inner">
        <a class="brand-lockup" href="#lesson-main" aria-label="Atlas 教学站首页">
          <img class="brand-mark" src="./assets/favicon.svg" alt="">
          <span class="brand-name">Trader Atlas</span>
          <span class="brand-divider" aria-hidden="true"></span>
          <span class="brand-context">教学站</span>
        </a>
        <nav class="topbar-nav" aria-label="教学站导航">
          <a href="#learning-map">学习路径</a>
          <a href="#lesson-main">当前章节</a>
          <a href="#coach-rail">操作提示</a>
        </nav>
        <div class="topbar-actions">
          <button class="topbar-button" type="button" data-search-toggle aria-haspopup="dialog" aria-expanded="${searchOpen}">
            ${icon('search', 'sm')}<span>搜索章节</span><span class="shortcut-hint">${modifierLabel()} K</span>
          </button>
          ${renderPlatformSwitch('topbar')}
        </div>
      </div>
    </header>
  `;
}

function renderPlatformSwitch(context = 'topbar') {
  return `
    <div class="platform-switch" aria-label="选择桌面平台" data-platform-switch="${context}">
      <span class="platform-label">${context === 'topbar' ? '平台' : '快捷键'}</span>
      <button class="platform-button" type="button" data-platform="windows" aria-pressed="${state.platform === 'windows'}">${icon('monitor', 'sm')}Win</button>
      <button class="platform-button" type="button" data-platform="macos" aria-pressed="${state.platform === 'macos'}">${icon('apple', 'sm')}Mac</button>
    </div>
  `;
}

function renderMap() {
  const renderGroup = (groupId) => {
    const group = lessonGroups.find((item) => item.id === groupId);
    const groupLessons = lessons.filter((lesson) => lesson.kind === groupId);
    return `
      <section class="map-section" aria-labelledby="map-${groupId}">
        <div class="map-section-title" id="map-${groupId}">
          <span>${group.label}</span><span>${groupId === 'main' ? '闭环' : '可选'}</span>
        </div>
        <ol class="map-list">
          ${groupLessons.map(renderMapItem).join('')}
        </ol>
        ${groupId === 'branch' ? '<p class="map-branch-note">完成相关主线后解锁。分支可按自己的工作流回看。</p>' : ''}
      </section>
    `;
  };

  return `
    <aside class="learning-map" id="learning-map" aria-label="学习路径">
      <div class="map-header">
        <div class="map-header-row">
          <div><div class="map-kicker">Atlas / path</div><h2 class="map-title">学习路径</h2></div>
          <span class="map-progress">${completedCount()} / ${lessons.length}</span>
        </div>
        <div class="map-progress-bar" aria-label="总体完成进度"><span style="width:${progressPercent()}%"></span></div>
      </div>
      ${renderGroup('main')}
      ${renderGroup('branch')}
      <div class="map-footer">
        <p class="map-footer-copy">进度只保存在当前浏览器的教学状态里，不会读取或上传你的真实交易数据。</p>
        <button class="map-action" type="button" data-reset>重新开始教学</button>
      </div>
    </aside>
  `;
}

function renderMapItem(lesson) {
  const locked = !isUnlocked(lesson);
  const complete = isComplete(lesson.id);
  const active = state.lessonId === lesson.id;
  const status = complete ? icon('check', 'sm') : locked ? icon('lock', 'sm') : '';
  const lockedReason = lesson.prerequisite?.length
    ? `完成 ${lesson.prerequisite.map((id) => lessons.find((item) => item.id === id)?.title ?? id).join('、')} 后解锁`
    : '';
  return `
    <li class="map-item ${complete ? 'is-complete' : ''} ${locked ? 'is-locked' : ''}">
      <button class="map-button" type="button" data-lesson="${lesson.id}" ${active ? 'aria-current="step"' : ''} ${locked ? 'disabled' : ''} ${lockedReason ? `title="${escapeHtml(lockedReason)}"` : ''}>
        <span class="map-number">${lesson.number}</span>
        <span class="map-label">${lesson.navLabel}</span>
        <span class="map-status">${status}</span>
      </button>
    </li>
  `;
}

function renderLessonHeader(lesson) {
  return `
    <header class="lesson-header">
      <div class="lesson-heading-row">
        <div>
          <div class="lesson-kicker">${lesson.eyebrow}</div>
          <h1 class="lesson-title">${lesson.title}</h1>
          <p class="lesson-objective">${lesson.objective}</p>
          <div class="topic-row">${lesson.tags.map((tag) => `<span class="topic">${tag}</span>`).join('')}<span class="data-badge">教学数据</span></div>
        </div>
        <span class="platform-badge">${icon(state.platform === 'macos' ? 'apple' : 'monitor', 'sm')} ${platformLabel()}</span>
      </div>
    </header>
  `;
}

function renderStepProgress(lesson, step) {
  return `
    <div class="step-progress" aria-label="本节步骤">
      ${lesson.steps.map((item, index) => {
        const current = item.id === step.id;
        const done = index < state.stepIndex || isComplete(lesson.id);
        return `<span class="step-pill ${current ? 'is-current' : ''} ${done ? 'is-done' : ''}"><span class="step-pill-number">${index + 1}</span>${item.type === 'quiz' ? '确认' : item.type === 'observe' ? '观察' : item.type === 'operate' ? '操作' : '理解'}</span>`;
      }).join('')}
    </div>
  `;
}

function renderCurrentStep(lesson, step) {
  return `
    <div class="lesson-main-stack">
      <section class="lesson-panel" aria-labelledby="step-heading">
        <div class="lesson-panel-header">
          <div class="lesson-heading-row">
            <div>
              <div class="eyebrow">${step.eyebrow}</div>
              <h2 class="step-heading" id="step-heading" tabindex="-1">${step.title}</h2>
              ${step.summary ? `<p class="step-summary">${step.summary}</p>` : ''}
            </div>
            <span class="status-chip">${step.type === 'quiz' ? '理解确认' : step.type === 'operate' ? '跟着做' : step.type === 'understand' ? '概念整理' : '先观察'}</span>
          </div>
        </div>
        <div class="lesson-panel-body">
          <div class="copy-stack">${(step.body ?? []).map((paragraph) => `<p>${paragraph}</p>`).join('')}</div>
          ${step.facts ? `<ul class="fact-list">${step.facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>` : ''}
          ${step.prompt ? `<div class="inset-note"><strong>${step.prompt}</strong></div>` : ''}
          ${step.type === 'quiz' ? renderQuiz(step) : ''}
          ${step.type !== 'quiz' ? renderStepDemo(lesson, step) : ''}
          ${renderStepFeedback(step)}
          ${renderLessonFooter(step)}
        </div>
      </section>
    </div>
  `;
}

function renderLessonFooter(step) {
  const label = step.type === 'observe'
    ? step.actionLabel ?? '开始练习'
    : step.type === 'understand'
      ? step.actionLabel ?? '我明白了'
      : step.type === 'quiz'
        ? state.quizCorrect ? step.actionLabel ?? '继续' : '等待确认'
        : '继续';
  const disabled = !canAdvance(step);
  const hint = step.type === 'operate'
    ? disabled ? '完成右侧示例动作后继续。' : '动作已完成，可以进入下一步。'
    : step.type === 'quiz'
      ? state.quizCorrect ? '答案已确认，可以继续。' : '先选择答案并点击“验证答案”。'
      : '每一步都可以回到左侧地图重新查看。';
  return `
    <div class="lesson-footer">
      <p class="footer-hint">${hint}</p>
      <button class="next-button" type="button" data-next ${disabled ? 'disabled' : ''}>${label} ${icon('arrow', 'sm')}</button>
    </div>
  `;
}

function renderStepFeedback(step) {
  if (step.type === 'operate' && state.actionState === 'success') {
    return `<div class="success-note" role="status">${step.success ?? '动作已完成。继续往下，你会看到它为什么重要。'}</div>`;
  }
  if (state.actionState === 'blocked') {
    return `<div class="blocked-note" role="status">请先完成当前步骤要求的动作，再继续学习。</div>`;
  }
  return '';
}

function renderQuiz(step) {
  return `
    <section class="quiz-panel" aria-labelledby="quiz-question">
      <div class="quiz-header">
        <div class="quiz-kicker">单选判断</div>
        <h3 class="quiz-title" id="quiz-question">${step.question}</h3>
      </div>
      <div class="quiz-body">
        <div class="quiz-options" role="radiogroup" aria-label="答案选项">
          ${step.options.map((option) => {
            const selected = state.quizSelection === option.value;
            const correct = state.quizCorrect && option.correct;
            const wrong = state.quizIncorrect && selected && !option.correct;
            return `<button class="quiz-option ${selected ? 'is-selected' : ''} ${correct ? 'is-correct' : ''} ${wrong ? 'is-wrong' : ''}" type="button" data-quiz-option="${option.value}" role="radio" aria-checked="${selected}"><span class="quiz-radio" aria-hidden="true"></span><span>${option.label}</span></button>`;
          }).join('')}
        </div>
        ${state.quizIncorrect ? '<div class="blocked-note" role="alert">这个选择还没有对齐当前章节的核心概念，再看一眼选项说明。</div>' : ''}
        ${state.quizCorrect ? `<div class="success-note" role="status">${step.explanation}</div>` : ''}
        <div class="demo-actions"><button class="secondary-button" type="button" data-quiz-submit ${!state.quizSelection || state.quizCorrect ? 'disabled' : ''}>验证答案</button></div>
      </div>
    </section>
  `;
}

function renderStepDemo(lesson, step) {
  const demo = step.type === 'operate'
    ? renderInteractiveDemo(step.action)
    : step.type === 'understand'
      ? renderStaticDemo(step.demo)
      : step.screenshot
        ? renderScreenshot(step.screenshot, step.caption)
        : renderStaticDemo(step.demo);
  return `<section class="demo-surface" aria-label="${lesson.title}示例工作台"><div class="demo-header"><div class="demo-heading-row"><div><div class="demo-kicker">Atlas 示例工作台</div><h3 class="demo-title">${step.type === 'operate' ? '现在试试' : '看见它在产品里怎样出现'}</h3><p class="demo-subtitle">${step.type === 'operate' ? '这是教学数据，不会写入真实 Atlas。' : '示例只展示概念关系，不代表当前账户数据。'}</p></div><span class="data-badge">只读示例</span></div></div><div class="demo-body">${demo}</div></section>`;
}

function renderScreenshot(src, caption) {
  return `<figure class="screenshot-figure"><img src="${src}" alt="Atlas 产品界面示例" loading="lazy"><figcaption class="figure-caption">${icon('help', 'sm')}${caption ?? 'Atlas 产品实景截图。'}</figcaption></figure>`;
}

function renderStaticDemo(kind) {
  switch (kind) {
    case 'atlas-shell':
      return renderMockShell('交易日志', ['交易日志', '统计分析', '周期复盘', '案例库', '随机复盘'], '交易日志');
    case 'record-list':
      return renderMockShell('交易日志 · 新记录', ['交易日志', '进行中', '星标交易', '错过机会', '模拟盘'], '进行中', '<div class="mock-list"><div class="mock-list-row"><span><strong>BTCUSDT</strong><small> 计划中 · 4H</small></span><span>QA 自动化</span><span class="mock-number">—</span></div><div class="mock-list-row"><span><strong>先记录事实</strong><small> 教学交易</small></span><span>待补充</span><span class="mock-number">01</span></div></div>');
    case 'record-state':
      return `<div class="mock-list"><div class="mock-list-row"><span><strong>${teachingTrade.symbol}</strong><small> ${teachingTrade.direction}</small></span><span><span class="data-badge">${teachingTrade.status}</span></span><span class="mock-number">${teachingTrade.timeframe}</span></div><div class="inset-note">状态说明：这条记录仍在工作流里，尚未代表复盘完成。</div></div>`;
    case 'flow':
      return `<div class="flow-grid"><div class="flow-card"><span>01 · 事实</span><strong>${teachingTrade.symbol}</strong><small>方向、状态、策略</small></div><div class="flow-card"><span>02 · 判断</span><strong>复盘正文</strong><small>解释发生了什么</small></div><div class="flow-card"><span>03 · 沉淀</span><strong>案例库</strong><small>保留来源关系</small></div></div>`;
    case 'detail-roles':
      return `<div class="mock-list"><div class="mock-property-row"><span><strong>事实摘要</strong><small> 当时看到的信号</small></span><span>盘面摘要</span><span>${icon('list', 'sm')}</span></div><div class="mock-property-row"><span><strong>复盘判断</strong><small> 你如何解释它</small></span><span>正文</span><span>${icon('note', 'sm')}</span></div><div class="mock-property-row"><span><strong>证据截图</strong><small> 保留当时画面</small></span><span>附件</span><span>${icon('case', 'sm')}</span></div></div>`;
    case 'review-editor':
      return `<div class="mock-list"><div class="mock-setting-row"><span><strong>事实</strong><small>只描述发生了什么</small></span><span>我在突破确认前提前入场</span><span>${icon('note', 'sm')}</span></div><div class="mock-setting-row"><span><strong>下一次动作</strong><small>必须能够执行</small></span><span>等待收盘确认再入场</span><span>${icon('target', 'sm')}</span></div></div>`;
    case 'review-state':
      return `<div class="mock-list"><div class="mock-list-row"><span><strong>复盘状态</strong><small>工作流位置</small></span><span class="scope-badge live">已复盘</span><span>${icon('check', 'sm')}</span></div><div class="mock-list-row"><span><strong>交易结果</strong><small>事实结果</small></span><span>—</span><span>${icon('chart', 'sm')}</span></div></div>`;
    case 'case-roles':
      return `<div class="mock-list"><div class="mock-source-row"><span><strong>案例：突破确认前的提前入场</strong><small>高价值复盘</small></span><span>案例库</span><span>${icon('case', 'sm')}</span></div><div class="mock-source-row"><span><strong>来源：${teachingTrade.ref}</strong><small>原始交易记录</small></span><span>可返回</span><span>${icon('arrow', 'sm')}</span></div></div>`;
    case 'stats-reading':
      return renderStatsPanel(state.demo.statsScope ?? 'live');
    case 'review-loop':
      return `<div class="mock-list"><div class="mock-list-row"><span><strong>周复盘</strong><small>本周反复出现的模式</small></span><span>模式总结</span><span>${icon('calendar', 'sm')}</span></div><div class="mock-list-row"><span><strong>随机复盘</strong><small>单条旧交易</small></span><span>掌握度评估</span><span>${icon('rotate', 'sm')}</span></div></div>`;
    case 'source-rule':
      return renderSourceRules();
    case 'maintenance-rule':
      return renderMaintenanceRules();
    case 'settings-rule':
      return renderSettingsRules();
    default:
      return renderMockShell('Atlas 示例', ['记录', '复盘', '分析'], '记录');
  }
}

function renderMockShell(title, navItems, active, content = '') {
  return `<div class="mock-app"><div class="mock-sidebar"><div class="mock-sidebar-head">${icon('target', 'md')} Trader Atlas</div><div class="mock-sidebar-section">工作区</div>${navItems.map((item) => `<div class="mock-nav-item ${item === active ? 'is-active' : ''}"><span class="mock-nav-dot"></span>${item}</div>`).join('')}<div class="mock-sidebar-section">更多</div><div class="mock-nav-item"><span class="mock-nav-dot"></span>随记</div><div class="mock-nav-item"><span class="mock-nav-dot"></span>设置</div></div><div class="mock-content"><div class="mock-topbar"><span>${title}</span><span>${icon('command', 'sm')} ${modifierLabel()} K</span></div><div class="mock-content-body"><h4 class="mock-content-title">${title}</h4><p class="mock-content-description">示例界面保留 Atlas 的桌面信息层级。</p>${content || '<div class="mock-list"><div class="mock-list-row"><span><strong>先捕捉，再整理</strong><small>教学记录</small></span><span>进行中</span><span class="mock-number">01</span></div></div>'}</div></div></div>`;
}

function renderInteractiveDemo(action) {
  switch (action) {
    case 'intent':
      return renderIntentOptions();
    case 'recordFields':
      return renderRecordFields();
    case 'detailFields':
      return renderDetailFields();
    case 'reviewFields':
      return renderReviewFields();
    case 'caseLink':
      return renderCaseLink();
    case 'statsScope':
      return renderStatsPanel(state.demo.statsScope ?? 'live', true);
    case 'reviewRating':
      return renderReviewRating();
    case 'sourceMapping':
      return renderSourceChoices();
    case 'maintenanceChoice':
      return renderMaintenanceChoices();
    case 'shortcutPractice':
      return renderShortcutPractice();
    default:
      return renderMockShell('Atlas 示例', ['记录', '复盘'], '记录');
  }
}

function renderIntentOptions() {
  const values = [
    ['process', '改进交易过程', '看见计划、执行和复盘之间的断点'],
    ['memory', '记住高价值案例', '把值得回看的交易沉淀下来'],
    ['risk', '守住风险边界', '让风险证据和数据维护可追溯'],
  ];
  return `<div class="choice-grid three">${values.map(([value, label, hint]) => `<button class="demo-choice ${state.demo.intent === value ? 'is-selected' : ''}" type="button" data-demo-option="intent" data-value="${value}"><strong>${label}</strong><span>${hint}</span></button>`).join('')}</div>`;
}

function renderRecordFields() {
  const fields = [
    ['instrument', '品种', [['BTCUSDT', 'BTCUSDT'], ['ETHUSDT', 'ETHUSDT']]],
    ['direction', '方向', [['long', '做多'], ['short', '做空']]],
    ['status', '状态', [['planned', '计划中'], ['open', '进行中']]],
    ['strategy', '策略', [['qa', 'QA 自动化'], ['breakout', '突破确认']]],
  ];
  return `<div class="option-grid two">${fields.map(([field, label, values]) => `<fieldset class="demo-fieldset"><legend class="demo-legend">${label}</legend>${values.map(([value, text]) => `<button class="demo-choice ${state.demo.record[field] === value ? 'is-selected' : ''}" type="button" data-demo-option="recordFields" data-field="${field}" data-value="${value}"><strong>${text}</strong><span>${state.demo.record[field] === value ? '已选择' : '点击选择'}</span></button>`).join('')}</fieldset>`).join('')}</div><div class="demo-actions"><span class="data-badge">${Object.values(state.demo.record).filter(Boolean).length} / 4 已选择</span></div>`;
}

function renderDetailFields() {
  const detail = state.demo.detail;
  return `<div class="mock-list"><div class="mock-setting-row"><span><strong>属性区</strong><small>固定事实与状态</small></span><span>${detail.attributes ? '已展开' : '已收起'}</span><button class="secondary-button" type="button" data-demo-action="open-attributes">${detail.attributes ? '已展开' : '展开属性'}</button></div><div class="mock-setting-row"><span><strong>盘面摘要</strong><small>只写事实</small></span><span>${detail.summary.trim() ? '已填写' : '待填写'}</span><span>${icon('note', 'sm')}</span></div><div class="mock-setting-row"><span><strong>补充信息</strong><small>心理 / 市场叙事</small></span><span>${detail.supplemental ? '已打开' : '已收起'}</span><button class="secondary-button" type="button" data-demo-action="open-supplement">${detail.supplemental ? '已打开' : '打开补充'}</button></div></div><label class="field-label" for="detail-summary">盘面摘要</label><textarea class="text-area" id="detail-summary" data-input="detailSummary" placeholder="例如：4H 收盘确认前出现快速拉升。">${escapeHtml(detail.summary)}</textarea>`;
}

function renderReviewFields() {
  const review = state.demo.review;
  return `<div class="option-grid two"><label><span class="field-label" for="review-fact">事实</span><textarea class="text-area" id="review-fact" data-input="reviewFact" placeholder="我当时做了什么？">${escapeHtml(review.fact)}</textarea></label><label><span class="field-label" for="review-action">下一次动作</span><textarea class="text-area" id="review-action" data-input="reviewAction" placeholder="下次我会怎样做？">${escapeHtml(review.action)}</textarea></label></div><div class="demo-actions"><button class="next-button" type="button" data-demo-action="complete-review" ${!review.fact.trim() || !review.action.trim() ? 'disabled' : ''}>${review.completed ? '已完成复盘' : '完成复盘'} ${icon('check', 'sm')}</button></div>`;
}

function renderCaseLink() {
  const item = state.demo.case;
  return `<div class="mock-list"><div class="mock-source-row"><span><strong>教学交易</strong><small>${teachingTrade.ref} · ${teachingTrade.symbol}</small></span><span>${item.added ? '已加入案例库' : '待沉淀'}</span><button class="secondary-button" type="button" data-demo-action="add-case">${item.added ? '已加入' : '加入案例库'}</button></div><div class="mock-source-row"><span><strong>来源关系</strong><small>案例 ↔ 原始交易</small></span><span>${item.sourceViewed ? '已查看' : '未查看'}</span><button class="secondary-button" type="button" data-demo-action="view-source">${item.sourceViewed ? '已查看' : '查看来源'}</button></div></div>`;
}

function renderStatsPanel(scope = 'live', interactive = false) {
  const stats = teachingStats[scope] ?? teachingStats.live;
  const ranges = [['live', '实盘'], ['paper', '模拟盘'], ['all', '全部记录']];
  return `<div class="demo-toolbar"><span>当前范围：<strong>${stats.label}</strong></span><span class="scope-badge ${scope === 'paper' ? 'paper' : 'live'}">${stats.note}</span></div>${interactive ? `<div class="choice-grid three">${ranges.map(([value, label]) => `<button class="range-button ${scope === value ? 'is-selected' : ''}" type="button" data-demo-option="statsScope" data-value="${value}"><strong>${label}</strong><span>切换范围</span></button>`).join('')}</div>` : ''}<div class="metric-grid"><div class="metric-card"><span class="metric-label">已完成交易</span><strong class="metric-value">${stats.trades}</strong><small class="metric-note">当前范围</small></div><div class="metric-card"><span class="metric-label">胜率</span><strong class="metric-value">${stats.winRate}</strong><small class="metric-note ${stats.tone === 'positive' ? 'is-positive' : ''}">${stats.label}</small></div><div class="metric-card"><span class="metric-label">结果</span><strong class="metric-value">${stats.result}</strong><small class="metric-note ${stats.tone === 'pending' ? 'is-pending' : ''}">${stats.note}</small></div></div>`;
}

function renderReviewRating() {
  const ratings = [
    ['mastered', '已掌握', '下次按更长间隔回看'],
    ['familiar', '有印象', '近期再看一次'],
    ['unfamiliar', '还没掌握', '更快回到这条记录'],
  ];
  return `<div class="choice-grid three">${ratings.map(([value, label, hint]) => `<button class="rating-button ${state.demo.review.rating === value ? 'is-selected' : ''}" type="button" data-demo-option="reviewRating" data-value="${value}"><strong>${label}</strong><span>${hint}</span></button>`).join('')}</div>`;
}

function renderSourceChoices() {
  return `<div class="source-grid">${sourceCards.map((item) => `<button class="source-choice ${state.demo.source === item.id ? 'is-selected' : ''}" type="button" data-demo-option="sourceMapping" data-value="${item.id}"><strong>${item.label}</strong><span>${item.description}</span><span>${item.scope}</span></button>`).join('')}</div>`;
}

function renderSourceRules() {
  return `<div class="source-grid">${sourceCards.map((item) => `<div class="source-card"><span class="scope-badge ${item.tone}">${item.label}</span><strong>${item.scope}</strong><small>${item.description}</small></div>`).join('')}</div>`;
}

function renderMaintenanceChoices() {
  return `<div class="maintenance-grid">${maintenanceOptions.map((item) => `<button class="maintenance-tab ${state.demo.maintenance === item.id ? 'is-selected' : ''}" type="button" data-demo-option="maintenanceChoice" data-value="${item.id}"><strong>${item.label}</strong><span>${item.description}</span><span>${item.action}</span></button>`).join('')}</div>`;
}

function renderMaintenanceRules() {
  return `<div class="maintenance-grid">${maintenanceOptions.map((item) => `<div class="maintenance-card"><span>${item.label}</span><strong>${item.action}</strong><small>${item.description}</small></div>`).join('')}</div>`;
}

function renderShortcutPractice() {
  const shortcutPlatform = state.demo.shortcut.platform ?? state.platform;
  return `<div class="demo-toolbar"><span>当前提示：<strong>${modifierLabel(shortcutPlatform)} K</strong></span><span class="platform-label">${platformLabel(shortcutPlatform)}</span></div>${renderPlatformSwitch('demo')}<div class="shortcut-grid">${shortcutRows.map((row) => `<button class="shortcut-command ${state.demo.shortcut.opened && row.label === '打开命令面板' ? 'is-selected' : ''}" type="button" data-demo-action="open-command"><strong>${row.label}</strong><span>${row[shortcutPlatform]}</span></button>`).join('')}</div>`;
}

function renderSettingsRules() {
  return `<div class="shortcut-grid">${shortcutRows.map((row) => `<div class="shortcut-card"><span>${row.label}</span><strong>${row[state.platform]}</strong><small>平台：${platformLabel()}</small></div>`).join('')}</div>`;
}

function renderCoach(lesson, step) {
  const totalSteps = lesson.steps.length;
  const stepNumber = state.stepIndex + 1;
  const next = nextLessonAfterCurrent();
  const complete = isComplete(lesson.id);
  const coachCopy = complete
    ? next ? `这一节已经完成。下一步可以进入「${next.title}」。` : '全部章节都完成了，你可以从左侧地图回看任意模块。'
    : step.type === 'operate'
      ? actionCoachCopy(step.action)
      : step.type === 'quiz'
        ? '选择一个答案，验证后再继续。错误不会清除你已经完成的步骤。'
        : step.type === 'understand'
          ? '看一下示例关系，再点击“我明白了”进入确认。'
          : '先看清当前概念在 Atlas 里的位置，再开始下一步操作。';
  const actionLabel = complete
    ? next ? '进入下一节' : '回看第一节'
    : step.type === 'operate'
      ? canAdvance(step) ? '继续理解' : '完成当前动作'
      : step.type === 'quiz'
        ? '确认答案'
        : '继续学习';
  const actionAttrs = complete ? next ? 'data-next-lesson' : 'data-first-lesson' : 'data-next';
  const coachDisabled = !complete && !canAdvance(step);
  return `<aside class="coach-rail" id="coach-rail" aria-label="当前操作提示"><div class="coach-header"><div class="coach-title-row"><div><div class="coach-kicker">教练台</div><h2 class="coach-title">${complete ? '本节已完成' : '现在做什么'}</h2></div>${icon(complete ? 'check' : 'target', 'lg')}</div></div><div class="coach-body"><p class="coach-copy">${coachCopy}</p><button class="coach-action" type="button" ${actionAttrs} ${coachDisabled ? 'disabled' : ''}>${actionLabel} ${icon(complete ? 'arrow' : 'check', 'sm')}</button><div class="coach-progress-row"><span>本节进度</span><span>${complete ? totalSteps : stepNumber} / ${totalSteps}</span></div><div class="coach-progress-track"><span style="width:${complete ? 100 : Math.round((stepNumber / totalSteps) * 100)}%"></span></div><p class="coach-tip"><strong>小提示</strong><br>${lesson.description}</p></div></aside>`;
}

function actionCoachCopy(action) {
  const map = {
    intent: '从一个最想解决的问题开始，不需要一次理解所有模块。',
    recordFields: '依次选择品种、方向、状态和策略，先把事实留住。',
    detailFields: '打开属性区，写一条现场摘要，再打开补充信息。',
    reviewFields: '在输入框里写事实和下一次动作，然后点击完成复盘。',
    caseLink: '先把教学交易加入案例库，再打开来源关系。',
    statsScope: '切换一个数据范围，注意指标旁边的口径说明。',
    reviewRating: '选择你对这条旧交易的掌握程度。',
    sourceMapping: '选择场景，观察它会进入哪些统计与复盘入口。',
    maintenanceChoice: '选择一个维护动作，先读清影响范围。',
    shortcutPractice: `切换平台，再打开命令面板示例；当前提示是 ${modifierLabel()} K。`,
  };
  return map[action] ?? '完成当前示例动作。';
}

function renderCompletion(lesson) {
  const next = nextLessonAfterCurrent();
  return `<section class="completion-panel" aria-labelledby="completion-heading"><div class="completion-header"><div class="completion-heading-row"><div><div class="completion-kicker">本节完成</div><h2 class="completion-title" id="completion-heading" tabindex="-1">你已经走完「${lesson.title}」</h2></div>${icon('check', 'xl')}</div></div><div class="completion-body"><p>${lesson.description} 现在你可以回看本节，也可以沿任务地图继续推进。</p>${next ? `<div class="completion-next"><div><strong>下一节：${next.title}</strong><span>${next.objective}</span></div><button class="next-button" type="button" data-next-lesson>进入下一节 ${icon('arrow', 'sm')}</button></div>` : `<div class="success-note">全部教学章节已经完成。你可以从左侧回看任意模块，或重新开始一条新的教学路径。</div>`}<div class="button-row"><button class="secondary-button" type="button" data-review-lesson>回看本节</button>${!next ? '<button class="secondary-button" type="button" data-first-lesson>回到第一节</button>' : ''}</div></div></section>`;
}

function renderSearchDialog() {
  const query = searchQuery.trim().toLowerCase();
  const results = searchIndex.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(query));
  return `<div class="dialog-backdrop" data-close-search></div><section class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-heading"><div class="search-header"><h2 id="search-heading">搜索教学章节</h2><button class="dialog-close" type="button" data-close-search aria-label="关闭搜索">${icon('close', 'md')}</button></div><div class="search-body"><label class="sr-only" for="search-input">搜索关键词</label><input class="search-input" id="search-input" type="search" value="${escapeHtml(searchQuery)}" placeholder="输入交易日志、案例、风险……" data-search-input><div class="search-results">${results.length ? results.map(renderSearchResult).join('') : '<p class="empty-result">没有找到匹配章节。试试“复盘”“数据”或“快捷键”。</p>'}</div></div></section>`;
}

function renderSearchResult(item) {
  const lesson = lessons.find((candidate) => candidate.id === item.id);
  const locked = lesson ? !isUnlocked(lesson) : false;
  const description = locked ? `完成前置章节后解锁 · ${item.description}` : item.description;
  return `<button class="search-result" type="button" data-search-result="${item.id}" ${locked ? 'disabled' : ''}><span class="search-result-number">${lesson?.number ?? '—'}</span><span><strong>${item.title}</strong><span>${description}</span></span></button>`;
}

function renderResetDialog() {
  return `<div class="dialog-backdrop" data-close-reset></div><section class="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-heading"><div class="reset-header"><h2 id="reset-heading">重新开始教学</h2><button class="dialog-close" type="button" data-close-reset aria-label="关闭确认">${icon('close', 'md')}</button></div><div class="reset-body"><p>这会清除当前浏览器里保存的教学进度和示例选择，不会触碰 Atlas 桌面客户端里的任何数据。</p><div class="reset-actions"><button class="secondary-button" type="button" data-close-reset>取消</button><button class="reset-confirm" type="button" data-confirm-reset>清除并重新开始</button></div></div></section>`;
}

function updateInteractiveButtonState() {
  const step = currentStep();
  const nextButton = root.querySelector('[data-next]');
  if (nextButton) nextButton.disabled = !canAdvance(step);
  const reviewButton = root.querySelector('[data-demo-action="complete-review"]');
  if (reviewButton) reviewButton.disabled = !state.demo.review.fact.trim() || !state.demo.review.action.trim();
}

function handleDemoOption(button) {
  const action = button.dataset.demoOption;
  const value = button.dataset.value;
  if (action === 'intent') state.demo.intent = value;
  if (action === 'recordFields') state.demo.record[button.dataset.field] = value;
  if (action === 'statsScope') state.demo.statsScope = value;
  if (action === 'reviewRating') state.demo.review.rating = value;
  if (action === 'sourceMapping') state.demo.source = value;
  if (action === 'maintenanceChoice') state.demo.maintenance = value;
  if (isActionReady()) markActionSuccess();
  else state.actionState = 'active';
  persist();
  render();
}

function handleDemoAction(action) {
  if (action === 'open-attributes') state.demo.detail.attributes = true;
  if (action === 'open-supplement') state.demo.detail.supplemental = true;
  if (action === 'complete-review') state.demo.review.completed = true;
  if (action === 'add-case') state.demo.case.added = true;
  if (action === 'view-source') state.demo.case.sourceViewed = true;
  if (action === 'open-command') state.demo.shortcut.opened = true;
  if (isActionReady()) markActionSuccess();
  else state.actionState = 'active';
  persist();
  render();
}

function handleInput(target) {
  if (target.dataset.input === 'detailSummary') state.demo.detail.summary = target.value;
  if (target.dataset.input === 'reviewFact') state.demo.review.fact = target.value;
  if (target.dataset.input === 'reviewAction') state.demo.review.action = target.value;
  persist();
  updateInteractiveButtonState();
}

function handleQuizOption(button) {
  state.quizSelection = button.dataset.quizOption;
  state.quizCorrect = false;
  state.quizIncorrect = false;
  state.actionState = 'active';
  persist();
  render();
}

function handleQuizSubmit() {
  const step = currentStep();
  const answer = step.options.find((option) => option.value === state.quizSelection);
  if (!answer) return;
  if (answer.correct) {
    state.quizCorrect = true;
    state.quizIncorrect = false;
    state.actionState = 'success';
    persist();
    render();
  } else {
    state.quizCorrect = false;
    state.quizIncorrect = true;
    state.actionState = 'blocked';
    persist();
    render();
  }
}

function setPlatform(platform) {
  state.platform = platform;
  state.demo.shortcut.platform = platform;
  persist();
  render();
}

function handleClick(event) {
  const target = event.target.closest('button, a, [data-close-search], [data-close-reset]');
  if (!target || !root.contains(target)) return;
  if (target.dataset.searchToggle !== undefined) {
    searchOpen = true;
    searchQuery = '';
    render();
    window.requestAnimationFrame(() => document.querySelector('[data-search-input]')?.focus());
    return;
  }
  if (target.dataset.closeSearch !== undefined) {
    searchOpen = false;
    searchQuery = '';
    render();
    return;
  }
  if (target.dataset.closeReset !== undefined) {
    resetOpen = false;
    render();
    return;
  }
  if (target.dataset.reset !== undefined) {
    resetOpen = true;
    render();
    window.requestAnimationFrame(() => document.querySelector('[data-confirm-reset]')?.focus());
    return;
  }
  if (target.dataset.confirmReset !== undefined) {
    state = defaultState();
    persist();
    resetOpen = false;
    showToast('教学进度已清除，从第一节重新开始。', 'success');
    return;
  }
  if (target.dataset.platform) {
    setPlatform(target.dataset.platform);
    return;
  }
  if (target.dataset.lesson) {
    selectLesson(target.dataset.lesson);
    return;
  }
  if (target.dataset.searchResult) {
    searchOpen = false;
    searchQuery = '';
    selectLesson(target.dataset.searchResult);
    return;
  }
  if (target.dataset.demoOption) {
    handleDemoOption(target);
    return;
  }
  if (target.dataset.demoAction) {
    handleDemoAction(target.dataset.demoAction);
    return;
  }
  if (target.dataset.quizOption) {
    handleQuizOption(target);
    return;
  }
  if (target.dataset.quizSubmit !== undefined) {
    handleQuizSubmit();
    return;
  }
  if (target.dataset.next !== undefined) {
    advanceStep();
    return;
  }
  if (target.dataset.nextLesson !== undefined) {
    nextLesson();
    return;
  }
  if (target.dataset.firstLesson !== undefined) {
    selectLesson('orientation');
    return;
  }
  if (target.dataset.reviewLesson !== undefined) {
    reviewCurrentLesson();
  }
}

function handleInputEvent(event) {
  if (event.target.matches('[data-search-input]')) {
    searchQuery = event.target.value;
    const dialog = document.querySelector('.search-dialog');
    if (dialog) {
      const body = dialog.querySelector('.search-body');
      if (body) body.innerHTML = `<label class="sr-only" for="search-input">搜索关键词</label><input class="search-input" id="search-input" type="search" value="${escapeHtml(searchQuery)}" placeholder="输入交易日志、案例、风险……" data-search-input><div class="search-results">${renderSearchResults()}</div>`;
      const input = dialog.querySelector('[data-search-input]');
      input?.focus();
      input?.setSelectionRange(searchQuery.length, searchQuery.length);
    }
    return;
  }
  const input = event.target.closest('[data-input]');
  if (input) handleInput(input);
}

function renderSearchResults() {
  const query = searchQuery.trim().toLowerCase();
  const results = searchIndex.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(query));
  return results.length
    ? results.map(renderSearchResult).join('')
    : '<p class="empty-result">没有找到匹配章节。试试“复盘”“数据”或“快捷键”。</p>';
}

function handleKeydown(event) {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchOpen = true;
    searchQuery = '';
    render();
    window.requestAnimationFrame(() => document.querySelector('[data-search-input]')?.focus());
    return;
  }
  if (event.key === 'Escape') {
    if (searchOpen) {
      searchOpen = false;
      render();
    } else if (resetOpen) {
      resetOpen = false;
      render();
    }
  }
}

root.addEventListener('click', handleClick);
root.addEventListener('input', handleInputEvent);
document.addEventListener('keydown', handleKeydown);
render();
