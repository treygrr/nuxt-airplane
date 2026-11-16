// Every page's code, downloaded once the app is idle. The data for a page may
// be in the tables, but each page's code is its own file, fetched the first
// time the page opens: offline, a page never opened before could not open at
// all, however much data is kept (FINDINGS.md, 8). A service worker would
// also keep the code across reloads; this keeps it for the session.

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()

  function preload() {
    for (const route of router.getRoutes()) {
      const page = route.components?.default
      // A page not loaded yet is a function that imports it. Loaded, it takes
      // its place in the route, as the router itself would do on a visit.
      if (typeof page !== 'function' || !route.components) continue
      const components = route.components
      void (page as () => Promise<{ default?: unknown }>)()
        .then((loaded) => {
          components.default = (loaded.default ?? loaded) as NonNullable<typeof components.default>
        })
        .catch(() => {})
    }
  }

  nuxtApp.hook('app:suspense:resolve', () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 3000 })
    else setTimeout(preload, 1000)
  })
})
