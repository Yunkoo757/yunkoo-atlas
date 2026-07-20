import { StaticLinearSvg } from '../StaticLinearSvg'
import type { LinearStaticIconProps } from '../types'

import { resolveIconA11y } from '../iconA11y'

/** Linear 归档 CloseIcon 路径（16×16） */
const CLOSE_BODY =
  '<path d="M2.96967 2.96967C3.26256 2.67678 3.73744 2.67678 4.03033 2.96967L8 6.939L11.9697 2.96967C12.2626 2.67678 12.7374 2.67678 13.0303 2.96967C13.3232 3.26256 13.3232 3.73744 13.0303 4.03033L9.061 8L13.0303 11.9697C13.2966 12.2359 13.3208 12.6526 13.1029 12.9462L13.0303 13.0303C12.7374 13.3232 12.2626 13.3232 11.9697 13.0303L8 9.061L4.03033 13.0303C3.73744 13.3232 3.26256 13.3232 2.96967 13.0303C2.67678 12.7374 2.67678 12.2626 2.96967 11.9697L6.939 8L2.96967 4.03033C2.7034 3.76406 2.6792 3.3474 2.89705 3.05379L2.96967 2.96967Z"/>'

const CHEVRON_DOWN_BODY =
  '<path d="M4.53 5.47a.75.75 0 0 0-1.06 1.06l4 4a.75.75 0 0 0 1.054.007l4-3.903a.75.75 0 0 0-1.048-1.073l-3.47 3.385L4.53 5.47Z"/>'

const CHEVRON_RIGHT_BODY =
  '<path d="M5.46967 11.4697C5.17678 11.7626 5.17678 12.2374 5.46967 12.5303C5.76256 12.8232 6.23744 12.8232 6.53033 12.5303L10.5303 8.53033C10.8207 8.23999 10.8236 7.77014 10.5368 7.47624L6.63419 3.47624C6.34492 3.17976 5.87009 3.17391 5.57361 3.46318C5.27713 3.75244 5.27128 4.22728 5.56054 4.52376L8.94583 7.99351L5.46967 11.4697Z"/>'

/**
 * 列表分组折叠三角 —— Linear CollapseArrowIcon 原路径（16×16 实心三角，默认朝右）。
 * 展开时由调用方 rotate(90deg) 朝下。
 */
const COLLAPSE_ARROW_PATH =
  'M7.00194 10.6239C6.66861 10.8183 6.25 10.5779 6.25 10.192V5.80802C6.25 5.42212 6.66861 5.18169 7.00194 5.37613L10.7596 7.56811C11.0904 7.76105 11.0904 8.23895 10.7596 8.43189L7.00194 10.6239Z'

/** 菜单勾选：无圆环的填充勾，视觉重量对齐 Linear */
const CHECK_BODY =
  '<path d="M13.488 3.43a.75.75 0 0 1-.018 1.06l-7.25 7a.75.75 0 0 1-1.05-.008l-3.25-3.25a.75.75 0 1 1 1.06-1.06l2.72 2.72 6.728-6.496a.75.75 0 0 1 1.06.034Z"/>'

export function LinearCloseIcon(props: LinearStaticIconProps) {
  return <StaticLinearSvg {...props} body={CLOSE_BODY} viewBox="0 0 16 16" />
}

export function LinearCheckIcon(props: LinearStaticIconProps) {
  return <StaticLinearSvg {...props} body={CHECK_BODY} viewBox="0 0 16 16" />
}

/** 列表/分组折叠 caret：默认朝右；由调用方按 openProgress 旋转至朝下 */
export function LinearChevronIcon({
  title,
  color,
  className,
  style,
  size = 16,
  ...props
}: LinearStaticIconProps) {
  const a11y = resolveIconA11y(title)
  const dim = typeof size === 'number' ? size : 16
  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={dim}
      height={dim}
      viewBox="0 0 16 16"
      fill={color ?? 'currentColor'}
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      {a11y.titleNode}
      <path d={COLLAPSE_ARROW_PATH} />
    </svg>
  )
}

export function LinearChevronDownIcon(props: LinearStaticIconProps) {
  return <StaticLinearSvg {...props} body={CHEVRON_DOWN_BODY} viewBox="0 0 16 16" />
}

export function LinearChevronRightIcon(props: LinearStaticIconProps) {
  return <StaticLinearSvg {...props} body={CHEVRON_RIGHT_BODY} viewBox="0 0 16 16" />
}

export function LinearChevronLeftIcon({ style, ...props }: LinearStaticIconProps) {
  return (
    <LinearChevronRightIcon
      {...props}
      style={{ transform: 'scaleX(-1)', ...(typeof style === 'object' && style ? style : {}) }}
    />
  )
}

export function LinearChevronUpIcon({ style, ...props }: LinearStaticIconProps) {
  return (
    <LinearChevronDownIcon
      {...props}
      style={{ transform: 'scaleY(-1)', ...(typeof style === 'object' && style ? style : {}) }}
    />
  )
}
