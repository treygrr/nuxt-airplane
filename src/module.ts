import { join, relative } from 'node:path'
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
  /** Directory, relative to `srcDir`, scanned for `defineMutationHandlers` files. */
  handlersDir: string
  /** Name of the IndexedDB database. */
  dbName: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-offline',
    configKey: 'offline',
  },
  defaults: {
    endpoint: '/api/graphql',
    documents: ['**/*.gql', '**/*.graphql'],
    handlersDir: 'offline',
    dbName: 'nuxt-offline',
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const logger = useLogger('nuxt-offline')
    const { srcDir } = nuxt.options
    const cacheDir = join(nuxt.options.rootDir, 'node_modules/.cache/nuxt-offline')

    nuxt.options.runtimeConfig.public.offline = {
      endpoint: options.endpoint,
      dbName: options.dbName,
    }

    nuxt.options.build.transpile.push(resolver.resolve('./runtime'))

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

    async function handlerFiles() {
      return (await glob(['**/*.{ts,js,mts,mjs}'], { cwd: join(srcDir, options.handlersDir), absolute: true })).sort()
    }

    await reloadDocuments()
    nuxt.options.watch.push(...docs.files)

    // ------------------------------------------------------------------
    // Templates
    // ------------------------------------------------------------------

    const documentsTemplate = addTemplate({
      filename: 'nuxt-offline/documents.mjs',
      write: true,
      getContents: () => `export const documents = ${JSON.stringify(docs.operations, null, 2)}\n`,
    })

    const handlersTemplate = addTemplate({
      filename: 'nuxt-offline/handlers.mjs',
      write: true,
      getContents: async () => {
        const files = await handlerFiles()
        const imports = files.map((file, i) => `import h${i} from ${JSON.stringify(file)}`)
        const spread = files.map((_, i) => `h${i}`).join(', ')
        return `${imports.join('\n')}\nexport const handlers = Object.assign({}, ${spread})\n`
      },
    })

    nuxt.options.alias['#nuxt-offline/documents'] = documentsTemplate.dst
    nuxt.options.alias['#nuxt-offline/handlers'] = handlersTemplate.dst

    addTypeTemplate({
      filename: 'types/nuxt-offline.d.ts',
      getContents: async () => {
        const schema = await loadSchema({ schema: options.schema, endpoint: introspectionUrl ?? '', cacheDir }, logger)
        if (!schema) logger.warn('No GraphQL schema available yet, operations are untyped')
        return generateTypes(schema, docs)
      },
    })

    // Expose the handlers template's typings so handler files can import `#nuxt-offline/*` if they want.
    nuxt.hook('prepare:types', ({ tsConfig }) => {
      tsConfig.compilerOptions ||= {}
      tsConfig.compilerOptions.paths ||= {}
      tsConfig.compilerOptions.paths['#nuxt-offline/documents'] = [relative(nuxt.options.buildDir, documentsTemplate.dst)]
    })

    async function regenerate() {
      await reloadDocuments()
      await updateTemplates({ filter: t => t.filename.includes('nuxt-offline') })
    }

    // ------------------------------------------------------------------
    // Dev: re-introspect once the server is up, watch documents and handlers
    // ------------------------------------------------------------------

    if (nuxt.options.dev) {
      nuxt.hook('listen', async (_server, listener) => {
        if (!introspectionUrl && !options.schema) {
          introspectionUrl = new URL(options.endpoint, listener.url).href
          await regenerate()
        }
      })

      nuxt.hook('builder:watch', async (_event, path) => {
        const abs = join(srcDir, path)
        const isDocument = /\.(gql|graphql)$/.test(abs)
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
