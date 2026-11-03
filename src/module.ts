import { basename, dirname, join, sep } from 'node:path'
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
import { hash } from 'ohash'
import { glob } from 'tinyglobby'
import { generateTypes, loadDocuments, loadSchema, type LoadedDocuments } from './codegen'

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
  /** Extra options passed to the `typescript` / `typescript-operations` codegen plugins. */
  codegen: Record<string, unknown>
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-airplane',
    configKey: 'airplane',
  },
  defaults: {
    endpoint: '/api/graphql',
    documents: ['**/*.gql', '**/*.graphql'],
    handlersDir: 'airplane',
    dbName: 'nuxt-airplane',
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

    let docs: LoadedDocuments = { operations: {}, documentNodes: [], files: [] }
    async function reloadDocuments() {
      docs = await loadDocuments(options.documents, srcDir, logger)
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
        '',
      ].join('\n'),
    })

    const handlersTemplate = addTemplate({
      filename: 'nuxt-airplane/handlers.mjs',
      write: true,
      getContents: async () => {
        const files = await handlerFiles()
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
      getContents: async () => {
        const schema = await loadSchema({ schema: options.schema, endpoint: introspectionUrl ?? '', cacheDir, headers: options.schemaHeaders }, logger)
        if (!schema) logger.warn('No GraphQL schema available yet, operations are untyped')
        return generateTypes(schema, docs, options.codegen)
      },
    })

    async function regenerate() {
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
