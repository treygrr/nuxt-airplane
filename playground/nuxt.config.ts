export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  nitro: {
    // Lets server/api/graphql.ts read the SDL at runtime.
    serverAssets: [{ baseName: 'graphql', dir: './graphql' }],
  },
  airplane: {
    endpoint: '/api/graphql',
    // Types come from the same SDL the server uses, so they are generated
    // without a running server (CI, fresh clones). Remove this line to see
    // introspection at work instead; the server then needs `schemaHeaders`.
    schema: './server/graphql/schema.graphql',
  },
})
