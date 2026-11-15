export default defineNuxtConfig({
  // By package name (not ../src/module) so this app also works as the
  // StackBlitz template pkg.pr.new builds for each PR.
  modules: ['@treygrr/nuxt-airplane'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  nitro: {
    // Lets server/api/graphql.ts read the SDL at runtime.
    serverAssets: [{ baseName: 'graphql', dir: './graphql' }],
  },
  vite: {
    // The devtools client is only discovered once the page loads; pre-bundling
    // it avoids a reload of the dev server's first page.
    optimizeDeps: { include: ['@vue/devtools-core'] },
  },
  airplane: {
    endpoint: '/api/graphql',
    // Types come from the same SDL the server uses, so they are generated
    // without a running server (CI, fresh clones). Remove this line to see
    // introspection at work instead; the server then needs `schemaHeaders`.
    schema: './server/graphql/schema.graphql',
    // Operations go out as a SHA-256 hash; Apollo Server supports this
    // (automatic persisted queries) out of the box and asks for the text once.
    persistedQueries: 'automatic',
  },
})
