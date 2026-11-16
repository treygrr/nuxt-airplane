import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
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
import type { Plugin } from 'vite'
import { hash } from 'ohash'
import { glob } from 'tinyglobby'
import { generateTypes, loadDocuments, loadSchema, type LoadedDocuments } from './codegen'
import { generateHandlerFiles } from './scaffold'
import { WRAP_HINT, defaultExportHelper, findUntaggedDefaultExport, mentionedTables } from './handlers'
import type { PersistedQueriesMode } from './runtime/types'

/** Where the GraphQL schema comes from; types are generated from it at build time. */
export interface SchemaOptions {
  /**
   * An SDL file or a URL. When omitted the endpoint is introspected (in dev,
   * once the server is listening).
   */
  source?: string
  /** Headers for build-time introspection of a protected endpoint, e.g. from `process.env`. Never shipped. */
  headers?: Record<string, string>
}

/** The files that say what each operation means for the local data, and where they run. */
export interface HandlersOptions {
  /** Directory, relative to `srcDir`, scanned for `defineMutationHandlers` / `defineQueryHandlers` / `defineAirplaneStores` files. */
  dir: string
  /**
   * Write a handler file, with its hooks in place and their bodies empty, for
   * every query and mutation that has none: `mutations/<name>.ts` and
   * `queries/<name>.ts` under `dir`. Runs when the app is prepared, built or
   * started, and in dev whenever an operation is added. A file that exists is
   * never touched. Default `false`.
   */
  generate: boolean
  /**
   * Run the handlers that write to the tables (`store`, `apply`, `describe`,
   * `merge`, `reconcile`, `revert`) in a web worker, so a large response or a
   * long queue does not hold up the page. They cannot use Nuxt composables or
   * the DOM there. `read`, `prefetch` and `defineAirplaneRequest` stay on the
   * page. Default `true`; set it to `false` to keep every handler on the
   * page. Needs the Vite builder, and stays off without it.
   */
  worker: boolean
}

/** The IndexedDB database that holds the tables and the outbox. */
export interface DatabaseOptions {
  /** Name of the database. */
  name: string
  /**
   * Changes to this value wipe the local cache on the next load (the outbox is
   * kept). Set it per deploy, e.g. a git SHA or build id. A hash of the GraphQL
   * documents is always mixed in, so editing a query busts the cache on its own.
   * Overridable at runtime with `NUXT_PUBLIC_AIRPLANE_CACHE_KEY`.
   */
  cacheKey?: string
}

export interface ModuleOptions {
  /** URL of the GraphQL endpoint. A path like `/api/graphql` is resolved against the app's own origin. */
  endpoint: string
  /** Static headers sent with every request, e.g. an API key. Public: they ship to the browser. */
  headers?: Record<string, string>
  /**
   * Send operations by their SHA-256 hash instead of their text.
   * - `'automatic'`: Apollo-style automatic persisted queries. The hash is
   *   sent first; the text follows only when the server answers
   *   `PersistedQueryNotFound`. Works with any server that supports APQ.
   * - `'manifest'`: only the hash is ever sent. Register the documents on the
   *   server from the manifest written to `.nuxt/nuxt-airplane/persisted-queries.json`.
   */
  persistedQueries: PersistedQueriesMode
  /** Globs, relative to `srcDir`, of the `.gql` / `.graphql` files holding the operations. */
  documents: string[]
  /** Where the schema comes from. */
  schema: SchemaOptions
  /** The handler files: where they are, whether to scaffold them, where they run. */
  handlers: HandlersOptions
  /** The local database. */
  database: DatabaseOptions
  /** Extra options passed to the `typescript` / `typescript-operations` codegen plugins. */
  codegen: Record<string, unknown>
}

/** Options from before they were grouped, and where each one went. */
const MOVED: Record<string, string> = {
  schemaHeaders: 'schema.headers',
  handlersDir: 'handlers.dir',
  generateHandlers: 'handlers.generate',
  worker: 'handlers.worker',
  dbName: 'database.name',
  cacheKey: 'database.cacheKey',
}

/** The old names that a configuration still uses, each with its new place. */
export function movedOptions(options: Record<string, unknown>): string[] {
  const found = Object.keys(MOVED).filter(key => key in options).map(key => `  ${key} → ${MOVED[key]}`)
  if (typeof options.schema === 'string') found.unshift(`  schema: '…' → schema: { source: '…' }`)
  return found
}

