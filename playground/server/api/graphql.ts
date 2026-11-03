import { ApolloServer } from '@apollo/server'
import { startServerAndCreateH3Handler } from '@as-integrations/h3'
import type { EventHandler } from 'h3'
import { resolvers } from '../graphql/schema'

// The SDL is a server asset (see `nitro.serverAssets` in nuxt.config.ts), so the
// same file feeds Apollo here and the module's type generation at build time.
let graphql: Promise<EventHandler> | undefined
async function createHandler() {
  const raw = await useStorage('assets:graphql').getItemRaw('schema.graphql')
  const typeDefs = Buffer.from(raw as Uint8Array).toString('utf8')
  const apollo = new ApolloServer({ typeDefs, resolvers })
  return startServerAndCreateH3Handler(apollo)
}

// The endpoint is protected, like a real API would be: a bearer token is
// required (any value will do here). The client sends it from
// `app/airplane/request.ts`.
export default defineEventHandler(async (event) => {
  const auth = getHeader(event, 'authorization')
  if (!auth?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Missing bearer token' })
  }
  graphql ??= createHandler()
  return (await graphql)(event)
})
