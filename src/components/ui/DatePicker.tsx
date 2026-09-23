import { forwardRef, lazy, Suspense, type ComponentPropsWithoutRef } from 'react'
import type { DatePicker as DatePickerControl } from './DatePickerControl'
import { FieldTrigger } from './FieldTrigger'

const CalendarControl = lazy(() => import('./DatePickerControl').then((module) => ({ default: module.DatePicker })))

/** 日历按需加载；交易列表首屏无需下载年月选择与日期网格。 */
export const DatePicker = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof DatePickerControl>>(
  function DatePicker(props, ref) {
    return (
      <Suspense fallback={<FieldTrigger disabled aria-label={props.ariaLabel}>{props.value || '选择日期'}</FieldTrigger>}>
        <CalendarControl {...props} ref={ref} />
      </Suspense>
    )
  },
)
