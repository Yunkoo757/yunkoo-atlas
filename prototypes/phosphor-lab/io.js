(function () {
  'use strict';

  const format = 'phosphor-lab.preset';
  const version = 1;
  const maxBytes = 64 * 1024;

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  function downloadJSON(state) {
    const parameters = window.PhosphorControls.normalize(state);
    const json = JSON.stringify({ format, version, parameters }, null, 2) + '\n';
    download(new Blob([json], { type: 'application/json;charset=utf-8' }), `phosphor-${parameters.seed}.json`);
  }

  async function importJSON(file) {
    if (!file || file.size === 0) throw new Error('请选择含有调参数据的 JSON 文件');
    if (file.size > maxBytes) throw new Error('参数文件过大，最大支持 64 KB');
    let text;
    try {
      text = await file.text();
    } catch {
      throw new Error('无法读取参数文件，请重新选择');
    }
    let documentData;
    try {
      documentData = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('JSON 格式有误，请检查文件内容');
    }
    if (documentData?.format !== format) throw new Error('请选择由磷光实验室导出的参数文件');
    if (documentData.version !== version) throw new Error('当前实验台无法读取这个版本的参数文件');

    const { parameters } = documentData;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      throw new Error('参数文件缺少有效的参数组');
    }
    const controls = window.PhosphorControls;
    const keys = Object.keys(controls.defaults).filter(key => Object.hasOwn(parameters, key));
    if (keys.length === 0) throw new Error('文件中没有可识别的动画参数');

    const values = {};
    for (const key of keys) {
      const value = parameters[key];
      const expected = typeof controls.defaults[key];
      if (typeof value !== expected || (expected === 'number' && !Number.isFinite(value))) {
        throw new Error(`请检查参数 ${key} 的格式`);
      }
      values[key] = value;
    }
    const normalized = controls.normalize(values);
    for (const key of keys) {
      const value = key === 'color' ? values[key].toLowerCase() : values[key];
      if (normalized[key] !== value) throw new Error(`参数 ${key} 超出可用范围`);
    }
    return normalized;
  }

  async function saveImage(canvas) {
    if (!canvas?.width || !canvas.height) throw new Error('画面尚未就绪，请稍后再试');
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!image) throw new Error('当前帧未能生成图像，请再试一次');
    download(image, 'phosphor-frame.png');
  }

  // This function runs in the exported document. Keep its dependencies inside it.
  function playStandalone(parameters) {
    const canvas = document.querySelector('canvas');
    const renderer = window.PhosphorEngine.create(canvas);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let elapsed = 0;
    let previous = null;
    let request = 0;

    function draw(now) {
      request = 0;
      if (document.hidden) return;
      if (previous !== null && !reduced.matches) {
        elapsed += Math.min((now - previous) / 1000, 0.1) * parameters.speed;
      }
      previous = now;
      renderer.render(parameters, elapsed);
      if (!reduced.matches) request = requestAnimationFrame(draw);
    }

    function refresh() {
      cancelAnimationFrame(request);
      previous = null;
      if (!document.hidden) request = requestAnimationFrame(draw);
    }

    function watchResolution() {
      const resolution = matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
      resolution.addEventListener('change', () => {
        watchResolution();
        refresh();
      }, { once: true });
    }

    reduced.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('pageshow', refresh);
    watchResolution();
    refresh();
  }

  function downloadAnimation(state) {
    const engine = window.PhosphorEngine.source;
    if (typeof engine !== 'string' || !engine.length) throw new Error('动画引擎尚未就绪，请稍后再试');
    const parameters = window.PhosphorControls.normalize(state);
    const json = JSON.stringify(parameters).replace(/[<>&\u2028\u2029]/g, character =>
      '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    const script = (engine + '\n;(' + playStandalone.toString() + ')(' + json + ');')
      .replace(/<\/script/gi, '<\\/script');
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>磷光 · 加载动效</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #0b100f; color: #b3c4bd; font: 12px system-ui, sans-serif; }
main { position: fixed; inset: 0; }
canvas { display: block; width: 100%; height: 100%; }
.status { position: absolute; bottom: max(5%, 20px); left: 50%; transform: translateX(-50%); letter-spacing: .12em; }
</style>
</head>
<body><main><canvas aria-hidden="true"></canvas><span class="status" role="status">载入中</span></main>
<script>${script}</script>
</body>
</html>\n`;
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `phosphor-${parameters.seed}.html`);
  }

  window.PhosphorIO = Object.freeze({ downloadJSON, importJSON, saveImage, downloadAnimation });
})();
