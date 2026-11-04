import NuxtAirplane from '../../../src/module'

export default defineNuxtConfig({
  modules: [
    NuxtAirplane,
  ],
  airplane: {
    endpoint: '/api/graphql',
    schema: './schema.graphql',
    schemaHeaders: { Authorization: 'Bearer build-only-token' },
    cacheKey: 'fixture-1',
    persistedQueries: 'automatic',
  },
})
