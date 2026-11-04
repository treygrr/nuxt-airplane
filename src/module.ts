import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  addImportsDir,
  addPlugin,
  addTemplate,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
  updateTemplates,
  useLogger,
} from '@nuxt/kit'
import type { GraphQLSchema } from 'graphql'
import { hash } from 'ohash'
import { glob } from 'tinyglobby'
import { generateTypes, loadDocuments, loadSchema, type LoadedDocuments } from './codegen'
import { WRAP_HINT, findUntaggedDefaultExport } from './handlers'
import type { PersistedQueriesMode } from './runtime/types'

export interface ModuleOptions {
  /** URL of the GraphQL endpoint. A path like `/api/graphql` is resolved against the app's own origin. */
  endpoint: string
  /**
   * Where the schema comes from: an SDL file or a URL. When omitted the
   * endpoint is introspected (in dev, once the server is listening).
   */
  schema?: string
  /** Globs, relative to `srcDir`, of the `.gql` / `.graphql` files holding the operations. */
  documents: string[]
  /** Directory, relative to `srcDir`, scanned for `defineMutationHandlers` / `defineQueryHandlers` / `defineAirplaneStores` files. */
  handlersDir: string
  /** Static headers sent with every request, e.g. an API key. Public: they ship to the browser. */
  headers?: Record<string, string>
  /** Headers for build-time introspection of a protected endpoint, e.g. from `process.env`. Never shipped. */
  schemaHeaders?: Record<string, string>
  /** Name of the IndexedDB database. */
  dbName: string
  /**
   * Changes to this value wipe the local cache on the next load (the outbox is
   * kept). Set it per deploy, e.g. a git SHA or build id. A hash of the GraphQL
   * documents is always mixed in, so editing a query busts the cache on its own.
   * Overridable at runtime with `NUXT_PUBLIC_AIRPLANE_CACHE_KEY`.
   */
  cacheKey?: string
  /**
   * When a mutation is rejected by the server, hold back the mutations queued
   * after it until it is retried or rolled back, so the outbox keeps its
   * order (an item added to a site that was never created would fail too).
   * Set to `false` to skip failed mutations and keep sending the rest.
   */
  stopOnFailure: boolean
  /**
   * Send operations by their SHA-256 hash instead of their text.
   * - `'automatic'`: Apollo-style automatic persisted queries. The hash is
   *   sent first; the text follows only when the server answers
   *   `PersistedQueryNotFound`. Works with any server that supports APQ.
   * - `'manifest'`: only the hash is ever sent. Register the documents on the
   *   server from the manifest written to `.nuxt/nuxt-airplane/persisted-queries.json`.
   */
  persistedQueries: PersistedQueriesMode
  /**
   * Store every response object that has an `id` in a table named after its
   * type (`db.Site`), and read queries back from those tables, so a mutation
   * that updates a row updates every query showing it. Set to `false` to
   * cache each response as one blob instead. Queries with a `store` / `read`
   * handler are unaffected either way.
   */
  normalize: boolean
  /** Extra options passed to the `typescript` / `typescript-operations` codegen plugins. */
  codegen: Record<string, unknown>
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-airplane',
    configKey: 'airplane',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    endpoint: '/api/graphql',
    documents: ['**/*.gql', '**/*.graphql'],
    handlersDir: 'airplane',
    dbName: 'nuxt-airplane',
    stopOnFailure: true,
    persistedQueries: false,
    normalize: true,
    codegen: {},
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const logger = useLogger('nuxt-airplane')
    const { srcDir } = nuxt.options
    const cacheDir = join(nuxt.options.rootDir, 'node_modules/.cache/nuxt-airplane')

    nuxt.options.runtimeConfig.public.airplane = {
      endpoint: options.endpoint,
      dbName: options.dbName,
      cacheKey: options.cacheKey ?? '',
      headers: options.headers ?? {},
      stopOnFailure: options.stopOnFailure,
      // A string so Nuxt's runtime config typing does not pin it to boolean.
      persistedQueries: options.persistedQueries || '',
      normalize: options.normalize,
    }

    nuxt.options.build.transpile.push(resolver.resolve('./runtime'))
    nuxt.options.vite.optimizeDeps ||= {}
    nuxt.options.vite.optimizeDeps.include ||= []
    nuxt.options.vite.optimizeDeps.include.push('dexie', 'ohash')

    // ------------------------------------------------------------------
    // Schema + documents
    // ------------------------------------------------------------------

    /** Absolute endpoint for build-time introspection, if we have one. */
    let introspectionUrl = /^https?:\/\//.test(options.endpoint) ? options.endpoint : undefined

    // A relative SDL path is relative to the app, not to wherever the build was started from.
    const schemaSource = options.schema && !/^https?:\/\//.test(options.schema)
      ? resolve(nuxt.options.rootDir, options.schema)
      : options.schema
    let schema: GraphQLSchema | null = null
    async function reloadSchema() {
      schema = await loadSchema({ schema: schemaSource, endpoint: introspectionUrl ?? '', cacheDir, headers: options.schemaHeaders }, logger)
      if (!schema) logger.warn('No GraphQL schema available yet, operations are untyped')
    }

    let docs: LoadedDocuments = { operations: {}, documentNodes: [], files: [], entities: {}, rows: {} }
    async function reloadDocuments() {
      docs = await loadDocuments(options.documents, srcDir, logger, schema)
      return docs
    }

