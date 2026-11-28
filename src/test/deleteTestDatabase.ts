/** 等待本次隔离库的删除请求结束。blocked 后连接仍可正常释放，持续占用才报错。 */
export function deleteTestDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    let blockedTimeout: number | undefined
    request.onblocked = () => {
      blockedTimeout ??= window.setTimeout(() => reject(new Error(`测试数据库持续被占用：${name}`)), 2_000)
    }
    request.onsuccess = () => {
      window.clearTimeout(blockedTimeout)
      resolve()
    }
    request.onerror = () => {
      window.clearTimeout(blockedTimeout)
      reject(request.error)
    }
  })
}
