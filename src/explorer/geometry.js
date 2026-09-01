import {URLS} from './config.js';
import {groupOfRange, loadGroups} from './groups.js';
import {progress, stages} from './ui.js';
import {fmt} from '../dom.js';
import {t, tf, tn} from '../i18n/i18n.js';

let running = false;

// Two files, two halves each, seven phases per half. Every label is a key rather than a string:
// the whole block is read out into the export's progress list, which is as much a part of the UI
// as anything in the column.
const DATASETS = [
  {key: 'streams', labelKey: 'layers.streams', url: URLS.streams},
  {key: 'catchments', labelKey: 'explorer.layers.catchments', url: URLS.catchments},
];

const KINDS = [
  {key: 'download', labelKey: 'explorer.export.download'},
  {key: 'process', labelKey: 'explorer.export.process'},
];

const PHASES = [
  {key: 'index', kind: 'download', labelKey: 'explorer.export.index', weight: 4},
  {key: 'geometry', kind: 'download', labelKey: 'explorer.export.geometry', weight: 96},
  {key: 'prepare', kind: 'process', labelKey: 'explorer.export.prepare', weight: 2},
  {key: 'plan', kind: 'process', labelKey: 'explorer.export.plan', weight: 6},
  {key: 'decode', kind: 'process', labelKey: 'explorer.export.decode', weight: 42},
  {key: 'encode', kind: 'process', labelKey: 'explorer.export.encode', weight: 36},
  {key: 'write', kind: 'process', labelKey: 'explorer.export.write', weight: 14},
];

/** Phase and group keys are namespaced by dataset, so the two runs cannot address each other's. */
const scoped = (dataset, key) => `${dataset}:${key}`;

// Built per run rather than once at import, so an export started after a language change is
// reported in that language.
const exportPlan = () => ({
  groups: DATASETS.flatMap(d => KINDS.map(k => ({
    key: scoped(d.key, k.key), label: `${t(d.labelKey)} · ${t(k.labelKey)}`,
  }))),
  phases: DATASETS.flatMap(d => PHASES.map(p => ({
    key: scoped(d.key, p.key), group: scoped(d.key, p.kind), label: t(p.labelKey), weight: p.weight,
  }))),
});

/** A progress line as the worker described it: pieces that are either `{key, vars}` for the
 * dictionary or a plain string of numbers. See the note in geomWorker.js. */
const detailText = detail => (Array.isArray(detail)
  ? detail.map(piece => (typeof piece === 'string' ? piece : tf(piece.key, piece.vars)))
    .filter(Boolean).join(' · ')
  : detail);

function save(buffer, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buffer], {type: 'application/vnd.apache.parquet'}));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function runDataset(dataset, {groupId, outletId, lo, hi, count, spans}) {
  const key = p => scoped(dataset.key, p);
  return new Promise((resolve, reject) => {
    stages.done(key('prepare'), `${tn('explorer.picks.reaches', count)} · riverIndex ${fmt(lo)}-${fmt(hi)}` +
      (spans?.length > 1 ? ` · ${tn('explorer.readout.runs', spans.length)}` : ''));
    stages.set(key('index'), {pct: 2, detail: tf('explorer.export.opening', {group: groupId})});
    const worker = new Worker(new URL('./geomWorker.js', import.meta.url), {type: 'module'});

    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'note') return;
      if (m.type === 'stage') {
        return stages.set(key(m.key),
          {pct: m.pct, detail: detailText(m.detail), indeterminate: m.indeterminate});
      }
      worker.terminate();
      if (m.type === 'error') return reject(new Error(m.key ? tf(m.key, m.vars) : m.message));
      const name = `rfs_v3_group${groupId}_${outletId}_${dataset.key}.parquet`;
      save(m.buffer, name);
      resolve();
    };
    worker.onerror = err => {
      worker.terminate();
      reject(new Error(err.message || t('explorer.export.workerStopped')));
    };

    worker.postMessage({url: dataset.url(groupId), lo, hi, spans});
  });
}

async function runAll(selection) {
  for (const dataset of DATASETS) {
    try {
      await runDataset(dataset, selection);
    } catch (err) {
      stages.fail(err.message);
      console.error(`[geometry] ${dataset.key}`, err);
      return;
    }
  }
  stages.finish();
}

/**
 * Export the selection as GeoParquet.
 *
 * The group comes first and is looked up rather than passed in: the files are published per group
 * and the stream tiles carry no group, so this is the one thing the selection cannot tell us. It is
 * read once per session — see groups.js — so only the first export waits on it, and the wait is a
 * few tens of kilobytes.
 */
export function downloadGeometry({outletId, lo, hi, count, spans, onSettled}) {
  if (running) return;
  running = true;
  progress.hide();
  progress.indeterminate(t('explorer.export.findingGroup'));
  loadGroups()
    .then(() => {
      const groupId = groupOfRange(lo, hi);
      progress.hide();
      if (groupId == null) throw new Error(t('explorer.export.err.noGroup'));
      stages.begin(exportPlan());
      return runAll({groupId, outletId, lo, hi, count, spans});
    })
    .catch((err) => {
      progress.hide();
      console.error('[geometry] no Group for this selection', err);
      stages.fail(err.message);
    })
    .finally(() => {
      running = false;
      onSettled?.();
    });
}