    /**
     * Every handler file, except that a folder with an `index` file is one
     * unit: only the index is imported, so it can compose the files beside it.
     */
    async function handlerFiles() {
      const dir = join(srcDir, options.handlersDir)
      const files = (await glob(['**/*.{ts,js,mts,mjs}'], { cwd: dir, absolute: true })).sort()
      const isIndex = (file: string) => /^index\.[mc]?[tj]s$/.test(basename(file))
      const indexDirs = files.filter(isIndex).map(file => dirname(file))
      return files.filter((file) => {
        const owner = indexDirs.find(d => file.startsWith(d + sep))
        return !owner || (dirname(file) === owner && isIndex(file))
      })
    }

    await reloadSchema()
    await reloadDocuments()
    nuxt.options.watch.push(...docs.files)

    // ------------------------------------------------------------------
    // Templates
    // ------------------------------------------------------------------

    const documentsTemplate = addTemplate({
      filename: 'nuxt-airplane/documents.mjs',
      write: true,
      getContents: () => [
        `export const documents = ${JSON.stringify(docs.operations, null, 2)}`,
        // Part of the cache key: any change to an operation invalidates cached responses.
        `export const documentsHash = ${JSON.stringify(hash(Object.values(docs.operations).map(op => op.source)))}`,
        `export const entities = ${JSON.stringify(docs.entities)}`,
        '',
      ].join('\n'),
    })

    if (options.persistedQueries) {
      // Apollo's persisted query manifest format, which Apollo Router and
      // Server read as is and which is a plain `{ id, body }` list for others.
      addTemplate({
        filename: 'nuxt-airplane/persisted-queries.json',
        write: true,
        getContents: () => JSON.stringify({
          format: 'apollo-persisted-query-manifest',
          version: 1,
          operations: Object.values(docs.operations).map(op => ({ id: op.hash, name: op.name, type: op.kind, body: op.source })),
        }, null, 2),
      })
    }

    const handlersTemplate = addTemplate({
      filename: 'nuxt-airplane/handlers.mjs',
      write: true,
      getContents: async () => {
        const files = await handlerFiles()
        // A default export the runtime would ignore is a build error, with the file named.
        const offenders: string[] = []
        for (const file of files) {
          const untagged = findUntaggedDefaultExport(await readFile(file, 'utf8'))
          if (untagged) offenders.push(`  ${file}: default export is ${untagged.reason}`)
        }
        if (offenders.length) {
          throw new Error(`[nuxt-airplane] Files in the handlers directory must default-export the result of a define* helper:\n${offenders.join('\n')}\n${WRAP_HINT}`)
        }
        const imports = files.map((file, i) => `import h${i} from ${JSON.stringify(file)}`)
        const list = files.map((_, i) => `h${i}`).join(', ')
        return `${imports.join('\n')}\nexport const handlers = [${list}]\n`
      },
    })

    // Public types (AirplaneDexie, MutationHandler, …) for handler helpers.
    nuxt.options.alias['#nuxt-airplane'] = resolver.resolve('./runtime/types')
    nuxt.options.alias['#nuxt-airplane/documents'] = documentsTemplate.dst
    nuxt.options.alias['#nuxt-airplane/handlers'] = handlersTemplate.dst

    addTypeTemplate({
      filename: 'types/nuxt-airplane.d.ts',
      getContents: () => generateTypes(schema, docs, options.codegen),
    })

    async function regenerate() {
      await reloadSchema()
      await reloadDocuments()
      await updateTemplates({ filter: t => t.filename.includes('nuxt-airplane') })
    }

    // ------------------------------------------------------------------
    // Dev: re-introspect once the server is up, watch documents and handlers
    // ------------------------------------------------------------------

    if (nuxt.options.dev) {
      // A relative endpoint lives in this app, so it can only be introspected
      // once the dev server listens and Nitro has built the route.
      // The order of those two events depends on the CLI, so whichever comes
      // last triggers it. The request must not be awaited inside the hook: the
      // dev server only starts answering once the hook chain has returned.
      let devUrl: string | undefined
      let nitroBuilt = false
      function introspectDevServer() {
        if (introspectionUrl || options.schema || !devUrl || !nitroBuilt) return
        introspectionUrl = new URL(options.endpoint, devUrl).href
        regenerate().catch(error => logger.error('Failed to generate GraphQL types', error))
      }
      nuxt.hook('listen', (_server, listener) => {
        devUrl = listener.url
        introspectDevServer()
      })
      nuxt.hook('nitro:init', (nitro) => {
        nitro.hooks.hook('dev:reload', () => {
          nitroBuilt = true
          introspectDevServer()
        })
      })

      nuxt.hook('builder:watch', async (_event, path) => {
        const abs = join(srcDir, path)
        const isDocument = /\.(?:gql|graphql)$/.test(abs)
        const isHandler = abs.startsWith(join(srcDir, options.handlersDir))
        if (isDocument || isHandler) await regenerate()
      })
    }

    // ------------------------------------------------------------------
    // Runtime
    // ------------------------------------------------------------------

    addImportsDir(resolver.resolve('./runtime/composables'))
    addPlugin({ src: resolver.resolve('./runtime/plugin.client'), mode: 'client' })
  },
})
