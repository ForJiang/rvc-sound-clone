/**
 * 声音转换页：准备音频 → 选择音色与参数 → 播放 / 下载结果。
 */

import { t, onLangChange } from '../i18n.js';
import {
  $, el, card, btn, slider, notice, toast, downloadBlob,
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
  let activeTab = state.ui.activeTab || 'record';
  let currentResult = null;

  /* ---------------- 左栏：输入 ---------------- */
  const queueList = el('div.file-list');
  const queueBadge = el('span.badge', {}, [], t('convert.stats.queue', { n: state.ui.queue.length }));
  const recorder = new Recorder();

  const timeEl = el('span.rec-time', {}, [], '0:00');
  const meterCanvas = el('canvas', { height: 18, style: 'width:100%;height:18px;display:block' });
  /* 录音按钮：圆形图标按钮（文字单独放标签，避免文字超出圆形） */
  const recBtn = el('button.rec-btn', {
    type: 'button', title: t('convert.rec.start'),
    onclick: () => (recorder.recording ? stopRecording() : startRecording()),
  }, [micIcon()]);

  const recLabel = el('span.rec-label', {}, [], t('convert.rec.start'));
  const recTimer = el('span.faint', {}, [], t('convert.rec.hint'));

  const recorderBox = el('div.recorder', {}, [
    recBtn,
    el('div.meter', {}, [
      el('div.rec-head', {}, [recLabel, timeEl]),
      el('div.meter-track', {}, [el('div.meter-fill', { id: 'meterFill' })]),
      meterCanvas,
    ]),
  ]);

  function micIcon() {
    return el('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true' }, [
      el('path', { fill: 'currentColor', d: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-4 4.9V21h-2v-4.1A5 5 0 0 1 7 12h2a3 3 0 0 0 6 0h2Z' }),
    ]);
  }

  function stopIcon() {
    return el('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, [
      el('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: 'currentColor' }),
    ]);
  }

  /** 同步录音按钮的图标、无障碍标签与状态文字。 */
  function syncRecBtn() {
    const recording = recorder.recording;
    recBtn.replaceChildren(recording ? stopIcon() : micIcon());
    recBtn.classList.toggle('recording', recording);
    recBtn.title = recording ? t('convert.rec.stop') : t('convert.rec.start');
    recBtn.setAttribute('aria-label', recBtn.title);
    recBtn.setAttribute('aria-pressed', String(recording));
    recLabel.textContent = recording ? t('convert.rec.doing') : t('convert.rec.start');
    recTimer.textContent = recording ? t('convert.rec.recording') : t('convert.rec.hint');
  }

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
      el('span.faint', { id: 'queueCount' }, [], `${t('convert.files')} · ${state.ui.queue.length}`),
      btn(t('convert.files.clear'), { size: 'sm', variant: 'ghost', onClick: clearQueue }),
    ]),
    queueList,
  ]);
  // 与右侧参数卡等高，队列区自动填充剩余高度
  inputCard.classList.add('card-fill');

  function tabBtn(key, id) {
    return btn(t(key), {
      size: 'sm',
      attrs: { 'aria-pressed': String(activeTab === id) },
      onClick: () => setTab(id),
    });
  }

  function setTab(id) {
    if (state.ui.activeTab === id && activeTab === id) { renderTabs(); return; }
    activeTab = id;
    state.ui.activeTab = id;
    renderTabs();
    renderTabPanels();
  }

  function renderTabs() {
    tabs.replaceChildren(
      tabBtn('convert.tab.record', 'record'),
      tabBtn('convert.tab.upload', 'upload'),
      tabBtn('convert.tab.sample', 'sample'),
    );
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
      syncRecBtn();
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
      syncRecBtn();
      timeEl.textContent = '0:00';
      const meter = $('#meterFill'); if (meter) meter.style.width = '0%';
      await addFiles([new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })]);
    } catch (err) {
      syncRecBtn();
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

  function syncQueueCount() {
    const node = $('#queueCount');
    if (node) node.textContent = `${t('convert.files')} · ${state.ui.queue.length}`;
    queueBadge.textContent = t('convert.stats.queue', { n: state.ui.queue.length });
  }

  function renderQueue() {
    syncQueueCount();
    if (!state.ui.queue.length) {
      queueList.replaceChildren(el('div.empty-state', {}, [
        el('span.es-icon', {}, [], '🎧'),
        el('strong', {}, [], t('convert.files.empty')),
        el('span', {}, [], t('convert.drop.hint')),
      ]));
      return;
    }
    queueList.replaceChildren(...state.ui.queue.map((item) => {
      const selected = state.ui.selectedQueueId === item.id;
      return el('div.file-item' + (selected ? '.selected' : ''), {}, [
        el('button.fi-play', {
          type: 'button', title: previewPlayer?.playing ? t('convert.preview.stop') : t('convert.preview'),
          onclick: (e) => { e.stopPropagation(); togglePreview(item); },
        }, [], previewId === item.id && previewPlayer?.playing ? '■' : '▶'),
        el('button.fi-body', {
          type: 'button', title: item.name,
          onclick: () => {
            state.ui.selectedQueueId = item.id;
            renderQueue();
          },
        }, [
          el('span.fi-name', {}, [], item.name),
          el('span.fi-meta', {}, [], `${formatBytes(item.blob.size)} · ${item.channels > 1 ? item.channels + 'ch' : 'mono'}`),
        ]),
        el('span.fi-dur', {}, [], fmtTime(item.duration)),
        selected ? el('span.badge.brand', {}, [], t('convert.selected')) : null,
        btn('✕', {
          size: 'sm', variant: 'ghost', title: t('convert.files.remove'),
          onClick: () => {
            state.ui.queue = state.ui.queue.filter((q) => q.id !== item.id);
            if (state.ui.selectedQueueId === item.id) state.ui.selectedQueueId = state.ui.queue[0]?.id || null;
            if (previewId === item.id) { previewPlayer?.stop(); previewId = null; }
            renderQueue();
            refresh();
          },
        }),
      ]);
    }));
  }

  /* 原声试听：与结果播放器分开，避免互相打断。
     player 惰性创建——waveCanvas 在本函数之后才声明。 */
  let previewPlayer = null;
  let previewId = null;

  function togglePreview(item) {
    if (previewId === item.id && previewPlayer?.playing) {
      previewPlayer.stop();
      previewId = null;
    } else {
      previewPlayer?.stop();
      previewPlayer ??= new Player({ canvas: waveCanvas, onEnded: () => renderQueue() });
      previewPlayer.load(item.audioBuffer);
      previewPlayer.play(0);
      previewId = item.id;
    }
    renderQueue();
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

  const PRESETS = [
    { id: 'm2f', key: 'convert.preset.m2f', values: { f0upKey: 12, indexRate: 0.75, protect: 0.33, rmsMixRate: 0.25, filterRadius: 3 } },
    { id: 'f2m', key: 'convert.preset.f2m', values: { f0upKey: -12, indexRate: 0.75, protect: 0.33, rmsMixRate: 0.25, filterRadius: 3 } },
    { id: 'same', key: 'convert.preset.same', values: { f0upKey: 0, indexRate: 0.6, protect: 0.3, rmsMixRate: 0.3, filterRadius: 3 } },
    { id: 'natural', key: 'convert.preset.natural', values: { f0upKey: 0, indexRate: 0.5, protect: 0.45, rmsMixRate: 0.4, filterRadius: 5 } },
  ];

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

  const kbdHints = el('div.kbd-hints', {}, [
    el('span', {}, [el('kbd', {}, [], 'R'), ' ' + t('convert.kbd.record')]),
    el('span', {}, [el('kbd', {}, [], 'C'), ' ' + t('convert.kbd.convert')]),
    el('span', {}, [el('kbd', {}, [], 'Space'), ' ' + t('convert.kbd.play')]),
  ]);

  const modelWarn = el('div', { id: 'modelWarn', style: 'margin:6px 0 14px' });

  const paramCard = card(t('convert.step2'), { step: 2 }, [
    el('div.param-inline', {}, [
      el('div.field-block', {}, [
        el('label.field', {}, [el('span.field-label', {}, [], t('convert.model')), modelSelect]),
        modelWarn,
      ]),
      el('div.field-block', {}, [
        el('div.field-label', {}, [], t('convert.presets')),
        el('div.presets', { id: 'presetRow' }, PRESETS.map((p) => el('button.preset', {
          type: 'button', dataset: { preset: p.id }, onClick: () => applyPreset(p),
        }, [], t(p.key)))),
      ]),
    ]),
    el('div.sliders-row', {}, [pitch, indexRate, protect, rmsMix, filterRadius]),
    kbdHints,
    notice(t('convert.engine.warn'), { type: 'warn', icon: '⚠' }),
    runBtn,
    runStatus,
  ]);

  /** 预设写入参数、同步滑块 DOM，并立即保存。 */
  function applyPreset(preset) {
    const p = state.settings.params;
    state.settings.params = { ...p, ...preset.values };
    const inputs = paramCard.querySelectorAll('input[type=range]');
    const values = [preset.values.f0upKey, preset.values.indexRate, preset.values.protect, preset.values.rmsMixRate, preset.values.filterRadius];
    inputs.forEach((input, i) => {
      if (values[i] === undefined) return;
      input.value = String(values[i]);
      const valEl = input.closest('.slider-row')?.querySelector('.val');
      if (valEl) valEl.textContent = formatParam(input, Number(values[i]));
    });
    state.saveSettings({ params: state.settings.params });
    toast(t('toast.saved'), { type: 'ok', duration: 1600 });
    syncPresetActive();
  }

  function formatParam(input, v) {
    const step = Number(input.step || 1);
    return step >= 1 ? String(v) : v.toFixed(2);
  }

  function isPresetActive(preset) {
    const p = state.settings.params;
    return Object.entries(preset.values).every(([k, v]) => p[k] === v);
  }

  function syncPresetActive() {
    const p = state.settings.params;
    paramCard.querySelectorAll('.preset').forEach((node) => {
      const preset = PRESETS.find((x) => x.id === node.dataset.preset);
      const active = preset && Object.entries(preset.values).every(([k, v]) => p[k] === v);
      node.classList.toggle('active', !!active);
    });
  }

  function refreshModelHint() {
    const warn = $('#modelWarn');
    if (!warn) return;
    const m = entries.find((e) => e.id === state.ui.modelId);
    if (m) {
      warn.replaceChildren(el('div.faint', { style: 'margin:0' }, [],
        `${m.kind === 'base' ? 'Base' : 'Voice'} · ${m.license} · ${formatBytes(m.size || 0)}`));
      return;
    }
    warn.replaceChildren(compatible.length
      ? el('div.faint', { style: 'margin:0' }, [], '')
      : notice(t('convert.noModelForEngine'), { type: 'warn', icon: '⚠' }));
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
  const timeLabel = el('span.time', {}, [], '0:00 / 0:00');
  const dlBtn = btn(t('convert.result.download'), { variant: 'ghost', size: 'sm', onClick: () => downloadCurrent() });
  const dlZipBtn = btn(t('convert.result.downloadAll'), { variant: 'ghost', size: 'sm', onClick: () => downloadZip() });
  const metricsEl = el('div.faint', {}, [], '');

  const resultCard = card(t('convert.step3'), { step: 3 }, [
    waveBox,
    el('div.player', {}, [playBtn, timeLabel]),
    el('div.row', { style: 'margin-top:12px' }, [dlBtn, dlZipBtn]),
    metricsEl,
  ]);
  // 结果卡横跨整行，给波形和指标留出宽度
  resultCard.classList.add('card-wide');

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
    renderTabs();
    renderTabPanels();
    syncQueueCount();
    refreshModelHint();
    syncRecBtn();
  }

  /* 快捷键：R 录音、C 转换、空格播放结果、Backspace 清空队列（输入框内不拦截） */
  const onKey = (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); recorder.recording ? stopRecording() : startRecording(); }
    else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); runConversion(); }
    else if (e.code === 'Space' && currentResult) { e.preventDefault(); player.toggle(); updatePlayBtn(player.playing); }
    else if (e.key === 'Backspace' && state.ui.queue.length) { e.preventDefault(); clearQueue(); }
  };
  window.addEventListener('keydown', onKey);

  const stopRefresh = onLangChange(() => {
    renderTabs();
    renderTabPanels();
    syncRecBtn();
    syncQueueCount();
    dlBtn.textContent = t('convert.result.download');
    dlZipBtn.textContent = t('convert.result.downloadAll');
    runBtn.textContent = t('convert.start');
    refreshModelHint();
    syncPresetActive();
    const presetRow = $('#presetRow');
    if (presetRow) {
      presetRow.replaceChildren(...PRESETS.map((p) => el('button.preset' + (isPresetActive(p) ? '.active' : ''), {
        type: 'button', dataset: { preset: p.id }, onClick: () => applyPreset(p),
      }, [], t(p.key))));
    }
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
  syncPresetActive();
  syncRecBtn();
  if (state.ui.modelId) modelSelect.value = state.ui.modelId;

  return {
    destroy() {
      clearTimeout(saveTimer);
      stopRefresh();
      window.removeEventListener('keydown', onKey);
      player.stop();
      previewPlayer?.stop();
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
