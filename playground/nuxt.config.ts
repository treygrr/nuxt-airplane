export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  offline: {
    endpoint: '/api/graphql',
  },
})
