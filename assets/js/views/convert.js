/**
 * 声音转换页：准备音频 → 选择音色与参数 → 播放 / 下载结果。
 */

import { t, onLangChange } from '../i18n.js';
import {
  el, card, btn, slider, notice, toast, downloadBlob,
  makeZip, drawWave, formatTime, formatBytes, formatTime as fmtTime,
} from '../ui.js';
import {
  Recorder, decode, encodeWav, resample, toMono, Player, SAMPLE_RATE_16K,
} from '../audio.js';
import { state, getEngine, refreshEngineChip } from '../state.js';
import { catalog } from '../catalog.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPT = '.wav,.mp3,.ogg,.m4a,.aac,.flac,.webm,.opus';

let uid = 0;

export async function viewConvert(root) {
  const { entries, voices } = await catalog();
  const engine = safeEngine();
  const compatible = entries.filter((m) => m.downloaded && isCompatible(m, state.settings.engine));

  /* ---------------- 状态 ---------------- */
  const activeTab = state.ui.activeTab || 'record';
  let currentResult = null;

  /* ---------------- 左栏：输入 ---------------- */
  const queueList = el('div.file-list');
  const queueBadge = el('span.badge', {}, [], t('convert.stats.queue', { n: state.ui.queue.length }));
  const recorder = new Recorder();

  const timeEl = el('span.rec-time', {}, [], '0:00');
  const meterCanvas = el('canvas', { height: 18, style: 'width:100%;height:18px;display:block' });
  const recBtn = btn(t('convert.rec.start'), {
    variant: 'primary', attrs: { class: 'rec-btn', 'aria-label': t('convert.rec.start') },
    onClick: () => (recorder.recording ? stopRecording() : startRecording()),
  });
  const recTimer = el('span.faint', {}, [], t('convert.rec.hint'));

  const recorderBox = el('div.recorder', {}, [
    recBtn,
    el('div.meter', {}, [el('div.meter-track', {}, [el('div.meter-fill', { id: 'meterFill' })]), meterCanvas]),
    timeEl,
  ]);

  const fileInput = el('input', {
    type: 'file', accept: ACCEPT, multiple: true, style: 'display:none',
    onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; },
  });

  const dropzone = el('div.dropzone', {
    onclick: () => fileInput.click(),
    ondragover: (e) => { e.preventDefault(); dropzone.classList.add('drag'); },
    ondragleave: () => dropzone.classList.remove('drag'),
    ondrop: (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag');
      addFiles([...e.dataTransfer.files]);
    },
  }, [
    el('div.dz-icon', {}, [], '🎧'),
    el('strong', {}, [], t('convert.drop.title')),
    el('small', {}, [], t('convert.drop.hint')),
  ]);

  const tabs = el('div.row.tight', {}, [
    tabBtn('convert.tab.record', 'record'),
    tabBtn('convert.tab.upload', 'upload'),
    tabBtn('convert.tab.sample', 'sample'),
  ]);

  const tabPanels = el('div', { style: 'margin-top:12px' });
  renderTabPanels();

  const inputCard = card(t('convert.step1'), { step: 1, right: [queueBadge] }, [
    tabs,
    tabPanels,
    el('div.row', { style: 'margin-top:12px;justify-content:space-between' }, [
      el('span.faint', {}, [], `${t('convert.files')} · ${state.ui.queue.length}`),
      btn(t('convert.files.clear'), { size: 'sm', variant: 'ghost', onClick: clearQueue }),
    ]),
    queueList,
  ]);

  function tabBtn(key, id) {
    return btn(t(key), {
      size: 'sm',
      attrs: { 'aria-pressed': String(activeTab === id) },
      onClick: () => { state.ui.activeTab = id; refresh(); },
    });
  }

  function renderTabPanels() {
    const panels = {
      record: [
        recorderBox,
        el('p.faint', { style: 'margin:8px 0 0' }, [], t('convert.rec.hint')),
      ],
      upload: [dropzone, fileInput],
      sample: [notice(t('convert.sample.none'), { type: 'info', icon: 'ℹ' })],
    };
    const node = panels[activeTab] || panels.record;
    tabPanels.replaceChildren(...node.map((n) => (typeof n === 'function' ? n() : n)));
    if (activeTab === 'record') recorder.attachMeter(meterCanvas);
  }

  async function startRecording() {
    try {
      await recorder.start({
        onLevel: (v) => { const f = $('#meterFill'); if (f) f.style.width = `${Math.round(v * 100)}%`; },
        onTick: (ms) => { timeEl.textContent = fmtTime(ms / 1000); },
      });
      recBtn.classList.add('recording');
      recBtn.textContent = t('convert.rec.stop');
    } catch (err) {
      const msg = err.name === 'NotAllowedError' ? t('convert.rec.denied')
        : err.name === 'NotFoundError' ? t('convert.rec.noDevice')
          : err.message;
      toast(msg, { type: 'err', title: t('convert.rec.doing') });
    }
  }

  async function stopRecording() {
    try {
      const { blob } = await recorder.stop();
      recBtn.classList.remove('recording');
      recBtn.textContent = t('convert.rec.start');
      timeEl.textContent = '0:00';
      const meter = $('#meterFill'); if (meter) meter.style.width = '0%';
      await addFiles([new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })]);
    } catch (err) {
      recBtn.classList.remove('recording');
      recBtn.textContent = t('convert.rec.start');
      toast(err.message, { type: 'err' });
    }
  }

  async function addFiles(files) {
    const added = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { toast(t('convert.drop.tooBig', { name: file.name }), { type: 'err' }); continue; }
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac', 'webm', 'opus'].includes(ext)) {
        toast(t('convert.drop.badType', { name: file.name }), { type: 'err' });
        continue;
      }
      try {
        const audioBuffer = await decode(await file.arrayBuffer());
        const item = {
          id: `q${++uid}`, name: file.name, blob: file, audioBuffer,
          sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration,
          channels: audioBuffer.numberOfChannels,
        };
        state.ui.queue.push(item);
        added.push(item);
      } catch (err) {
        toast(`${file.name}: ${err.message}`, { type: 'err' });
      }
    }
    if (added.length) toast(t('convert.files.added', { n: added.length }), { type: 'ok' });
    if (added.length === 1 && !state.ui.selectedQueueId) state.ui.selectedQueueId = added[0].id;
    renderQueue();
    refresh();
  }

  function renderQueue() {
    if (!state.ui.queue.length) {
      queueList.replaceChildren(el('p.faint', { style: 'margin:0' }, [], t('convert.files.empty')));
      return;
    }
    queueList.replaceChildren(...state.ui.queue.map((item) => el('div.file-item', {}, [
      el('span.fi-name', { title: item.name }, [], item.name),
      el('span.fi-meta', {}, [], formatBytes(item.blob.size)),
      el('span.fi-dur', {}, [], fmtTime(item.duration)),
      btn('✕', {
        size: 'sm', variant: 'ghost', title: t('convert.files.remove'),
        onClick: () => {
          state.ui.queue = state.ui.queue.filter((q) => q.id !== item.id);
          if (state.ui.selectedQueueId === item.id) state.ui.selectedQueueId = state.ui.queue[0]?.id || null;
          renderQueue();
          refresh();
        },
      }),
    ])));
  }

  function clearQueue() {
    state.ui.queue = [];
    state.ui.selectedQueueId = null;
    state.ui.results = [];
    renderQueue();
    refresh();
  }

  /* ---------------- 中栏：音色与参数 ---------------- */
  const modelSelect = el('select', {
    onchange: () => { state.ui.modelId = modelSelect.value || null; refreshModelHint(); },
  }, compatible.length ? compatible.map((m) => el('option', { value: m.id, selected: state.ui.modelId === m.id }, [], m.name)) : [el('option', { value: '' }, [], t('convert.model.empty'))]);

  const params = state.settings.params;
  const pitch = slider({ label: t('convert.param.pitch'), hint: t('convert.param.pitchHint'), min: -24, max: 24, step: 1, value: params.f0upKey, onChange: persistParam('f0upKey') });
  const indexRate = slider({ label: t('convert.param.index'), hint: t('convert.param.indexHint'), min: 0, max: 1, step: 0.05, value: params.indexRate, onChange: persistParam('indexRate') });
  const protect = slider({ label: t('convert.param.protect'), hint: t('convert.param.protectHint'), min: 0, max: 0.5, step: 0.01, value: params.protect, onChange: persistParam('protect') });
  const rmsMix = slider({ label: t('convert.param.rms'), hint: t('convert.param.rmsHint'), min: 0, max: 1, step: 0.05, value: params.rmsMixRate, onChange: persistParam('rmsMixRate') });
  const filterRadius = slider({ label: t('convert.param.filter'), hint: t('convert.param.filterHint'), min: 0, max: 7, step: 1, value: params.filterRadius, onChange: persistParam('filterRadius') });

  function persistParam(key) {
    return (value) => {
      state.settings.params = { ...state.settings.params, [key]: value };
      saveParamsDebounced();
    };
  }
  let saveTimer = 0;
  function saveParamsDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { state.saveSettings({ params: state.settings.params }); }, 400);
  }

  const runBtn = btn(t('convert.start'), {
    variant: 'primary', size: 'lg', attrs: { style: 'width:100%' },
    onClick: () => runConversion(),
  });
  const runStatus = el('div.faint', { style: 'min-height:20px;margin-top:8px' }, [], '');

  const paramCard = card(t('convert.step2'), { step: 2 }, [
    el('label.field', {}, [el('span.field-label', {}, [], t('convert.model')), modelSelect]),
    el('div.faint', { id: 'modelHint', style: 'margin:6px 0 14px' }, [], ''),
    el('div.grid', { style: 'gap:14px' }, [pitch, indexRate, protect, rmsMix, filterRadius]),
    notice(t('convert.engine.warn'), { type: 'warn', icon: '⚠' }),
    runBtn,
    runStatus,
  ]);

  function refreshModelHint() {
    const hint = $('#modelHint');
    if (!hint) return;
    const m = entries.find((e) => e.id === state.ui.modelId);
    hint.textContent = m ? `${m.kind === 'base' ? '基础模型' : '音色'} · ${m.license}` : t('convert.model.empty');
  }

  /* ---------------- 右栏：结果 ---------------- */
  const waveCanvas = el('canvas', { style: 'width:100%;height:100%;display:block' });
  const playhead = el('div.playhead');
  const waveBox = el('div.wave', {}, [waveCanvas, playhead, el('div.wave-empty', {}, [], t('convert.result.empty'))]);
  const player = new Player({
    canvas: waveCanvas,
    onEnded: () => updatePlayBtn(false),
  });
  waveCanvas.addEventListener('player-time', (e) => {
    playhead.style.left = `${(e.detail / player.buffer.duration) * 100}%`;
    updateProgress(e.detail / player.buffer.duration);
  });
  waveCanvas.addEventListener('click', (e) => {
    if (!player.buffer) return;
    const rect = waveCanvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    player.play(ratio * player.buffer.duration);
    updatePlayBtn(true);
  });

  const playBtn = el('button.play-btn', { type: 'button', onclick: () => { player.toggle(); updatePlayBtn(player.playing); } }, [
    el('svg', { viewBox: '0 0 24 24', width: 18, height: 18 }, [el('path', { fill: 'currentColor', d: 'M8 5v14l11-7z' })]),
  ]);
  const trackFill = el('div.track-fill');
  const timeLabel = el('span.time', {}, [], '0:00 / 0:00');
  const dlBtn = btn(t('convert.result.download'), { variant: 'ghost', size: 'sm', onClick: () => downloadCurrent() });
  const dlZipBtn = btn(t('convert.result.downloadAll'), { variant: 'ghost', size: 'sm', onClick: () => downloadZip() });
  const metricsEl = el('div.faint', {}, [], '');

  const resultCard = card(t('convert.step3'), { step: 3 }, [
    waveBox,
    el('div.player', {}, [
      playBtn,
      el('div.track', { onclick: (e) => {
        if (!player.buffer) return;
        const rect = e.currentTarget.getBoundingClientRect();
        player.play(((e.clientX - rect.left) / rect.width) * player.buffer.duration);
        updatePlayBtn(true);
      } }, [trackFill]),
      timeLabel,
    ]),
    el('div.row', { style: 'margin-top:12px' }, [dlBtn, dlZipBtn]),
    metricsEl,
  ]);

  function updateProgress(ratio) {
    trackFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }
  function updatePlayBtn(playing) {
    playBtn.replaceChildren(el('svg', { viewBox: '0 0 24 24', width: 18, height: 18 }, [
      el('path', { fill: 'currentColor', d: playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z' }),
    ]));
  }

  function showResult(res) {
    currentResult = res;
    const empty = waveBox.querySelector('.wave-empty');
    if (empty) empty.remove();
    player.load(res.audio);
    drawWave(waveCanvas, toMono(res.audio));
    timeLabel.textContent = `0:00 / ${fmtTime(res.audio.duration)}`;
    updateProgress(0);
    metricsEl.textContent = t('convert.result.metrics', {
      ms: Math.round(res.metrics?.ms ?? 0),
      sr: res.sampleRate,
      engine: state.settings.engine === 'onnx' ? 'ONNX' : 'RVC',
    });
  }

  async function runConversion() {
    const selected = state.ui.queue.find((q) => q.id === state.ui.selectedQueueId) || state.ui.queue[0];
    if (!selected) { toast(t('convert.noInput'), { type: 'warn' }); return; }
    const model = compatible.find((m) => m.id === state.ui.modelId);
    if (!model) { toast(t('convert.noModel'), { type: 'warn' }); return; }

    const eng = safeEngine();
    if (!eng) { toast(t('convert.engine.warn'), { type: 'err' }); return; }

    runBtn.disabled = true;
    const startedAt = performance.now();
    const results = [];
    try {
      const targets = state.ui.queue.length > 1 ? state.ui.queue : [selected];
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        runStatus.textContent = t('convert.running', { name: item.name });
        const src = state.settings.outSampleRate
          ? await resample(item.audioBuffer, state.settings.outSampleRate)
          : item.audioBuffer;
        const wav = encodeWav([toMono(src)], src.sampleRate);
        const res = await eng.convert({
          wav,
          sampleRate: src.sampleRate,
          model,
          audioBuffer: src,
          params: state.settings.params,
          outSampleRate: state.settings.outSampleRate,
          onProgress: (p) => { runStatus.textContent = `${t('convert.running', { name: item.name })} ${Math.round(p * 100)}%`; },
        });
        res.metrics = { ...res.metrics, ms: performance.now() - startedAt };
        res.name = item.name.replace(/\.[^.]+$/, '') + '-rvc.wav';
        results.push(res);
        showResult(res);
      }
      state.ui.results = results;
      runStatus.textContent = results.length > 1 ? t('convert.allDone', { n: results.length }) : '';
      toast(t('convert.done', { name: results[0].name }), { type: 'ok' });
    } catch (err) {
      runStatus.textContent = '';
      toast(t('convert.failed', { msg: err.message }), { type: 'err', duration: 8000 });
    } finally {
      runBtn.disabled = false;
      refreshEngineChip();
    }
  }

  function downloadCurrent() {
    if (!currentResult) return;
    const blob = encodeWav([toMono(currentResult.audio)], currentResult.sampleRate);
    downloadBlob(blob, currentResult.name || 'rvc-output.wav');
  }

  function downloadZip() {
    if (!state.ui.results.length) { downloadCurrent(); return; }
    toast(t('common.processing'), { type: 'info' });
    // 逐个编码后再打包，避免长音频阻塞 UI
    encodeResults().then((entries) => {
      downloadBlob(makeZip(entries), `rvc-outputs-${Date.now()}.zip`);
    });
  }

  async function encodeResults() {
    const out = [];
    for (const r of state.ui.results) {
      const blob = encodeWav([toMono(r.audio)], r.sampleRate);
      out.push([r.name, new Uint8Array(await blob.arrayBuffer())]);
    }
    return out;
  }

  function refresh() {
    tabs.replaceChildren(
      tabBtn('convert.tab.record', 'record'),
      tabBtn('convert.tab.upload', 'upload'),
      tabBtn('convert.tab.sample', 'sample'),
    );
    renderTabPanels();
    queueBadge.textContent = t('convert.stats.queue', { n: state.ui.queue.length });
    refreshModelHint();
    recBtn.textContent = recorder.recording ? t('convert.rec.stop') : t('convert.rec.start');
  }

  const stopRefresh = onLangChange(() => {
    tabs.replaceChildren(
      tabBtn('convert.tab.record', 'record'),
      tabBtn('convert.tab.upload', 'upload'),
      tabBtn('convert.tab.sample', 'sample'),
    );
    renderTabPanels();
    recBtn.textContent = recorder.recording ? t('convert.rec.stop') : t('convert.rec.start');
    dlBtn.textContent = t('convert.result.download');
    dlZipBtn.textContent = t('convert.result.downloadAll');
    runBtn.textContent = t('convert.start');
    refreshModelHint();
    if (!currentResult) waveBox.append(el('div.wave-empty', {}, [], t('convert.result.empty')));
  });

  root.append(
    el('header', {}, [
      el('h1.page-title', {}, [], t('convert.title')),
      el('p.lead', {}, [], t('brand.tag')),
    ]),
    el('div.grid.convert', {}, [inputCard, paramCard, resultCard]),
  );

  renderQueue();
  refreshModelHint();
  if (state.ui.modelId) modelSelect.value = state.ui.modelId;

  return {
    destroy() {
      clearTimeout(saveTimer);
      stopRefresh();
      player.stop();
      recorder.cleanup();
    },
  };
}

function safeEngine() {
  try { return getEngine(); } catch { return null; }
}

function isCompatible(m, engineId) {
  if (engineId === 'server') return m.files?.some((f) => f.name.endsWith('.pth'));
  return m.files?.some((f) => f.name === 'generator.onnx');
}
