import {$, el} from "../dom.js";
import {heroIcon} from "../icons/icons.js";
import {t} from "../i18n/i18n.js";

/**
 * A folding section of the column. `key` names all three things it touches: the class the stylesheet
 * folds with is `${key}-collapsed` and the button is `#${key}-collapse`. The tooltip is written as
 * `data-i18n-title` as well as set directly, so a language change repaints it pointing the right way.
 */
export function createCollapsible(key, {collapsed = false} = {}) {
  const panel = $('panel');
  const btn = $(`${key}-collapse`);
  const cls = `${key}-collapsed`;
  const set = fold => {
    const titleKey = fold ? 'explorer.fold.expand' : 'explorer.fold.collapse';
    panel.classList.toggle(cls, fold);
    btn.replaceChildren(heroIcon(fold ? 'chevron-right' : 'chevron-down'));
    btn.setAttribute('data-i18n-title', titleKey);
    btn.title = t(titleKey);
  };
  btn.addEventListener('click', () => set(!panel.classList.contains(cls)));
  set(collapsed);
  return {set, collapsed: () => panel.classList.contains(cls)};
}

// The run report is the selection tools' — a build without them has no #panel-foot in the page,
// and the two objects below become inert rather than each of their callers having to check.
const stagesEl = $('stages');
const progressEl = $('progress');
const phaseEl = $('progress-phase');
const pctEl = $('progress-pct');
const fillEl = $('progress-fill');
const detailEl = $('progress-detail');
const noFoot = !progressEl || !stagesEl;

/** Elapsed/remaining seconds as m:ss, which reads faster than "97.4 s" at a glance. */

let hideTimer = null;

let high = 0;

export const progress = {
  /** Open the block for a new run, at 0. */
  begin(phase, detail = '') {
    if (noFoot) return;
    clearTimeout(hideTimer);
    high = 0;
    progressEl.style.display = 'block';
    progressEl.classList.remove('indeterminate', 'done');
    fillEl.style.width = '0%';
    phaseEl.textContent = phase;
    pctEl.textContent = '0%';
    detailEl.textContent = detail;
    detailEl.style.display = detail ? 'block' : 'none';
  },

  set(pct, {phase, detail} = {}) {
    if (noFoot) return;
    high = Math.max(high, Math.min(100, Math.max(0, pct)));
    progressEl.classList.remove('indeterminate');
    fillEl.style.width = `${high}%`;
    pctEl.textContent = `${Math.round(high)}%`;
    if (phase != null) phaseEl.textContent = phase;
    if (detail != null) {
      detailEl.textContent = detail;
      detailEl.style.display = detail ? 'block' : 'none';
    }
  },

  indeterminate(phase, detail = '') {
    if (noFoot) return;
    clearTimeout(hideTimer);
    progressEl.style.display = 'block';
    progressEl.classList.add('indeterminate');
    if (phase != null) phaseEl.textContent = phase;
    pctEl.textContent = '';
    detailEl.textContent = detail;
    detailEl.style.display = detail ? 'block' : 'none';
  },

  /** Land on 100%, hold it long enough to register, then fade the block out. */
  finish(phase, detail = '') {
    if (noFoot) return;
    progressEl.classList.remove('indeterminate');
    high = 100;
    fillEl.style.width = '100%';
    pctEl.textContent = '100%';
    progressEl.classList.add('done');
    if (phase != null) phaseEl.textContent = phase;
    detailEl.textContent = detail;
    detailEl.style.display = detail ? 'block' : 'none';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      progressEl.style.display = 'none';
    }, 1400);
  },

  hide() {
    if (noFoot) return;
    clearTimeout(hideTimer);
    high = 0;
    progressEl.style.display = 'none';
    progressEl.classList.remove('indeterminate', 'done');
    fillEl.style.width = '0%';
  },
};

let plan = {groups: [], phases: []};
let phaseState = new Map();
let nodes = new Map();
let groupNodes = new Map();

const bar = () => {
  const track = el('div', {class: 'stage-bar progress-track'});
  track.appendChild(el('div', {class: 'stage-fill progress-fill'}));
  return track;
};

const MARK = {pending: '·', active: '▸', done: '✓', failed: '✕', skipped: '–'};

