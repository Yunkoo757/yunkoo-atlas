import type { ReactNode, SVGAttributes } from 'react'
import { resolveIconA11y } from '@/icons/linear/iconA11y'

export interface SidebarChromeIconProps extends SVGAttributes<SVGSVGElement> {
  size?: number | string
  title?: string
}

function StrokeIcon({
  size = 16,
  title,
  children,
  ...props
}: SidebarChromeIconProps & { children: ReactNode }) {
  const a11y = resolveIconA11y(title)
  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {a11y.titleNode}
      {children}
    </svg>
  )
}

export function SidebarCalendarIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2.75" y="3.25" width="10.5" height="9.5" rx="1.5" />
      <path d="M2.75 6.5h10.5M6 3.25v3.25M10 3.25v3.25" />
    </StrokeIcon>
  )
}

export function SidebarIssuesIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3.4 3.8h3v3h-3zM9.6 3.8h3v3h-3zM3.4 9.2h3v3h-3zM9.6 9.2h3v3h-3z" />
    </StrokeIcon>
  )
}

export function SidebarBookIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3.2 3.4h6.4l3.2 3.2V12.6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1z" />
      <path d="M9.6 3.4v3.2h3.2" />
    </StrokeIcon>
  )
}

export function SidebarDashboardIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </StrokeIcon>
  )
}

export function SidebarActiveIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.55" />
    </StrokeIcon>
  )
}

export function SidebarStarIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 2.6l1.45 3.05 3.35.48-2.42 2.36.57 3.34L8 10.4 4.95 11.83l.57-3.34L3.1 6.13l3.35-.48z" />
    </StrokeIcon>
  )
}

export function SidebarMissedIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="5" />
      <path d="M5.2 5.2l5.6 5.6" />
    </StrokeIcon>
  )
}

export function SidebarFlaskIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M5.2 3.8h5.6v8.4H5.2z" />
      <path d="M6.6 2.6h2.8" />
      <circle cx="8" cy="9.2" r="1.5" />
    </StrokeIcon>
  )
}

export function SidebarBookmarkIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 2.75h8v10.5L8 10.6 4 13.25z" />
    </StrokeIcon>
  )
}

export function SidebarTargetIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 2.5v1.4M8 12.1v1.4M2.5 8h1.4M12.1 8h1.4" />
    </StrokeIcon>
  )
}

export function SidebarTrashIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3.5 4.2h9l-.9 8.6H4.4z" />
      <path d="M6.2 4.2V3h3.6v1.2M2.75 4.2h10.5" />
    </StrokeIcon>
  )
}

export function SidebarSettingsIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2.4v1.3M8 12.3v1.3M2.4 8h1.3M12.3 8h1.3M4.05 4.05l.92.92M11.03 11.03l.92.92M11.95 4.05l-.92.92M4.97 11.03l-.92.92" />
    </StrokeIcon>
  )
}

export function SidebarSearchIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 L13.5 13.5" />
    </StrokeIcon>
  )
}

export function SidebarWriteIcon(props: SidebarChromeIconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M3.5 12.5V10l6.8-6.8a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1 0 1.4L6 12.5H3.5z" />
      <path d="M9.2 4.2l2.6 2.6" />
    </StrokeIcon>
  )
}
