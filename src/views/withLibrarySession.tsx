import type { ComponentType } from 'react'
import { useStore } from '@/store/useStore'

/** 整库发布后重新创建工作区，包括表单、撤销历史和正在确认的操作。 */
export function withLibrarySession<Props extends object>(Workspace: ComponentType<Props & { librarySession: number }>) {
  return function LibraryWorkspace(props: Props) {
    const librarySession = useStore(state => state.librarySession)
    return <Workspace {...props} key={librarySession} librarySession={librarySession} />
  }
}
