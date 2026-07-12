import {
  LIGHTBOX_VIEW_RESET,
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
