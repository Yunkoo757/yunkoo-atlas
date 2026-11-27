(() => {
  'use strict'

  const shapes = {
    torus: '环面轨迹', harmonic: '谐振结', wave: '波面',
    attractor: '洛伦兹吸引子', rose: '玫瑰曲线',
  }
  const screens = { scope: '矢量示波器', matrix: '点阵屏', raster: '扫描光栅' }
  const percent = value => Math.round(value * 100) + '%'
  const multiple = value => value.toFixed(2) + '×'
  const fields = {
    speed:      { label: '演进速度', min: 0.1, max: 2.5, step: 0.05, format: multiple },
    complexity: { label: '曲线复杂度', min: 2, max: 12, step: 1, format: String },
    noise:      { label: '噪声强度', min: 0, max: 1, step: 0.01, format: percent },
    scale:      { label: '噪声频率', min: 0.5, max: 4, step: 0.05, format: multiple },
    trail:      { label: '余辉长度', min: 0, max: 1, step: 0.01, format: percent },
    glow:       { label: '辉光强度', min: 0, max: 1, step: 0.01, format: percent },
    pitch:      { label: '显像间距', min: 1, max: 7, step: 1, format: value => value + ' px' },
    scan:       { label: '扫描线强度', min: 0, max: 1, step: 0.01, format: percent },
    seed:       { label: '噪声种子', min: 1, max: 9999, step: 1, format: String },
  }
  const swatches = [
    ['#91efc4', '磷光绿'], ['#ffbf77', '琥珀'], ['#94caff', '冰蓝'], ['#f1dbe6', '瓷粉'],
  ]
  const defaults = Object.freeze({
    shape: 'torus', screen: 'scope', seed: 1729, speed: 0.75, complexity: 5,
    noise: 0.24, scale: 1.4, trail: 0.5, glow: 0.45, pitch: 3, scan: 0.18, color: '#91efc4',
  })
  const presets = Object.freeze([
    { id: 'orbit', name: '环面轨迹', state: defaults },
    { id: 'resonance', name: '谐振结', state: Object.freeze({
      shape: 'harmonic', screen: 'matrix', seed: 4103, speed: 0.55, complexity: 4,
      noise: 0.14, scale: 0.95, trail: 0.26, glow: 0.52, pitch: 3, scan: 0.22, color: '#ffbf77',
    }) },
    { id: 'wave', name: '波面', state: Object.freeze({
      shape: 'wave', screen: 'raster', seed: 6821, speed: 0.85, complexity: 6,
      noise: 0.36, scale: 1.65, trail: 0.42, glow: 0.38, pitch: 2, scan: 0.48, color: '#94caff',
    }) },
  ].map(Object.freeze))

  function normalize(input) {
    const result = { ...defaults }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result
    if (typeof input.shape === 'string' && Object.hasOwn(shapes, input.shape)) result.shape = input.shape
    if (typeof input.screen === 'string' && Object.hasOwn(screens, input.screen)) result.screen = input.screen
    if (typeof input.color === 'string' && /^#[\da-f]{6}$/i.test(input.color)) result.color = input.color.toLowerCase()
    for (const [key, { min, max, step }] of Object.entries(fields)) {
      const raw = input[key]
      const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw
      if (!Number.isFinite(value)) continue
      const bounded = Math.min(max, Math.max(min, value))
      // All slider steps have at most two decimal places.
      result[key] = Number((min + Math.round((bounded - min) / step) * step).toFixed(2))
    }
    return result
  }

  const make = (tag, className, text) => {
    const node = document.createElement(tag)
    node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  let instance = 0
  function mount(container, onChange) {
    const prefix = 'phosphor-control-' + (++instance) + '-'
    const model = make('div', 'control-model')
    const nodes = [model]
    const renderers = []
    const events = new AbortController()
    let state = { ...defaults }

    function listen(node, event, callback) {
      node.addEventListener(event, callback, { signal: events.signal })
    }

    function emit(key, value) {
      const next = normalize({ ...state, [key]: value })
      if (next[key] === state[key]) return
      state = next
      for (const render of renderers) render()
      onChange({ [key]: next[key] })
    }

    function labelFor(key, text) {
      const label = make('label', 'control-label', text)
      label.htmlFor = prefix + key
      return label
    }

    function addChoice(key, title, options) {
      const row = make('div', 'control-choice')
      const select = make('select', 'control-select')
      select.id = prefix + key
      select.name = key
      for (const [value, label] of Object.entries(options)) select.add(new Option(label, value))
      listen(select, 'change', () => emit(key, select.value))
      renderers.push(() => { select.value = state[key] })
      row.append(labelFor(key, title), select)
      model.append(row)
    }

    function section(name) {
      const details = make('details', 'control-section')
      const heading = make('summary', 'control-heading', name)
      const chevron = make('span', 'control-chevron')
      chevron.setAttribute('aria-hidden', 'true')
      heading.append(chevron)
      const body = make('div', 'control-section-body')
      details.open = true
      details.append(heading, body)
      nodes.push(details)
      return body
    }

    function addRange(group, key) {
      const spec = fields[key]
      const row = make('div', 'control-row')
      row.dataset.param = key
      const head = make('div', 'control-row-head')
      const value = make('output', 'control-value')
      const input = make('input', 'control-range')
      input.id = prefix + key
      input.name = key
      input.type = 'range'
      input.min = spec.min
      input.max = spec.max
      input.step = spec.step
      value.htmlFor.add(input.id)
      value.setAttribute('aria-hidden', 'true')
      const label = labelFor(key, spec.label)
      head.append(label, value)
      row.append(head, input)
      group.append(row)
      listen(input, 'input', () => emit(key, input.valueAsNumber))
      renderers.push(() => {
        if (key === 'pitch') {
          label.textContent = { scope: '光束宽度', matrix: '点阵间距', raster: '采样间距' }[state.screen]
          // The scope maps pitch to line width, while sampled displays use a pixel step.
          input.title = state.screen === 'scope' ? '调节矢量光束的相对宽度' : '调节屏幕的采样间距'
        }
        const number = state[key]
        input.value = number
        input.style.setProperty('--fill', (number - spec.min) / (spec.max - spec.min) * 100 + '%')
        const text = key === 'pitch' && state.screen === 'scope' ? String(number) : spec.format(number)
        value.value = text
        input.setAttribute('aria-valuetext', text)
      })
    }

    addChoice('shape', '曲线形态', shapes)
    addChoice('screen', '显示方式', screens)
    const motion = section('运动')
    for (const key of ['speed', 'complexity', 'noise', 'scale']) addRange(motion, key)

    const seedRow = make('div', 'control-row control-seed')
    const seedInput = make('input', 'control-number')
    Object.assign(seedInput, { type: 'number', name: 'seed', id: prefix + 'seed', min: '1', max: '9999', step: '1' })
    seedRow.append(labelFor('seed', fields.seed.label), seedInput)
    motion.append(seedRow)
    function commitSeed() {
      const seed = seedInput.valueAsNumber
      if (Number.isFinite(seed)) emit('seed', seed)
      seedInput.value = state.seed
    }
    listen(seedInput, 'input', () => {
      if (Number.isFinite(seedInput.valueAsNumber) && seedInput.validity.valid) emit('seed', seedInput.valueAsNumber)
    })
    listen(seedInput, 'blur', commitSeed)
    listen(seedInput, 'keydown', event => {
      if (event.isComposing) return
      if (event.key === 'Enter') { event.preventDefault(); commitSeed() }
      if (event.key === 'Escape') seedInput.value = state.seed
    })
    let displayedSeed
    renderers.push(() => {
      if (state.seed !== displayedSeed) {
        displayedSeed = state.seed
        seedInput.value = state.seed
      }
    })

    const display = section('显示')
    const colorRow = make('div', 'control-row control-color')
    const colorHead = make('div', 'control-row-head')
    const colorValue = make('output', 'control-value')
    colorValue.setAttribute('aria-hidden', 'true')
    colorHead.append(labelFor('color', '荧光色'), colorValue)
    const colors = make('div', 'color-options')
    colors.setAttribute('role', 'group')
    colors.setAttribute('aria-label', '荧光色')
    const colorButtons = swatches.map(([hex, name]) => {
      const button = make('button', 'color-swatch')
      button.type = 'button'
      button.title = name
      button.setAttribute('aria-label', name)
      button.style.setProperty('--swatch', hex)
      listen(button, 'click', () => emit('color', hex))
      colors.append(button)
      return [button, hex]
    })
    const custom = make('label', 'custom-color', '自定')
    const picker = make('input', 'control-color-input')
    Object.assign(picker, { id: prefix + 'color', name: 'color', type: 'color', title: '自定义荧光色' })
    picker.setAttribute('aria-label', '自定义荧光色')
    custom.append(picker)
    colors.append(custom)
    colorRow.append(colorHead, colors)
    display.append(colorRow)
    listen(picker, 'input', () => emit('color', picker.value))
    renderers.push(() => {
      picker.value = state.color
      colorValue.value = state.color.toUpperCase()
      for (const [button, hex] of colorButtons) button.setAttribute('aria-pressed', String(state.color === hex))
    })
    for (const key of ['trail', 'glow', 'pitch', 'scan']) addRange(display, key)

    function set(next) {
      state = normalize(next)
      for (const render of renderers) render()
    }
    container.append(...nodes)
    set(defaults)
    return {
      set,
      destroy() {
        events.abort()
        for (const node of nodes) node.remove()
      },
    }
  }

  window.PhosphorControls = Object.freeze({ presets, defaults, normalize, mount })
})()