/**
 * Imports the handler files as namespaces and takes their default exports.
 * A file without one (helpers kept beside the handlers) then contributes
 * `undefined`, which the runtime skips, where a default import of it would
 * be a module link error that stops the app.
 */
const handlerImports = (files: string[]) => files.map((file, i) => `import * as h${i} from ${JSON.stringify(file)}`).join('\n')
const handlerList = (files: string[]) => files.map((_, i) => `h${i}.default`).join(', ')

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-airplane',
    configKey: 'airplane',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    endpoint: '/api/graphql',
    persistedQueries: false,
    documents: ['**/*.gql', '**/*.graphql'],
    schema: {},
    handlers: { dir: 'airplane', generate: false, worker: true },
    database: { name: 'nuxt-airplane' },
    codegen: {},
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const logger = useLogger('nuxt-airplane')
    const { srcDir } = nuxt.options
    const cacheDir = join(nuxt.options.rootDir, 'node_modules/.cache/nuxt-airplane')

    // An option under its old name would be ignored without a word. Stop instead.
    const moved = movedOptions(options as unknown as Record<string, unknown>)
    if (moved.length) throw new Error(`[nuxt-airplane] These options have moved into groups:\n${moved.join('\n')}`)

    nuxt.options.runtimeConfig.public.airplane = {
      endpoint: options.endpoint,
      dbName: options.database.name,
      cacheKey: options.database.cacheKey ?? '',
      headers: options.headers ?? {},
      // A string so Nuxt's runtime config typing does not pin it to boolean.
      persistedQueries: options.persistedQueries || '',
      worker: options.handlers.worker,
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
    const schemaSource = options.schema.source && !/^https?:\/\//.test(options.schema.source)
      ? resolve(nuxt.options.rootDir, options.schema.source)
      : options.schema.source
    let schema: GraphQLSchema | null = null
    async function reloadSchema() {
      schema = await loadSchema({ schema: schemaSource, endpoint: introspectionUrl ?? '', cacheDir, headers: options.schema.headers }, logger)
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
      const dir = join(srcDir, options.handlers.dir)
      const files = (await glob(['**/*.{ts,js,mts,mjs}'], { cwd: dir, absolute: true })).sort()
      const isIndex = (file: string) => /^index\.[mc]?[tj]s$/.test(basename(file))
      const indexDirs = files.filter(isIndex).map(file => dirname(file))
      return files.filter((file) => {
        const owner = indexDirs.find(d => file.startsWith(d + sep))
        return !owner || (dirname(file) === owner && isIndex(file))
      })
    }

    // ------------------------------------------------------------------
    // Which inferred tables the app uses
    //
    // Every type selected with an id could have a table, but one nobody
    // reads or writes is an object store opened for nothing. Only those the
    // app's source mentions are created.
    // ------------------------------------------------------------------

    const handlersRoot = join(srcDir, options.handlers.dir) + sep
    /** Per source file, the inferred tables it mentions. */
    const mentions = new Map<string, string[]>()
    async function scanFile(file: string) {
      const source = await readFile(file, 'utf8').catch(() => null)
      if (source === null) mentions.delete(file)
      else mentions.set(file, mentionedTables(source, Object.keys(docs.entities), file.startsWith(handlersRoot)))
    }
    async function scanSources() {
      mentions.clear()
      const files = await glob(['**/*.{ts,js,mts,mjs,tsx,jsx,vue}'], { cwd: srcDir, absolute: true, ignore: ['**/node_modules/**', '**/.nuxt/**', '**/.output/**', '**/dist/**'] })
      await Promise.all(files.map(scanFile))
    }
    const usedTables = () => new Set([...mentions.values()].flat())

    /** With `handlers.generate`: a scaffolded file for each operation that has no handler yet. */
    async function scaffoldHandlers() {
      if (!options.handlers.generate) return
      const { written, behindIndex } = await generateHandlerFiles(join(srcDir, options.handlers.dir), Object.values(docs.operations))
      if (written.length) logger.info(`Scaffolded ${written.length} handler file${written.length > 1 ? 's' : ''}:\n${written.map(file => `  ${relative(nuxt.options.rootDir, file)}`).join('\n')}`)
      for (const folder of behindIndex) logger.warn(`${relative(nuxt.options.rootDir, folder)} has an index file, so only what the index exports is picked up: export the new files from it.`)
    }

    await reloadSchema()
    await reloadDocuments()
    await scaffoldHandlers()
    await scanSources()
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
        `export const entities = ${JSON.stringify(Object.fromEntries(Object.entries(docs.entities).filter(([name]) => usedTables().has(name))))}`,
        `export const unusedEntities = ${JSON.stringify(Object.keys(docs.entities).filter(name => !usedTables().has(name)))}`,
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
        return `${handlerImports(files)}\nexport const handlers = [${handlerList(files)}]\n`
      },
    })

    // ------------------------------------------------------------------
    // Worker
    // ------------------------------------------------------------------

    let useWorker = options.handlers.worker
    if (useWorker && nuxt.options.builder !== '@nuxt/vite-builder') {
      logger.info('`handlers.worker` needs the Vite builder; the handlers stay on the page.')
      useWorker = false
    }

    // The worker gets the handler files too, bar the ones that only describe
    // requests: those are the page's, and may lean on Nuxt composables. Its
    // entry is a plain file rather than a template, because Vite bundles a
    // worker on its own, without the plugin that serves Nuxt's templates.
    const workerEntry = join(nuxt.options.buildDir, 'nuxt-airplane-worker/entry.mjs')
    async function writeWorkerEntry() {
      const files: string[] = []
      for (const file of await handlerFiles()) {
        if (defaultExportHelper(await readFile(file, 'utf8')) !== 'defineAirplaneRequest') files.push(file)
      }
      const contents = [
        // First, so the define* helpers exist when the handler files run.
        `import ${JSON.stringify(resolver.resolve('./runtime/worker-globals'))}`,
        `import { startWorker } from ${JSON.stringify(resolver.resolve('./runtime/worker'))}`,
        handlerImports(files),
        `startWorker([${handlerList(files)}])`,
        '',
      ].join('\n')
      if (await readFile(workerEntry, 'utf8').catch(() => null) === contents) return
      await mkdir(dirname(workerEntry), { recursive: true })
      await writeFile(workerEntry, contents)
    }
    const workerTemplate = addTemplate({
      filename: 'nuxt-airplane/worker.mjs',
      write: true,
      getContents: async () => {
        if (!useWorker) return 'export const createWorker = undefined\n'
        // Written here so it follows the templates: after the build directory is cleared, and again when handlers change.
        await writeWorkerEntry()
        return `import AirplaneWorker from ${JSON.stringify(`${workerEntry}?worker`)}\nexport const createWorker = () => new AirplaneWorker({ name: 'nuxt-airplane' })\n`
      },
    })
    nuxt.options.alias['#nuxt-airplane/worker'] = workerTemplate.dst

    if (useWorker) {
      // Auto-imports in the handler files have to work in the worker's bundle
      // too, which Vite builds with a plugin list of its own.
      nuxt.hook('vite:extendConfig', (config, { isClient }) => {
        if (!isClient) return
        // Nuxt's own instances of the two that matter: the auto-import transform, and the one that serves what it imports from.
        const shared = (config.plugins ?? []).flat(5).filter((plugin): plugin is Plugin =>
          !!plugin && typeof plugin === 'object' && 'name' in plugin && ['nuxt:imports-transform', 'nuxt:virtual'].includes(plugin.name))
        const own = config.worker?.plugins
        Object.assign(config, { worker: { ...config.worker, plugins: () => [...(own?.() ?? []), ...shared] } })
      })
    }
    nuxt.options.alias['#nuxt-airplane/worker'] = workerTemplate.dst

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
      await scaffoldHandlers()
      await scanSources()
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
        if (introspectionUrl || options.schema.source || !devUrl || !nitroBuilt) return
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
        const isHandler = abs.startsWith(join(srcDir, options.handlers.dir))
        if (isDocument || isHandler) return regenerate()
        // Any other source file may have started, or stopped, using a table.
        if (!/\.(?:[mc]?[tj]sx?|vue)$/.test(abs)) return
        const before = [...usedTables()].sort().join()
        await scanFile(abs)
        if ([...usedTables()].sort().join() !== before) await updateTemplates({ filter: t => t.filename === 'nuxt-airplane/documents.mjs' })
      })
    }

    // ------------------------------------------------------------------
    // Runtime
    // ------------------------------------------------------------------

    addImportsDir(resolver.resolve('./runtime/composables'))
    addPlugin({ src: resolver.resolve('./runtime/plugin.client'), mode: 'client' })
  },
})
