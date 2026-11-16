import NuxtAirplane from '../../../src/module'

export default defineNuxtConfig({
  modules: [
    NuxtAirplane,
  ],
  airplane: {
    endpoint: '/api/graphql',
    schema: {
      source: './schema.graphql',
      headers: { Authorization: 'Bearer build-only-token' },
    },
    database: { cacheKey: 'fixture-1' },
    persistedQueries: 'automatic',
  },
})
