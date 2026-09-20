/**
 * 国际化模块
 * 用法：t('nav.convert') 取当前语言文案；applyI18n(root) 扫描 [data-i18n] 节点替换文本。
 */

const DICT = {
  zh: {
    'brand.tag': '网页端声音克隆',

    'nav.convert': '声音转换',
    'nav.models': '模型库',
    'nav.settings': '设置',
    'nav.help': '使用帮助',
    'nav.badge': 'v0.1.0 · 静态部署',

    'engine.unknown': '未连接',
    'engine.onnx': '浏览器引擎（ONNX）',
    'engine.server': '本地服务引擎',
    'engine.ready': '就绪',
    'engine.loading': '初始化中…',
    'engine.notReady': '未就绪',
    'engine.error': '异常',

    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.close': '关闭',
    'common.delete': '删除',
    'common.save': '保存',
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.retry': '重试',
    'common.back': '返回',
    'common.loading': '加载中…',
    'common.processing': '处理中…',
    'common.seconds': '秒',
    'common.optional': '可选',

    'convert.title': '声音转换',
    'convert.step1': '准备原始音频',
    'convert.step2': '选择音色与参数',
    'convert.step3': '转换结果',
    'convert.tab.record': '麦克风录制',
    'convert.tab.upload': '上传音频',
    'convert.tab.sample': '示例音频',
    'convert.rec.start': '开始录制',
    'convert.rec.stop': '停止录制',
    'convert.rec.doing': '录制中…',
    'convert.rec.recording': '正在录制，再次点击停止。',
    'convert.rec.hint': '建议录制 5–30 秒、安静环境、单人说话。',
    'convert.rec.denied': '麦克风权限被拒绝，请在浏览器地址栏的权限设置中允许后重试。',
    'convert.rec.noDevice': '未检测到可用的麦克风设备。',
    'convert.rec.empty': '录制时长太短，请至少录制 1 秒。',
    'convert.drop.title': '拖拽音频文件到此处，或点击选择',
    'convert.drop.hint': '支持 wav / mp3 / ogg / m4a / flac，单个文件 ≤ 50MB',
    'convert.drop.badType': '不支持的文件格式：{name}',
    'convert.drop.tooBig': '文件过大（>50MB）：{name}',
    'convert.sample.none': '暂无示例音频，请上传或录制。',
    'convert.files': '待处理队列',
    'convert.files.empty': '队列为空。支持一次拖入多个文件批量转换。',
    'convert.files.clear': '清空队列',
    'convert.files.remove': '移除',
    'convert.files.added': '已加入 {n} 个文件',
    'convert.model': '目标音色',
    'convert.model.empty': '模型库中还没有可用模型，去“模型库”下载或导入一个。',
    'convert.params': '参数微调',
    'convert.presets': '快速预设',
    'convert.preset.m2f': '男 → 女 +12',
    'convert.preset.f2m': '女 → 男 -12',
    'convert.preset.same': '同性别微调',
    'convert.preset.natural': '自然保真',
    'convert.preview': '试听原声',
    'convert.preview.stop': '停止试听',
    'convert.selected': '当前',
    'convert.kbd.record': '录音',
    'convert.kbd.convert': '转换',
    'convert.kbd.play': '播放结果',
    'convert.kbd.clear': '清空队列',
    'convert.noModelForEngine': '当前引擎没有可用模型：浏览器引擎需要 .onnx 模型，本地服务引擎需要 .pth 模型。',

    'convert.param.pitch': '变调（半音）',
    'convert.param.pitchHint': '男声转女声通常 +12，女声转男声通常 -12。',
    'convert.param.index': '索引强度',
    'convert.param.indexHint': '越高越像训练音色，0 表示不使用检索索引。',
    'convert.param.protect': '清音保护',
    'convert.param.protectHint': '保护清音（如 s、sh），过高会影响音色相似度。',
    'convert.param.rms': '音量包络混合',
    'convert.param.rmsHint': '保留一部分原始音量变化，让过渡更自然。',
    'convert.param.filter': '中值滤波半径',
    'convert.param.filterHint': '对音高曲线做平滑，减少抖动破音。',
    'convert.start': '开始转换',
    'convert.batch': '批量转换',
    'convert.running': '正在转换 {name}…',
    'convert.done': '转换完成：{name}',
    'convert.failed': '转换失败：{msg}',
    'convert.allDone': '全部完成，共 {n} 个文件',
    'convert.noInput': '请先准备原始音频',
    'convert.noModel': '请先选择目标音色',
    'convert.result': '输出结果',
    'convert.result.empty': '转换完成后在这里播放与下载。',
    'convert.result.play': '播放',
    'convert.result.stop': '停止',
    'convert.result.download': '下载 WAV',
    'convert.result.downloadAll': '打包下载 ZIP',
    'convert.result.metrics': '耗时 {ms}ms · 采样率 {sr}Hz · 引擎 {engine}',
    'convert.engine.warn': '当前引擎未就绪，请前往“设置”完成后重试。',
    'convert.stats.queue': '队列 {n}',
    'convert.stats.model': '音色 {name}',

    'models.title': '模型库',
    'models.sub': '基础模型用于浏览器内推理；音色模型可自行导入，我们不托管任何第三方人声音色。',
    'models.tab.base': '基础模型',
    'models.tab.voice': '音色模型',
    'models.tab.custom': '本地导入',
    'models.col.name': '名称',
    'models.col.kind': '类型',
    'models.col.size': '大小',
    'models.col.status': '状态',
    'models.col.action': '操作',
    'models.status.none': '未下载',
    'models.status.downloading': '下载中',
    'models.status.ready': '已就绪',
    'models.status.failed': '失败',
    'models.action.download': '下载',
    'models.action.cancel': '取消',
    'models.action.delete': '删除',
    'models.action.use': '设为当前',
    'models.action.info': '说明',
    'models.import.title': '导入本地模型',
    'models.import.formats': '支持 .onnx / .pth / .index 或其 zip 压缩包',
    'models.import.onnx': 'ONNX 模型包（浏览器引擎）',
    'models.import.pth': '.pth + .index（本地服务引擎）',
    'models.import.hint': '浏览器引擎需要 .onnx 模型，本地服务引擎需要 .pth（可加 .index 索引）。所有文件只保存在本机浏览器的 IndexedDB 中，不会上传。',
    'models.import.ok': '已导入模型：{name}',
    'models.import.bad': '无法识别的模型文件：{name}',
    'models.import.needIndex': '已导入 {name}（未提供索引文件，索引强度将被忽略）',
    'models.delete.ok': '已删除：{name}',
    'models.delete.confirm': '确定删除模型“{name}”？下次使用需要重新下载。',
    'models.cache': '缓存占用',
    'models.cache.clear': '清空缓存',
    'models.cache.cleared': '已清空 {bytes} 模型缓存',
    'models.cache.empty': '暂无缓存',
    'models.source.base': 'RVC 官方预处理模型（HuBERT / RMVPE）',
    'models.license': '许可证',
    'models.note': '说明',
    'models.self': '自定义',
    'models.empty.voice': '仓库不托管任何第三方人声音色。请导入自己训练的模型，或从下方“模型来源”获取后导入；网页引擎还需要先用 tools/export_onnx.py 转成 .onnx。',
    'models.empty.imported': '还没有导入的模型。把 .onnx（浏览器引擎）或 .pth + .index（本地服务引擎）拖到上方导入区即可。',
    'models.base.needConvert': '需转换',
    'models.base.whyConvert': '官方预处理模型是 .pt 格式，无法在浏览器中直接加载，需先转换成 .onnx 才能用于浏览器引擎。',
    'models.action.convertGuide': '转换方法',

    'settings.title': '设置',
    'settings.engine': '推理引擎',
    'settings.engine.onnx': '浏览器引擎',
    'settings.engine.server': '本地服务引擎',
    'settings.engine.onnx.desc': '在浏览器内完成全部推理，零安装、隐私不出本机；需要下载模型，首次加载较慢。',
    'settings.engine.server.desc': '连接你本机的 RVC 服务，速度与音质最佳；需要先按文档启动本地服务。',
    'settings.server.url': '服务地址',
    'settings.server.urlHint': '本地 RVC API 桥，默认 http://127.0.0.1:7865',
    'settings.server.test': '测试连接',
    'settings.server.testing': '测试中…',
    'settings.server.ok': '连接成功：{detail}',
    'settings.server.fail': '连接失败：{msg}',
    'settings.server.hint': '提示：静态页面跨域访问本地服务时，请使用随附的 server/bridge.py 作为桥接层。',
    'settings.audio': '音频',
    'settings.audio.outRate': '输出采样率',
    'settings.audio.rate.keep': '跟随源文件',
    'settings.appearance': '外观',
    'settings.appearance.theme': '主题',
    'settings.appearance.theme.fixed': '固定深色：液态金属背景 + 玻璃面板（与 ForJiang.github.io 同一套视觉语言）。',
    'settings.appearance.lang': '语言',
    'settings.data': '数据与隐私',
    'settings.data.desc': '所有音频与模型只保存在本机浏览器中。清空缓存会删除模型文件，但不会删除你的转换记录。',
    'settings.data.export': '导出设置 JSON',
    'settings.data.reset': '恢复默认设置',
    'settings.data.exported': '设置已导出',
    'settings.reset.ok': '已恢复默认设置',

    'help.title': '使用帮助',
    'help.toc': '目录',
    'help.sec.quick': '快速上手',
    'help.sec.flow': '标准流程',
    'help.sec.params': '参数怎么调',
    'help.sec.models': '如何获得自己的音色模型',
    'help.sec.engine': '两种引擎怎么选',
    'help.sec.faq': '常见问题',
    'help.sec.legal': '法律与伦理声明',

    'toast.copied': '已复制到剪贴板',
    'toast.copyFail': '复制失败，请手动选择文本',
    'toast.saved': '已保存',
    'storage.degraded': '浏览器存储不可用（{reason}），本次会话的设置与模型不会保存，刷新后需重新导入。',
    'update.available': '站点已更新到新版本',
    'update.hint': '点击立即刷新加载新版；忽略则继续使用当前版本。',
    'update.reload': '立即刷新',
    'toast.browserOld': '当前浏览器不支持部分音频特性，建议使用最新版 Chrome / Edge / Safari。',
  },

  en: {
    'brand.tag': 'Voice cloning in your browser',

    'nav.convert': 'Convert',
    'nav.models': 'Models',
    'nav.settings': 'Settings',
    'nav.help': 'Help',
    'nav.badge': 'v0.1.0 · static deploy',

    'engine.unknown': 'Not connected',
    'engine.onnx': 'Browser engine (ONNX)',
    'engine.server': 'Local server engine',
    'engine.ready': 'Ready',
    'engine.loading': 'Initializing…',
    'engine.notReady': 'Not ready',
    'engine.error': 'Error',

    'common.cancel': 'Cancel',
    'common.confirm': 'OK',
    'common.close': 'Close',
    'common.delete': 'Delete',
    'common.save': 'Save',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.retry': 'Retry',
    'common.back': 'Back',
    'common.loading': 'Loading…',
    'common.processing': 'Processing…',
    'common.seconds': 's',

    'convert.title': 'Convert',
    'convert.step1': 'Source audio',
    'convert.step2': 'Voice & parameters',
    'convert.step3': 'Result',
    'convert.tab.record': 'Record',
    'convert.tab.upload': 'Upload',
    'convert.tab.sample': 'Sample',
    'convert.rec.start': 'Start recording',
    'convert.rec.stop': 'Stop',
    'convert.rec.doing': 'Recording…',
    'convert.rec.recording': 'Recording — click again to stop.',
    'convert.rec.hint': 'Record 5–30s in a quiet room with a single speaker.',
    'convert.rec.denied': 'Microphone permission denied. Allow it in your browser and retry.',
    'convert.rec.noDevice': 'No microphone device found.',
    'convert.rec.empty': 'Recording too short, please record at least 1 second.',
    'convert.drop.title': 'Drop audio files here, or click to browse',
    'convert.drop.hint': 'wav / mp3 / ogg / m4a / flac, up to 50MB per file',
    'convert.drop.badType': 'Unsupported format: {name}',
    'convert.drop.tooBig': 'File too large (>50MB): {name}',
    'convert.sample.none': 'No sample audio bundled. Please upload or record.',
    'convert.files': 'Queue',
    'convert.files.empty': 'Queue is empty. Drop several files for batch conversion.',
    'convert.files.clear': 'Clear queue',
    'convert.files.remove': 'Remove',
    'convert.files.added': '{n} file(s) added',
    'convert.model': 'Target voice',
    'convert.model.empty': 'No voice model yet — download or import one in “Models”.',
    'convert.params': 'Fine-tune',
    'convert.presets': 'Quick presets',
    'convert.preset.m2f': 'M → F +12',
    'convert.preset.f2m': 'F → M -12',
    'convert.preset.same': 'Same pitch tune',
    'convert.preset.natural': 'Natural keep',
    'convert.preview': 'Preview source',
    'convert.preview.stop': 'Stop preview',
    'convert.selected': 'Active',
    'convert.kbd.record': 'record',
    'convert.kbd.convert': 'convert',
    'convert.kbd.play': 'play result',
    'convert.kbd.clear': 'clear queue',
    'convert.noModelForEngine': 'No model for this engine: browser engine needs .onnx, local server engine needs .pth.',

    'convert.param.pitch': 'Pitch shift (semitones)',
    'convert.param.pitchHint': 'Male→female usually +12, female→male usually -12.',
    'convert.param.index': 'Index rate',
    'convert.param.indexHint': 'Higher = closer to the trained timbre; 0 disables retrieval.',
    'convert.param.protect': 'Voiceless protection',
    'convert.param.protectHint': 'Protects voiceless sounds (s, sh); too high hurts similarity.',
    'convert.param.rms': 'RMS envelope mix',
    'convert.param.rmsHint': 'Keeps some original loudness envelope for natural transitions.',
    'convert.param.filter': 'Median filter radius',
    'convert.param.filterHint': 'Smooths the pitch curve, reducing wobble and artifacts.',
    'convert.start': 'Convert',
    'convert.batch': 'Convert all',
    'convert.running': 'Converting {name}…',
    'convert.done': 'Converted: {name}',
    'convert.failed': 'Conversion failed: {msg}',
    'convert.allDone': 'All done — {n} file(s)',
    'convert.noInput': 'Prepare the source audio first',
    'convert.noModel': 'Select a target voice first',
    'convert.result': 'Output',
    'convert.result.empty': 'Play and download the result here after conversion.',
    'convert.result.play': 'Play',
    'convert.result.stop': 'Stop',
    'convert.result.download': 'Download WAV',
    'convert.result.downloadAll': 'Download ZIP',
    'convert.result.metrics': '{ms}ms · {sr}Hz · {engine}',
    'convert.engine.warn': 'The engine is not ready — finish the setup in “Settings” first.',
    'convert.stats.queue': 'Queue {n}',
    'convert.stats.model': 'Voice {name}',

    'models.title': 'Models',
    'models.sub': 'Base models power in-browser inference. Voice models are user-provided — we host no third-party voices.',
    'models.tab.base': 'Base models',
    'models.tab.voice': 'Voice models',
    'models.tab.custom': 'Imported',
    'models.col.name': 'Name',
    'models.col.kind': 'Type',
    'models.col.size': 'Size',
    'models.col.status': 'Status',
    'models.col.action': 'Actions',
    'models.status.none': 'Not downloaded',
    'models.status.downloading': 'Downloading',
    'models.status.ready': 'Ready',
    'models.status.failed': 'Failed',
    'models.action.download': 'Download',
    'models.action.cancel': 'Cancel',
    'models.action.delete': 'Delete',
    'models.action.use': 'Use',
    'models.action.info': 'Info',
    'models.import.title': 'Import local models',
    'models.import.formats': 'Accepts .onnx / .pth / .index or a zip archive',
    'models.import.onnx': 'ONNX model pack (browser engine)',
    'models.import.pth': '.pth + .index (local server engine)',
    'models.import.hint': 'The browser engine needs .onnx models; the local server engine needs .pth (optionally with .index). Everything stays in your browser IndexedDB — nothing is uploaded.',
    'models.import.ok': 'Imported: {name}',
    'models.import.bad': 'Unrecognized model file: {name}',
    'models.import.needIndex': 'Imported {name} (no index file provided, index rate will be ignored)',
    'models.delete.ok': 'Deleted: {name}',
    'models.delete.confirm': 'Delete model “{name}”? It must be downloaded again for the next use.',
    'models.cache': 'Cache usage',
    'models.cache.clear': 'Clear cache',
    'models.cache.cleared': 'Freed {bytes} of model cache',
    'models.cache.empty': 'No cache yet',
    'models.source.base': 'Official RVC preprocessing models (HuBERT / RMVPE)',
    'models.license': 'License',
    'models.note': 'Note',
    'models.self': 'Custom',
    'models.empty.voice': 'No third-party voices are hosted here. Import a model you trained, or grab one from the sources below; the browser engine also needs it converted to .onnx with tools/export_onnx.py.',
    'models.empty.imported': 'No imported models yet. Drop .onnx (browser engine) or .pth + .index (local server engine) into the import area above.',
    'models.base.needConvert': 'Needs conversion',
    'models.base.whyConvert': 'The official preprocessing weights are .pt files, which cannot be loaded in the browser — convert them to .onnx first.',
    'models.action.convertGuide': 'How to convert',

    'settings.title': 'Settings',
    'settings.engine': 'Inference engine',
    'settings.engine.onnx': 'Browser engine',
    'settings.engine.server': 'Local server engine',
    'settings.engine.onnx.desc': 'All inference runs in the browser: zero install, fully private, but models must be downloaded and the first load is slow.',
    'settings.engine.server.desc': 'Talks to an RVC service on your machine: fastest and best quality, but requires the local bridge.',
    'settings.server.url': 'Service URL',
    'settings.server.urlHint': 'Local RVC API bridge, default http://127.0.0.1:7865',
    'settings.server.test': 'Test connection',
    'settings.server.testing': 'Testing…',
    'settings.server.ok': 'Connected: {detail}',
    'settings.server.fail': 'Connection failed: {msg}',
    'settings.server.hint': 'Note: a static page needs CORS to reach localhost — use the bundled server/bridge.py.',
    'settings.audio': 'Audio',
    'settings.audio.outRate': 'Output sample rate',
    'settings.audio.rate.keep': 'Follow source',
    'settings.appearance': 'Appearance',
    'settings.appearance.theme': 'Theme',
    'settings.appearance.theme.fixed': 'Dark only: liquid-metal background with glass panels (same visual language as ForJiang.github.io).',
    'settings.appearance.lang': 'Language',
    'settings.data': 'Data & privacy',
    'settings.data.desc': 'Audio and models stay on this machine only. Clearing cache removes model files, not your conversion history.',
    'settings.data.export': 'Export settings JSON',
    'settings.data.reset': 'Reset to defaults',
    'settings.data.exported': 'Settings exported',
    'settings.reset.ok': 'Settings reset',

    'help.title': 'Help',
    'help.toc': 'Contents',
    'help.sec.quick': 'Quick start',
    'help.sec.flow': 'Typical workflow',
    'help.sec.params': 'Tuning parameters',
    'help.sec.models': 'Getting your own voice model',
    'help.sec.engine': 'Choosing an engine',
    'help.sec.faq': 'FAQ',
    'help.sec.legal': 'Legal & ethics',

    'toast.copied': 'Copied to clipboard',
    'toast.copyFail': 'Copy failed — please select the text manually',
    'toast.saved': 'Saved',
    'storage.degraded': 'Browser storage is unavailable ({reason}). Settings and models will not persist in this session.',
    'update.available': 'A new version is available',
    'update.hint': 'Click to reload with the new version, or keep using the current one.',
    'update.reload': 'Reload now',
    'toast.browserOld': 'This browser lacks some audio features; use the latest Chrome / Edge / Safari.',
  },
};

let lang = 'zh';
const listeners = new Set();

function detectLang() {
  const saved = safeGet('rvc.lang');
  if (saved === 'zh' || saved === 'en') return saved;
  const nav = (navigator.language || 'zh').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* 隐私模式下忽略 */ }
}

export function getLang() {
  return lang;
}

export function setLang(next, { persist = true } = {}) {
  if (!DICT[next] || next === lang) return lang;
  lang = next;
  if (persist) safeSet('rvc.lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  applyI18n(document);
  listeners.forEach((fn) => fn(lang));
  return lang;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 取当前语言文案，支持 {name} 占位符替换。 */
export function t(key, vars) {
  const s = DICT[lang]?.[key] ?? DICT.zh[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

/** 扫描 DOM，把 [data-i18n] 的文本/标题替换为当前语言。 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val && val !== key) el.textContent = val;
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const titleKey = el.getAttribute('data-i18n-title');
    const val = t(titleKey);
    if (val && val !== titleKey) el.title = val;
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const phKey = el.getAttribute('data-i18n-placeholder');
    const val = t(phKey);
    if (val && val !== phKey) el.placeholder = val;
  });
}

export function initI18n() {
  lang = detectLang();
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  applyI18n(document);
  return lang;
}
