/**
 * Linear 搜索图标。路径于 2026-07-21 自 linear.app「Search workspace」按钮实机提取。
 */
import { StaticLinearSvg } from '../StaticLinearSvg'
import type { LinearStaticIconProps } from '../types'

const body =
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M7 2C9.76142 2 12 4.23858 12 7C12 8.11012 11.6375 9.13519 11.0254 9.96484L13.7803 12.7197L13.832 12.7764C14.0723 13.0709 14.0549 13.5057 13.7803 13.7803C13.5057 14.0549 13.0709 14.0723 12.7764 13.832L12.7197 13.7803L9.96484 11.0254C9.13519 11.6375 8.11012 12 7 12C4.23858 12 2 9.76142 2 7C2 4.23858 4.23858 2 7 2ZM7 3.5C5.067 3.5 3.5 5.067 3.5 7C3.5 8.933 5.067 10.5 7 10.5C8.933 10.5 10.5 8.933 10.5 7C10.5 5.067 8.933 3.5 7 3.5Z"></path>'

export function LinearSearchIcon(props: LinearStaticIconProps) {
  return <StaticLinearSvg {...props} body={body} viewBox="0 0 16 16" />
}