function paintPhase(key) {
  const s = phaseState.get(key);
  const n = nodes.get(key);
  if (!s || !n) return;
  n.row.className = `stage-line ${s.state}${s.indeterminate ? ' indeterminate' : ''}`;
  n.mark.textContent = MARK[s.state] ?? '·';
  n.detail.textContent = s.detail ?? '';
  n.row.title = s.detail ? `${n.label}: ${s.detail}` : n.label;
  n.fill.style.width = `${s.state === 'done' ? 100 : s.pct}%`;
}

function paintGroup(groupKey) {
  const phases = plan.phases.filter(p => p.group === groupKey);
  const total = phases.reduce((a, p) => a + (p.weight ?? 1), 0) || 1;
  const doneW = phases.reduce((a, p) => {
    const s = phaseState.get(p.key);
    return a + (p.weight ?? 1) * (s?.state === 'done' ? 100 : s?.pct ?? 0);
  }, 0);
  const pct = Math.min(100, doneW / total);
  const g = groupNodes.get(groupKey);
  if (!g) return;
  g.fill.style.width = `${pct}%`;
  g.pct.textContent = `${Math.round(pct)}%`;
  g.box.classList.toggle('done', phases.every(p => phaseState.get(p.key)?.state === 'done'));
}

export const stages = {
  begin({groups, phases}) {
    if (noFoot) return;
    plan = {groups, phases};
    phaseState = new Map(phases.map(p => [p.key, {pct: 0, state: 'pending', detail: ''}]));
    nodes = new Map();
    groupNodes = new Map();
    stagesEl.replaceChildren();
    stagesEl.style.display = 'block';

    for (const g of groups) {
      const box = el('div', {class: 'stage-group'});
      const head = el('div', {class: 'stage-group-head eyebrow'});
      head.appendChild(el('span', {class: 'stage-group-name', text: g.label}));
      const pct = el('span', {class: 'stage-group-pct', text: '0%'});
      head.appendChild(pct);
      const track = bar();
      box.append(head, track);
      for (const p of phases.filter(x => x.group === g.key)) {
        const row = el('div', {class: 'stage-line pending'});
        const mark = el('span', {class: 'stage-mark', text: MARK.pending});
        const name = el('span', {class: 'stage-name', text: p.label});
        const detail = el('span', {class: 'stage-detail', text: ''});
        const lineBar = bar();
        row.append(mark, name, detail, lineBar);
        row.title = p.label;
        box.appendChild(row);
        nodes.set(p.key, {row, mark, detail, label: p.label, fill: lineBar.firstChild});
      }
      stagesEl.appendChild(box);
      groupNodes.set(g.key, {box, pct, fill: track.firstChild});
      paintGroup(g.key);
    }
  },

  set(key, {pct, detail, state, indeterminate} = {}) {
    const s = phaseState.get(key);
    if (!s) return;
    if (pct != null) s.pct = Math.min(100, Math.max(s.pct, pct));
    if (detail != null) s.detail = detail;
    if (indeterminate != null) s.indeterminate = indeterminate;
    s.state = state ?? (s.pct >= 100 ? 'done' : 'active');
    if (s.state === 'done') s.indeterminate = false;
    paintPhase(key);
    paintGroup(plan.phases.find(p => p.key === key)?.group);
  },

  done: (key, detail) => stages.set(key, {pct: 100, detail, state: 'done'}),

  /** Everything that ran, finished. Anything still pending never had to run, and says so. */
  finish() {
    for (const p of plan.phases) {
      const s = phaseState.get(p.key);
      if (!s || s.state === 'failed') continue;
      stages.set(p.key, s.state === 'pending' ? {state: 'skipped'} : {pct: 100, state: 'done'});
    }
  },

  /** The phase that broke keeps its detail; what was never reached is marked skipped, not failed. */
  fail(message) {
    let broke = false;
    for (const p of plan.phases) {
      const s = phaseState.get(p.key);
      if (!s) continue;
      if (s.state === 'active') {
        broke = true;
        stages.set(p.key, {state: 'failed', detail: message});
      } else if (s.state === 'pending') {
        stages.set(p.key, {state: 'skipped'});
      }
    }
    return broke;
  },

  hide() {
    if (noFoot) return;
    stagesEl.style.display = 'none';
    stagesEl.replaceChildren();
    plan = {groups: [], phases: []};
    phaseState = new Map();
    nodes = new Map();
    groupNodes = new Map();
  },
};
