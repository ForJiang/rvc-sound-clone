/**
 * 使用帮助页：流程说明、参数解释、模型获取、引擎选择、FAQ 与法律声明。
 * 内容同时提供中英文，随界面语言切换。
 */

import { t, onLangChange } from '../i18n.js';
import { el, notice, btn, copyText } from '../ui.js';

const DOC = {
  zh: {
    toc: ['快速上手', '标准流程', '参数怎么调', '如何获得自己的音色模型', '两种引擎怎么选', '常见问题', '法律与伦理声明'],
    quick: [
      '本工具完全在浏览器里运行，音频不会离开你的设备。两种用法：',
    ],
    quickList: [
      '网页版：直接打开部署好的 GitHub Pages 链接即可使用，音色模型需要你自己上传或下载。',
      '本地使用：python3 -m http.server 8080 后访问 http://127.0.0.1:8080。',
    ],
    flow: [
      '准备音频：可以对着麦克风念一段 5～30 秒的话，也可以上传已有的 wav/mp3/flac 文件。',
      '选择音色：在“模型库”里下载基础模型，或导入一个 .onnx / .pth 模型。',
      '调参：先用默认值试一次，不满意再动“变调”。',
      '转换并导出：结果可在线播放，也能下载 WAV 或多个文件打包成 ZIP。',
    ],
    params: [
      ['变调（半音）', '男声转女声通常 +12，女声转男声通常 -12。这是新手最容易忽略但最影响效果的参数。'],
      ['索引强度', '使用检索索引逼近训练音色的程度。0.6～0.8 通常最自然，调到 1 可能出现过拟合的机械感。'],
      ['清音保护', '保护 s / sh / f 这类清音，避免被糊掉。0.33 是社区常用默认值。'],
      ['音量包络混合', '保留一部分原始录音的音量起伏，让语气更像真人。'],
      ['中值滤波半径', '对音高曲线做平滑，压制颤音和破音；0 表示不平滑。'],
    ],
    models: [
      '我们不托管任何人声音色模型，你可以在“模型库 → 音色模型”中下载社区公开模型，或导入自己训练的模型。',
      '自己训练：使用官方的 Retrieval-based-Voice-Conversion-WebUI 准备 10～20 分钟干净干声（去伴奏、单人、安静环境）即可开始训练。',
      '网页里直接用需要 ONNX 版本模型：用仓库内 tools/export_onnx.py 把 .pth 转成四份 onnx 后打包导入。',
    ],
    engine: [
      ['浏览器引擎', '零安装、完全本地、隐私最好；首次要下载几百 MB 模型，速度取决于你的设备。'],
      ['本地服务引擎', '连你自己机器上跑的 RVC 服务，速度快、音质最好；需要先用 server/ 目录下的脚本启动服务。'],
    ],
    faq: [
      ['页面打不开 / 一直加载？', '确认用 http:// 或 https:// 打开（file:// 不行），并检查网络能否访问 jsdelivr CDN。'],
      ['麦克风没反应？', '浏览器只允许 HTTPS 或 localhost 使用麦克风，请检查地址栏权限设置。'],
      ['转换很慢？', '浏览器引擎受设备性能限制， shortening 音频到 20 秒以内、或改用本地服务引擎。'],
      ['结果有金属音或杂音？', '降低索引强度、增大中值滤波半径，或换一段更干净的原始录音。'],
      ['数据存在哪里？', '音频和模型只存在浏览器 IndexedDB 中，清空浏览器数据即彻底删除。'],
    ],
    legal: '声音克隆涉及个人人格权益。请只克隆你本人或已获得明确授权的声音，不要伪造他人身份、不要用于诈骗、诽谤或任何违法用途。使用者需自行承担相应法律责任，本项目作者不对滥用行为负责。',
  },
  en: {
    toc: ['Quick start', 'Typical workflow', 'Tuning parameters', 'Getting your own voice model', 'Choosing an engine', 'FAQ', 'Legal & ethics'],
    quick: [
      'Everything runs in your browser; your audio never leaves the device. Two ways to use it:',
    ],
    quickList: [
      'Hosted: open the GitHub Pages link. Voice models must be uploaded or downloaded by you.',
      'Locally: python3 -m http.server 8080, then open http://127.0.0.1:8080.',
    ],
    flow: [
      'Prepare audio: record 5–30s through your microphone, or upload an existing wav/mp3/flac.',
      'Pick a voice: download the base models in “Models”, or import a .onnx / .pth model.',
      'Tune: try defaults first, then adjust pitch shift if the timbre feels off.',
      'Convert and export: play online, download WAV, or download several results as ZIP.',
    ],
    params: [
      ['Pitch shift (semitones)', 'Male→female usually +12, female→male usually -12. The most impactful parameter.'],
      ['Index rate', 'How much the retrieval index is used. 0.6–0.8 is usually natural; 1 can sound mechanical.'],
      ['Voiceless protection', 'Protects s / sh / f from being smeared. 0.33 is the community default.'],
      ['RMS envelope mix', 'Keeps part of the original loudness envelope so the delivery sounds human.'],
      ['Median filter radius', 'Smooths the pitch curve, removing wobble and artifacts. 0 disables smoothing.'],
    ],
    models: [
      'We host no third-party voice models. Download community models in “Models → Voice models”, or import your own.',
      'Training yourself: use the official Retrieval-based-Voice-Conversion-WebUI with 10–20 minutes of clean solo dry vocals.',
      'For in-browser use you need ONNX models: convert a .pth with tools/export_onnx.py and import the four files.',
    ],
    engine: [
      ['Browser engine', 'Zero install, fully private; first load downloads hundreds of MB and depends on your device.'],
      ['Local server engine', 'Talks to an RVC service on your machine: faster and better quality, but requires the bundled server.'],
    ],
    faq: [
      ['The page never finishes loading?', 'Open it over http:// or https:// (file:// will not work) and check access to the jsdelivr CDN.'],
      ['Microphone silent?', 'Browsers require HTTPS or localhost for mic access — check the permission icon in the address bar.'],
      ['Conversion is slow?', 'The browser engine is device-bound: shorten the audio to under 20s or switch to the local server engine.'],
      ['Metallic or noisy output?', 'Lower index rate, raise median filter radius, or use a cleaner source recording.'],
      ['Where is my data stored?', 'Audio and models live only in browser IndexedDB; clearing site data removes them completely.'],
    ],
    legal: 'Voice cloning touches personal likeness rights. Only clone your own voice or a voice you are explicitly authorized to use. Do not impersonate others or use this for fraud, defamation, or any unlawful purpose. Users bear full responsibility; the authors take no responsibility for misuse.',
  },
};

