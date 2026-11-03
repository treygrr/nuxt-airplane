// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    'nuxt-og-image',
    'nuxt-llms'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  site: {
    // Origin only; the /nuxt-airplane/ path comes from app.baseURL.
    url: 'https://treygrr.github.io',
    name: 'nuxt-airplane'
  },

  content: {
    build: {
      markdown: {
        toc: {
          searchDepth: 1
        }
      }
    },
    experimental: {
      sqliteConnector: 'native'
    }
  },

  experimental: {
    asyncContext: true
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  llms: {
    domain: 'https://treygrr.github.io/nuxt-airplane',
    title: 'nuxt-airplane',
    description: 'Airplane mode for your GraphQL app: typed composables from your .gql files, an IndexedDB cache and a mutation queue that syncs when you are back online.',
    full: {
      title: 'nuxt-airplane - Full Documentation',
      description: 'The full documentation for the nuxt-airplane module.'
    },
    sections: [
      {
        title: 'Getting Started',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/getting-started%' }
        ]
      },
      {
        title: 'Guide',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/guide%' }
        ]
      },
      {
        title: 'API',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/api%' }
        ]
      }
    ]
  },

  ogImage: {
    zeroRuntime: true
  },

  prerender: {
    routes: [
      '/'
    ],
    crawlLinks: true
  }
})
