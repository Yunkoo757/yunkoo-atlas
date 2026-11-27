import { replaceLibraryInStore } from '@/lib/snapshotStore'
import { createNewLibrarySnapshot } from '@/storage/emptySnapshot'
import { useStore } from '@/store/useStore'

function deferredImage() {
  let finish!: (url: string) => void
  let fail!: (error: Error) => void
  const result = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject })
  return { finish, fail, read: () => result }
}

export async function testLateAvatarCannotReplaceANewerChoiceOrLibrary(): Promise<void> {
  const initial = useStore.getState()
  const { setAvatar, uploadAvatar } = initial
  try {
    for (const replace of [false, true]) {
      const old = deferredImage()
      const done = uploadAvatar(old.read)
      if (replace) {
        const snapshot = createNewLibrarySnapshot()
        snapshot.profile.avatarId = 'mint'
        replaceLibraryInStore(snapshot)
      } else {
        setAvatar('mint')
      }
      old.finish('data:image/jpeg;base64,b2xk')
      await done
      const { profile, pendingAvatarUpload } = useStore.getState()
      if (profile.avatarId !== 'mint' || profile.customAvatarDataUrl || pendingAvatarUpload !== null) {
        throw new Error('迟到的上传覆盖了更新的头像选择或资料库')
      }
    }
  } finally {
    useStore.setState(initial)
  }
}

export async function testOverlappingUploadsKeepOnlyTheNewestRequest(): Promise<void> {
  const initial = useStore.getState()
  try {
    const older = deferredImage()
    const stale = initial.uploadAvatar(older.read)
    const newer = deferredImage()
    const current = initial.uploadAvatar(newer.read)
    older.fail(new Error('过期图片读取失败'))
    await stale
    if (!useStore.getState().pendingAvatarUpload) throw new Error('旧请求取消了新上传')
    initial.setDisplayName('新名称')
    const url = 'data:image/jpeg;base64,bmV3'
    newer.finish(url)
    await current
    const { profile } = useStore.getState()
    if (profile.customAvatarDataUrl !== url || profile.displayName !== '新名称') throw new Error('上传丢失最新资料')
    const error = new Error('有效上传读取失败')
    const failure = await initial.uploadAvatar(async () => { throw error }).then(() => null, reason => reason)
    if (failure !== error || useStore.getState().pendingAvatarUpload) throw new Error('有效上传失败应结束忙碌并报告错误')
  } finally {
    useStore.setState(initial)
  }
}
