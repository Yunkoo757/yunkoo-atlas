import {
  LIGHTBOX_VIEW_RESET,
  calculateLightboxImageLayout,
  calculateLightboxTransition,
  clampLightboxScale,
  lightboxViewTransform,
  panLightboxView,
  registerLightboxResetHandler,
  requestLightboxReset,
  zoomLightboxAtCursor,
} from '@/lib/lightboxView'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testLightboxScaleClamp(): void {
  assert(clampLightboxScale(0.01) === 0.25, '低于下限应钳到 0.25')
  assert(clampLightboxScale(99) === 8, '高于上限应钳到 8')
  assert(clampLightboxScale(1.5) === 1.5, '范围内应原样返回')
}

export function testLightboxLayoutPreservesPhysicalPixelQuality(): void {
  const layout = calculateLightboxImageLayout({
    naturalWidth: 3840,
    naturalHeight: 2160,
    viewportWidth: 1600,
    viewportHeight: 900,
    devicePixelRatio: 2,
  })

  assert(layout.width === 1920, '100% 时一个源像素应对应一个屏幕物理像素')
  assert(layout.height === 1080, '图片高宽应按同一物理像素比例换算')
  assert(layout.fitScale < 1, '图片超出视口时适合窗口应缩小')

  const small = calculateLightboxImageLayout({
    naturalWidth: 600,
    naturalHeight: 400,
    viewportWidth: 1600,
    viewportHeight: 900,
    devicePixelRatio: 1,
  })
  assert(small.fitScale === 1, '适合窗口不应放大小图')
}

export function testLightboxZoomAnchorsAtCursor(): void {
  const view = LIGHTBOX_VIEW_RESET
  // 视口中心 (100,100)，光标在中心右侧 (150,100)，放大 2 倍后该点仍映射到同一屏幕位置
  const next = zoomLightboxAtCursor(view, 150, 100, 100, 100, 2)
  assert(next.scale === 2, '应放大到 2x')
  const px = 150 - 100
  const wx = (px - view.tx) / view.scale
  const expectedTx = px - wx * next.scale
  assert(Math.abs(next.tx - expectedTx) < 1e-9, '光标锚定：水平偏移应对齐')
  assert(next.ty === 0, '光标在水平中线时 ty 应为 0')
}

export function testLightboxPanAndTransform(): void {
  const panned = panLightboxView(LIGHTBOX_VIEW_RESET, 12, -8)
  assert(panned.tx === 12 && panned.ty === -8, '平移应累加 tx/ty')
  assert(
    lightboxViewTransform(panned) === 'translate(-50%, -50%) translate(12px, -8px) scale(1)',
    'transform 字符串应匹配当前视图',
  )
}

export function testLightboxResetHandlerRegistry(): void {
  let calls = 0
  const unregister = registerLightboxResetHandler(() => {
    calls += 1
  })
  assert(requestLightboxReset() === true, '已注册时应返回 true')
  assert(calls === 1, '应调用重置 handler')
  unregister()
  assert(requestLightboxReset() === false, '注销后应返回 false')
}

export function testLightboxSharedElementTransition(): void {
  const transition = calculateLightboxTransition(
    { x: 100, y: 120, width: 300, height: 200, borderRadius: 6 },
    { x: 250, y: 60, width: 600, height: 400 },
    0.5,
  )
  assert(transition.x === -600, '源图片中心到目标中心的水平位移应换算到画布坐标')
  assert(transition.y === -80, '源图片中心到目标中心的垂直位移应换算到画布坐标')
  assert(transition.scaleX === 0.5 && transition.scaleY === 0.5, '源图片尺寸应映射为目标尺寸比例')
}
