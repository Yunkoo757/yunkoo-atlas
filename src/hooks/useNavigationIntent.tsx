import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'
import { AsyncGeneration } from '@/lib/asyncGeneration'

const NavigationGeneration = createContext<AsyncGeneration | null>(null)

/** 先记录导航，再交给路由器。延迟加载的目的页可能还没替换来源页。 */
export function NavigationIntentBoundary({ children }: { children: ReactNode }) {
  const parent = useContext(UNSAFE_NavigationContext)
  const history = parent.navigator
  const generation = useMemo(() => new AsyncGeneration(), [history])
  const navigation = useMemo((): typeof parent => ({
    ...parent,
    navigator: {
      createHref: to => history.createHref(to),
      encodeLocation: history.encodeLocation?.bind(history),
      push(...args) {
        generation.invalidate()
        history.push(...args)
      },
      replace(...args) {
        generation.invalidate()
        history.replace(...args)
      },
      go(delta) {
        generation.invalidate()
        history.go(delta)
      },
    },
  }), [parent, history, generation])

  useLayoutEffect(() => {
    const moved = () => generation.invalidate()
    window.addEventListener('popstate', moved)
    return () => window.removeEventListener('popstate', moved)
  }, [generation])

  return <NavigationGeneration.Provider value={generation}>
    <UNSAFE_NavigationContext.Provider value={navigation}>{children}</UNSAFE_NavigationContext.Provider>
  </NavigationGeneration.Provider>
}

/** 本页的较新操作、任一导航或页面卸载都会终止旧操作对界面的控制。 */
export function useNavigationIntent() {
  const routes = useContext(NavigationGeneration)
  if (!routes) throw new Error('页面必须位于 NavigationIntentBoundary 内')
  const local = useMemo(() => new AsyncGeneration(), [routes])
  useLayoutEffect(() => () => local.invalidate(), [local])
  return useMemo(() => {
    const capture = () => {
      const sameRoute = routes.capture()
      const sameAction = local.capture()
      return () => sameRoute() && sameAction()
    }
    return {
      capture,
      begin() {
        local.invalidate()
        return capture()
      },
      invalidate: () => local.invalidate(),
    }
  }, [routes, local])
}
