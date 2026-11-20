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

  vite: {
    optimizeDeps: {
      // Nuxt UI's editor pulls an optional tiptap peer the docs never use;
      // keep Vite's dependency scan from tripping over it.
      exclude: ['@tiptap/extension-drag-handle-vue-3']
    }
  },

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
    description: 'A Nuxt 4 module (`@treygrr/nuxt-airplane`) for GraphQL apps that must keep working without a connection. Every operation in your .gql files becomes a typed composable, results are stored as rows in IndexedDB tables inferred from the documents, and mutations apply locally and wait in a queue that is sent in order once the app is back online.',
    full: {
      title: 'nuxt-airplane - Full Documentation',
      description: 'The full documentation for the nuxt-airplane module.'
    },
    sections: [
      {
        title: 'Getting Started',
        description: 'Why the module exists, how the pieces fit together, installing it, and every module option.',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/getting-started%' }
        ]
      },
      {
        title: 'Guide',
        description: 'How to use it: queries, mutations and their handlers, the tables, the sync queue, generated types, auth and security.',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/guide%' }
        ]
      },
      {
        title: 'API',
        description: 'The signature, options and return value of each composable and define* helper.',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/api%' }
        ]
      },
      {
        title: 'Contributing',
        description: 'How to propose a change to the module itself.',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/contributing%' }
        ]
      },
      {
        title: 'Project',
        description: 'Where the code, the releases and the issues are.',
        links: [
          {
            title: 'Source on GitHub',
            description: 'The module, a playground app that uses every feature, and the tests.',
            href: 'https://github.com/treygrr/nuxt-airplane'
          },
          {
            title: 'Changelog',
            description: 'What changed in each release, with upgrade steps for the changes that break existing apps.',
            href: 'https://raw.githubusercontent.com/treygrr/nuxt-airplane/main/CHANGELOG.md'
          },
          {
            title: 'Package on npm',
            description: 'Published as @treygrr/nuxt-airplane.',
            href: 'https://www.npmjs.com/package/@treygrr/nuxt-airplane'
          },
          {
            title: 'Issues',
            description: 'Known problems and requests.',
            href: 'https://github.com/treygrr/nuxt-airplane/issues'
          }
        ]
      }
    ],
    notes: [
      'The module is before 1.0 and its API still changes between releases. Go by these pages and the changelog rather than by memory of an older version.',
      'The package is `@treygrr/nuxt-airplane` and its options live under the `airplane` key of `nuxt.config.ts`.',
      'The composables are `useAirplaneQuery` (called `useQuery` before 0.7.0), `useOnlineQuery`, `useMutation`, `useSync` and `useAirplane`. They and the `define*` helpers are auto-imported.',
      'Handlers are files in `app/airplane/` that default-export `defineQueryHandler(s)`, `defineMutationHandler(s)`, `defineAirplaneStores` or `defineAirplaneRequest`.',
      'A query shows nothing offline unless its handler has a `read`, or `store: \'result\'`. `useOnlineQuery` is for queries that are only ever answered by the server.',
      'The local database lives in the browser. Only `useOnlineQuery` asks during server-side rendering.',
      'Each link above is the page as Markdown. Add `/raw` before a page\'s path and `.md` after it to get any page that way.'
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
