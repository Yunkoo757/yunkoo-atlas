(() => {
  'use strict'

  const $ = id => document.getElementById(id)
  const controls = window.PhosphorControls
  const renderer = window.PhosphorEngine.create($('output'))
  const presets = controls.presets
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const storageKey = 'phosphor-lab.session.v1'
  const modes = { scope: 'X–Y VECTOR', matrix: 'DOT MATRIX', raster: 'RASTER SCAN' }
  const presetModes = { scope: '矢量示波器', matrix: '点阵显示', raster: '光栅扫描' }
  let saved
  try { saved = JSON.parse(localStorage.getItem(storageKey)) } catch { /* File storage can be unavailable. */ }
  let base = presets.find(preset => preset.id === saved?.preset) || presets[0]
  let state = controls.normalize(saved?.parameters || base.state)
  let elapsed = 0
  let running = !media.matches
  let request = 0
  let previous = null
  let sampleDuration = 0
  let sampleFrames = 0
  let lastTenth = -1
  let hasFrame = false
  let focused = false
  let notificationTimer
  const timings = []
  const view = controls.mount($('controls'), patch => change({ ...state, ...patch }))

  const paths = {
    fullscreen: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
    expand: 'M14 4h6v6m0-6-7 7M4 14v6h6m-6 0 7-7',
    collapse: 'M20 10h-6V4m0 6 7-7M4 14h6v6m0-6-7 7',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4',
    download: 'M12 3v13m-5-5 5 5 5-5M4 17v3h16v-3',
    down: 'm6 9 6 6 6-6', motion: 'M4 17c3 0 4-10 7-10s2 10 5 10 3-6 5-6',
    sliders: 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m8 4v6',
    image: 'M4 4h16v16H4ZM5 17l5-5 3 3 3-4 4 4M15 8h.15',
    pause: 'M8.5 5.5v13m7-13v13', play: 'M7 4.5 18.5 12 7 19.5Z',
    rewind: 'M5.5 5v14M18.5 5 8 12l10.5 7Z',
    reset: 'M5 4v5h5M5.5 9a7.6 7.6 0 1 1-.2 6',
    dice: 'M6 3.5h12a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5Zm2.2 4.8h.15m3.55 3.7h.15m3.55 3.7h.15',
  }
  const masks = new Map()
  function icon(node, name) {
    if (!masks.has(name)) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.scale(64 / 24, 64 / 24)
      ctx.strokeStyle = ctx.fillStyle = '#fff'
      ctx.lineWidth = name === 'pause' ? 3.5 : 1.65
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const path = new Path2D(paths[name])
      if (name === 'play') ctx.fill(path)
      else ctx.stroke(path)
      masks.set(name, 'url(' + canvas.toDataURL() + ')')
    }
    node.style.maskImage = node.style.webkitMaskImage = masks.get(name)
    node.setAttribute('aria-hidden', 'true')
  }
  document.querySelectorAll('[data-icon]').forEach(node => icon(node, node.dataset.icon))
  const brand = document.querySelector('.brand-mark').getContext('2d')
  brand.lineWidth = 1.9
  brand.strokeStyle = '#e2b981'
  for (let j = 0; j < 6; j++) {
    brand.beginPath()
    for (let i = 0; i <= 96; i++) {
      const a = i * Math.PI / 48
      const x = 32 + 24 * Math.cos(a) * .89 + (2 + 2.5 * j) * Math.sin(a) * .46
      const y = 32 - 24 * Math.cos(a) * .46 + (2 + 2.5 * j) * Math.sin(a) * .89 + 5 * Math.sin(a + j * .54)
      if (i === 0) brand.moveTo(x, y)
      else brand.lineTo(x, y)
    }
    brand.closePath()
    brand.stroke()
  }

  const cards = []
  function createPresets() {
    for (const preset of presets) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'preset-card'
      button.dataset.preset = preset.id
      const art = document.createElement('canvas')
      art.setAttribute('aria-hidden', 'true')
      const desc = document.createElement('span')
      desc.className = 'preset-desc'
      const name = document.createElement('strong')
      name.textContent = preset.name
      const mode = document.createElement('small')
      mode.textContent = presetModes[preset.state.screen]
      desc.append(name, mode)
      button.append(art, desc)
      button.addEventListener('click', () => choose(preset))
      $('presets').append(button)
      cards.push({ preset, button, art })
    }
  }
  function drawThumbnails() {
    for (const { preset, art } of cards) {
      if (!art.clientWidth) continue
      const miniature = window.PhosphorEngine.create(art)
      miniature.render(preset.state, 1.6)
      miniature.destroy()
    }
  }
  function setBaseIndicators() {
    for (const { preset, button } of cards) button.setAttribute('aria-pressed', String(preset === base))
    const modified = Object.keys(state).some(key => state[key] !== base.state[key])
    $('preset-status').textContent = modified ? base.name + ' · 已调整' : ''
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ preset: base.id, parameters: state })) }
    catch { /* Editing and export still work without local storage. */ }
  }
  function change(next, restart = false) {
    const old = state
    state = controls.normalize(next)
    if (restart || ['shape', 'screen', 'seed'].some(key => old[key] !== state[key])) renderer.reset()
    if (restart) { elapsed = 0; previous = null }
    view.set(state)
    document.documentElement.style.setProperty('--phosphor', state.color)
    $('signal-mode').textContent = modes[state.screen]
    setBaseIndicators()
    persist()
    queueFrame()
  }
  function choose(preset) {
    base = preset
    change(preset.state, true)
  }
  function notice(message) {
    clearTimeout(notificationTimer)
    $('notice').textContent = message
    $('notice').hidden = false
    notificationTimer = setTimeout(() => { $('notice').hidden = true }, 3000)
  }

  function queueFrame() {
    if (!request && !document.hidden) request = requestAnimationFrame(frame)
  }
  function drawTrace() {
    const ctx = $('frame-trace').getContext('2d')
    ctx.clearRect(0, 0, 108, 32)
    ctx.beginPath()
    ctx.lineWidth = 1.7
    ctx.strokeStyle = '#a3b3a2'
    timings.forEach((ms, i) => {
      const x = 108 - (timings.length - 1 - i) * 3
      const y = 26 - Math.min(23, ms * .55)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }
  function frame(now) {
    request = 0
    const dt = previous === null ? 0 : Math.max(0, (now - previous) / 1000)
    if (running && dt > 0) {
      elapsed += Math.min(dt, .1) * state.speed
      sampleDuration += dt
      sampleFrames++
      timings.push(dt * 1000)
      if (timings.length > 37) timings.shift()
      if (sampleDuration >= .45) {
        $('fps').textContent = Math.round(sampleFrames / sampleDuration) + ' FPS'
        sampleDuration = sampleFrames = 0
        drawTrace()
      }
    }
    previous = running ? now : null
    renderer.render(state, elapsed)
    hasFrame = true
    const tenth = Math.floor(elapsed * 10)
    if (tenth !== lastTenth) {
      lastTenth = tenth
      const sec = Math.floor(tenth / 10)
      $('elapsed').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') + '.' + (tenth % 10)
      const active = Math.floor(elapsed * 2.5) % 3
      document.querySelectorAll('.loading-lights b').forEach((lamp, index) => { lamp.style.opacity = index === active ? 1 : .28 })
    }
    if (running) queueFrame()
  }
  function resetClockSample() {
    previous = null
    sampleDuration = sampleFrames = 0
    timings.length = 0
    drawTrace()
    $('fps').textContent = running ? '— FPS' : '已暂停'
  }
  function setPlaying(next) {
    running = next
    resetClockSample()
    const label = running ? '暂停播放' : '继续播放'
    $('play').setAttribute('aria-label', label)
    $('play').title = label + '（空格）'
    icon($('play').querySelector('i'), running ? 'pause' : 'play')
    if (running || !hasFrame) queueFrame()
    else {
      // Freeze the composited phosphor history at the exact displayed frame.
      cancelAnimationFrame(request)
      request = 0
    }
  }

  function setFocus(next) {
    focused = next
    document.body.classList.toggle('is-focused', next)
    $('leave-focus').hidden = !next
    $('focus-view').setAttribute('aria-pressed', String(next))
    $(next ? 'leave-focus' : 'focus-view').focus({ preventScroll: true })
    queueFrame()
  }
  $('focus-view').onclick = () => setFocus(true)
  $('leave-focus').onclick = () => setFocus(false)
  const fullscreenButton = $('fullscreen')
  const hasFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement)
  function syncFullscreen() {
    const active = hasFullscreen()
    const title = active ? '退出全屏' : '全屏实验台'
    fullscreenButton.title = title
    fullscreenButton.setAttribute('aria-label', title)
    fullscreenButton.setAttribute('aria-pressed', String(active))
    icon(fullscreenButton.querySelector('i'), active ? 'collapse' : 'fullscreen')
  }
  fullscreenButton.onclick = async () => {
    try {
      if (hasFullscreen()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement)
    } catch { notice('当前窗口无法进入全屏，可使用专注预览') }
  }
  document.addEventListener('fullscreenchange', syncFullscreen)
  document.addEventListener('webkitfullscreenchange', syncFullscreen)

  $('play').onclick = () => setPlaying(!running)
  $('rewind').setAttribute('aria-label', '回到起点')
  $('rewind').onclick = () => { elapsed = 0; previous = null; renderer.reset(); queueFrame() }
  $('reset').onclick = () => { choose(base); notice('已还原' + base.name + '预设') }
  $('random').onclick = () => {
    const random = crypto.getRandomValues(new Uint32Array(1))[0]
    const seed = 1 + (state.seed + random % 9998) % 9999
    change({ ...state, seed })
    notice('噪声种子 ' + seed)
  }
  $('import').onclick = () => $('import-file').click()
  $('import-file').onchange = async event => {
    const input = event.currentTarget
    const file = input.files[0]
    if (!file) return
    try {
      const values = await window.PhosphorIO.importJSON(file)
      base = presets.find(preset => preset.state.shape === values.shape) || base
      change(values, true)
      notice('已导入参数')
    } catch (error) { notice(error.message) }
    input.value = ''
  }

  const exports = $('export-list')
  const exportButton = $('export')
  function setExportMenu(open, restoreFocus = false) {
    exports.hidden = !open
    exportButton.setAttribute('aria-expanded', String(open))
    if (open) exports.querySelector('button').focus()
    else if (restoreFocus) exportButton.focus()
  }
  exportButton.onclick = () => setExportMenu(exports.hidden)
  exportButton.onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setExportMenu(true) }
  }
  exports.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const choices = [...exports.querySelectorAll('button')]
    const index = choices.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
      (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length
    choices[next].focus()
  }
  exports.onclick = async event => {
    const type = event.target.closest('[data-export]')?.dataset.export
    if (!type) return
    setExportMenu(false, true)
    try {
      if (type === 'html') window.PhosphorIO.downloadAnimation(state)
      if (type === 'json') window.PhosphorIO.downloadJSON(state)
      if (type === 'png') await window.PhosphorIO.saveImage($('output'))
      notice('已导出 ' + type.toUpperCase())
    } catch (error) { notice(error.message) }
  }
  function closeOutside(event) {
    if (!exports.hidden && !event.target.closest('.export-wrap')) setExportMenu(false)
  }
  document.addEventListener('pointerdown', closeOutside)
  document.addEventListener('focusin', closeOutside)
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.repeat || event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key === 'Escape') {
      if (!exports.hidden) setExportMenu(false, true)
      else if (focused) setFocus(false)
      return
    }
    if (event.target.closest('select, input, textarea, [contenteditable=true]') || !exports.hidden) return
    if (event.code === 'KeyF') { event.preventDefault(); setFocus(!focused) }
    if (event.code === 'Space' && !event.target.closest('button,summary,a')) { event.preventDefault(); setPlaying(!running) }
  })
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(request)
    request = 0
    resetClockSample()
    queueFrame()
  })
  media.addEventListener('change', () => setPlaying(!media.matches))
  createPresets()
  view.set(state)
  setBaseIndicators()
  $('signal-mode').textContent = modes[state.screen]
  document.documentElement.style.setProperty('--phosphor', state.color)
  setPlaying(running)
  syncFullscreen()
  const sizeObserver = new ResizeObserver(() => {
    const screen = $('screen')
    $('screen-size').textContent = screen.clientWidth + ' × ' + screen.clientHeight
    queueFrame()
  })
  sizeObserver.observe($('screen'))
  const thumbnailObserver = new ResizeObserver(drawThumbnails)
  thumbnailObserver.observe($('presets'))
})()
