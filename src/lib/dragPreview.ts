let transparentDragImage: HTMLCanvasElement | null = null

/** 保留原生拖放事件，但不显示浏览器生成的浮动拖拽缩略图。 */
export function hideNativeDragPreview(dataTransfer: DataTransfer): void {
  if (!transparentDragImage) {
    transparentDragImage = document.createElement('canvas')
    transparentDragImage.width = 1
    transparentDragImage.height = 1
  }
  dataTransfer.setDragImage(transparentDragImage, 0, 0)
}
