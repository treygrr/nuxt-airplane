export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  airplane: {
    endpoint: '/api/graphql',
    // The playground API requires a bearer token; this one is only used for
    // build-time introspection and never shipped to the browser.
    schemaHeaders: { Authorization: `Bearer ${process.env.AIRPLANE_INTROSPECTION_TOKEN ?? 'build-token'}` },
  },
})
