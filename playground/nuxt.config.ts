export default defineNuxtConfig({
  // By package name (not ../src/module) so this app also works as the
  // StackBlitz template pkg.pr.new builds for each PR.
  modules: ['@treygrr/nuxt-airplane', 'vuetify-nuxt-module'],
  // Components are grouped in folders by area (cart/, catalog/, sync/…) but
  // named by their file alone: <OfflineSwitch>, not <SyncOfflineSwitch>.
  components: [{ path: '~/components', pathPrefix: false }],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  nitro: {
    // Lets server/api/graphql.ts read the SDL at runtime.
    serverAssets: [{ baseName: 'graphql', dir: './graphql' }],
  },
  vite: {
    // The devtools client is only discovered once the page loads; pre-bundling
    // it avoids a reload of the dev server's first page.
    optimizeDeps: { include: ['@vue/devtools-core', '@mdi/js'] },
  },
  airplane: {
    endpoint: '/api/graphql',
    // Types come from the same SDL the server uses, so they are generated
    // without a running server (CI, fresh clones). Remove this line to see
    // introspection at work instead; the server then needs `schema.headers`.
    schema: { source: './server/graphql/schema.graphql' },
    // Operations go out as a SHA-256 hash; Apollo Server supports this
    // (automatic persisted queries) out of the box and asks for the text once.
    persistedQueries: 'automatic',
    // Dates come over the wire as ISO strings.
    codegen: { scalars: { DateTime: 'string' } },
  },
  vuetify: {
    moduleOptions: {
      // Nuxt has a `useLayout` of its own; Vuetify's becomes `useVLayout`.
      prefixComposables: ['useLayout'],
      // The theme follows the OS. The browser says which one in a request
      // header, so the server renders the right one and dark systems do not
      // flash light on first paint.
      ssrClientHints: {
        prefersColorScheme: true,
        prefersColorSchemeOptions: { useBrowserThemeOnly: true },
      },
    },
    vuetifyOptions: {
      // Icons are SVG paths imported from @mdi/js where they are used, so
      // only those end up in the bundle.
      icons: { defaultSet: 'mdi-svg' },
      theme: {
        defaultTheme: 'light',
        themes: {
          light: { colors: { primary: '#c2410c', secondary: '#334155' } },
          dark: { colors: { primary: '#fb923c', secondary: '#94a3b8' } },
        },
      },
    },
  },
})
