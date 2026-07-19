/**
 * 应用图标统一出口：优先 Linear 填充图标；无近似替代的缺口继续走 Lucide。
 * 业务代码应从此处或 `@/icons/linear` 导入，避免散落 `lucide-react`。
 */
import type { ComponentType } from 'react'
import type { LinearStaticIconProps } from '@/icons/linear'
import {
  LinearAlertIcon,
  LinearAttachmentIcon,
  LinearBarChartIcon,
  LinearBlockquoteIcon,
  LinearBoltIcon,
  LinearBookOpenIcon,
  LinearBookmarkIcon,
  LinearBoxIcon,
  LinearBoxOpenIcon,
  LinearCalendarIcon,
  LinearChartIcon,
  LinearChecklistIcon,
  LinearChemistIcon,
  LinearCircleIcon,
  LinearClockIcon,
  LinearCodeBlockIcon,
  LinearCrossIcon,
  LinearCubeIcon,
  LinearCustomViewIcon,
  LinearDashboardIcon,
  LinearDatabaseIcon,
  LinearDesignToolsIcon,
  LinearDesktopWindowIcon,
  LinearFireIcon,
  LinearFlagIcon,
  LinearFloppyDiskIcon,
  LinearFolderIcon,
  LinearFavoriteIcon,
  LinearGearsIcon,
  LinearImageIcon,
  LinearLabelIcon,
  LinearLockIcon,
  LinearMyIssuesIcon,
  LinearNotifiedIcon,
  LinearPageIcon,
  LinearPinIcon,
  LinearRefreshIcon,
  LinearResolvedIcon,
  LinearRocketIcon,
  LinearRoutingIcon,
  LinearScatterPlotIcon,
  LinearSearchIcon,
  LinearSendIcon,
  LinearServerIcon,
  LinearShieldIcon,
  LinearSpeedometerIcon,
  LinearSpreadsheetIcon,
  LinearStarredIcon,
  LinearSubgroupIcon,
  LinearTextBlockIcon,
  LinearTrashIcon,
  LinearUsersIcon,
  LinearViewFinderIcon,
  LinearWriteIcon,
  LinearLinkIcon,
  LinearCheckIcon,
  LinearChevronDownIcon,
  LinearChevronLeftIcon,
  LinearChevronRightIcon,
  LinearChevronUpIcon,
  LinearCloseIcon,
} from '@/icons/linear'

export type AppIcon = ComponentType<LinearStaticIconProps>

/* —— Linear 映射（Lucide 同名别名） —— */
export const Search = LinearSearchIcon
export const Settings2 = LinearGearsIcon
export const Trash2 = LinearTrashIcon
export const Star = LinearStarredIcon
export const Favorite = LinearFavoriteIcon
export const Bookmark = LinearBookmarkIcon
export const BookmarkPlus = LinearBookmarkIcon
export const Pencil = LinearWriteIcon
export const PenSquare = LinearWriteIcon
export const Tag = LinearLabelIcon
export const Bell = LinearNotifiedIcon
export const Plus = LinearCrossIcon
export const RotateCcw = LinearRefreshIcon
export const Calendar = LinearCalendarIcon
export const CalendarDays = LinearCalendarIcon
export const BarChart3 = LinearDashboardIcon
export const BarChart2 = LinearBarChartIcon
export const ListTodo = LinearMyIssuesIcon
export const List = LinearChecklistIcon
export const BookOpen = LinearBookOpenIcon
export const LayoutGrid = LinearDashboardIcon
export const CircleDot = LinearCircleIcon
export const Ban = LinearFlagIcon
export const FlaskConical = LinearChemistIcon
export const HardDriveDownload = LinearDatabaseIcon
export const Database = LinearDatabaseIcon
export const HardDrive = LinearServerIcon
export const Save = LinearFloppyDiskIcon
export const Pin = LinearPinIcon
export const Clock = LinearClockIcon
export const Image = LinearImageIcon
export const ImagePlus = LinearImageIcon
export const FileSpreadsheet = LinearSpreadsheetIcon
export const Package = LinearBoxIcon
export const Archive = LinearBoxOpenIcon
export const Box = LinearBoxIcon
export const FolderOpen = LinearFolderIcon
export const FileText = LinearPageIcon
export const AlertTriangle = LinearAlertIcon
export const AlertCircle = LinearAlertIcon
export const CheckCircle = LinearResolvedIcon
export const LockKeyhole = LinearLockIcon
export const UserCircle = LinearUsersIcon
export const Shapes = LinearCubeIcon
export const Target = LinearViewFinderIcon
export const PanelRight = LinearDesktopWindowIcon
export const Quote = LinearBlockquoteIcon
export const Code = LinearCodeBlockIcon
export const Heading2 = LinearTextBlockIcon
export const ListChecks = LinearChecklistIcon
export const Zap = LinearBoltIcon
export const Flame = LinearFireIcon
export const Rocket = LinearRocketIcon
export const Shield = LinearShieldIcon
export const Gauge = LinearSpeedometerIcon
export const TrendingUp = LinearChartIcon
export const LineChart = LinearChartIcon
export const Activity = LinearScatterPlotIcon
export const Newspaper = LinearPageIcon
export const Layers = LinearSubgroupIcon
export const Crosshair = LinearViewFinderIcon
export const ArrowLeftRight = LinearRoutingIcon
export const Upload = LinearAttachmentIcon
export const SlidersHorizontal = LinearCustomViewIcon
export const DesignTools = LinearDesignToolsIcon
export const Send = LinearSendIcon
export const Link2 = LinearLinkIcon
export const X = LinearCloseIcon
export const Check = LinearCheckIcon
export const ChevronDown = LinearChevronDownIcon
export const ChevronLeft = LinearChevronLeftIcon
export const ChevronRight = LinearChevronRightIcon
export const ChevronUp = LinearChevronUpIcon

/* —— 剩余缺口：保留 Lucide（无 Linear 近似） —— */
export {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  ArrowLeft,
  Copy,
  Download,
  Menu,
  Keyboard,
  GripVertical,
  MoreHorizontal,
  PinOff,
  CornerDownLeft,
  Bold,
  Italic,
  Strikethrough,
  Maximize2,
  // Code / Heading2 / ListChecks 已映射 Linear
} from 'lucide-react'