const SECTIONS = [
  { key: 'quick', icon: '⚡' },
  { key: 'flow', icon: '🪜' },
  { key: 'params', icon: '🎚' },
  { key: 'models', icon: '🎭' },
  { key: 'engine', icon: '🧩' },
  { key: 'faq', icon: '❓' },
  { key: 'legal', icon: '⚖' },
];

export async function viewHelp(root) {
  const body = el('div.doc');
  render();

  function render() {
    const lang = t('nav.convert') === 'Convert' ? 'en' : 'zh';
    const d = DOC[lang];
    const slug = (i, title) => `sec-${i}-${encodeURIComponent(title)}`;

    body.replaceChildren(
      el('h1.page-title', {}, [], t('help.title')),
      el('p.lead', {}, [], t('brand.tag')),
      stepsStrip(d),
      el('div.anchor-list', {}, d.toc.map((title, i) =>
        el('a', { href: '#' + slug(i, title) }, [], title))),

      quickSection(d, slug(0, d.toc[0])),
      flowSection(d, slug(1, d.toc[1])),
      paramsSection(d, slug(2, d.toc[2])),
      modelsSection(d, slug(3, d.toc[3])),
      engineSection(d, slug(4, d.toc[4])),
      faqSection(d, slug(5, d.toc[5])),
      el('section', { id: slug(6, d.toc[6]) }, [
        el('h2', {}, [], SECTIONS[6].icon + ' ' + d.toc[6]),
        notice(d.legal, { type: 'warn', icon: '⚠' }),
      ]),
      footer(),
    );
  }

  function stepsStrip(d) {
    const items = [
      { num: '01', key: 0, desc: d.flow[0] },
      { num: '02', key: 1, desc: d.flow[1] },
      { num: '03', key: 2, desc: d.flow[2] },
      { num: '04', key: 3, desc: d.flow[3] },
    ];
    return el('div.steps-strip', {}, items.map((it) => el('div.step-card', {}, [
      el('div.sc-num', {}, [], it.num),
      el('div.sc-title', {}, [], d.toc[it.key]),
      el('div.sc-desc', {}, [], it.desc),
    ])));
  }

  function quickSection(d, id) {
    return el('section', { id }, [
      el('h2', {}, [], SECTIONS[0].icon + ' ' + d.toc[0]),
      ...d.quick.map((p) => el('p', {}, [], p)),
      el('ul', {}, d.quickList.map((li) => el('li', {}, [], li))),
      el('pre', {}, [el('code', {}, [], '# 本地运行\npython3 -m http.server 8080\n# 然后打开 http://127.0.0.1:8080')]),
    ]);
  }

  function flowSection(d, id) {
    return el('section', { id }, [
      el('h2', {}, [], SECTIONS[1].icon + ' ' + d.toc[1]),
      el('ol', {}, d.flow.map((li) => el('li', {}, [], li))),
    ]);
  }

  function paramsSection(d, id) {
    return el('section', { id }, [
      el('h2', {}, [], SECTIONS[2].icon + ' ' + d.toc[2]),
      el('div.table-wrap', {}, [el('table.data', {}, [
        el('thead', {}, [el('tr', {}, [el('th', {}, [], lang() === 'zh' ? '参数' : 'Parameter'), el('th', {}, [], lang() === 'zh' ? '怎么调' : 'How to tune')])]),
        el('tbody', {}, d.params.map(([k, v]) => el('tr', {}, [el('td', { style: 'white-space:nowrap' }, [], k), el('td', {}, [], v)]))),
      ])]),
    ]);
  }

  function modelsSection(d, id) {
    return el('section', { id }, [
      el('h2', {}, [], SECTIONS[3].icon + ' ' + d.toc[3]),
      el('ul', {}, d.models.map((li) => el('li', {}, [], li))),
      el('pre', {}, [el('code', {}, [], '# 把 .pth 转成网页可用的 ONNX\npython3 tools/export_onnx.py --pth models/weights/MyVoice.pth --out ./my-voice-onnx')]),
    ]);
  }

  function engineSection(d, id) {
    return el('section', { id }, [
      el('h2', {}, [], SECTIONS[4].icon + ' ' + d.toc[4]),
      el('div.table-wrap', {}, [el('table.data', {}, [
        el('thead', {}, [el('tr', {}, [el('th', {}, [], lang() === 'zh' ? '引擎' : 'Engine'), el('th', {}, [], '')])]),
        el('tbody', {}, d.engine.map(([k, v]) => el('tr', {}, [el('td', { style: 'white-space:nowrap' }, [], k), el('td', {}, [], v)]))),
      ])]),
    ]);
  }

  function faqSection(d, id) {
    return el('section', { id }, [
      el('h2', {}, [], SECTIONS[5].icon + ' ' + d.toc[5]),
      ...d.faq.map(([q, a]) => el('div', { style: 'margin-bottom:10px' }, [
        el('h3', { style: 'margin:0 0 2px' }, [], 'Q：' + q),
        el('p', { style: 'margin:0' }, [], a),
      ])),
    ]);
  }

  function footer() {
    const isZh = lang() === 'zh';
    return el('section.card', { style: 'margin-top:18px' }, [
      el('h2', { style: 'margin-top:0' }, [], isZh ? '更多文档' : 'More docs'),
      el('div.row', {}, [
        el('a.btn.sm', { href: 'https://github.com/ForJiang/rvc-sound-clone', target: '_blank', rel: 'noreferrer' }, [], 'GitHub'),
        el('a.btn.sm', { href: 'docs/usage.md', target: '_blank', rel: 'noreferrer' }, [], isZh ? '使用说明' : 'Usage'),
        el('a.btn.sm', { href: 'docs/model-conversion.md', target: '_blank', rel: 'noreferrer' }, [], isZh ? '模型转换' : 'Model conversion'),
        el('a.btn.sm', { href: 'docs/faq.md', target: '_blank', rel: 'noreferrer' }, [], 'FAQ'),
        btn(isZh ? '复制部署命令' : 'Copy deploy command', {
          size: 'sm', variant: 'ghost',
          onClick: () => copyText('git clone https://github.com/ForJiang/rvc-sound-clone.git && cd rvc-sound-clone && python3 -m http.server 8080'),
        }),
      ]),
    ]);
  }

  function lang() {
    return document.documentElement.lang?.startsWith('en') ? 'en' : 'zh';
  }

  root.append(body);

  const stop = onLangChange(render);
  return { destroy: () => stop() };
}

export { SECTIONS };
