import { ApolloServer } from '@apollo/server'
import { startServerAndCreateH3Handler } from '@as-integrations/h3'
import { resolvers, typeDefs } from '../graphql/schema'

const apollo = new ApolloServer({ typeDefs, resolvers })
const graphql = startServerAndCreateH3Handler(apollo)

// The endpoint is protected, like a real API would be: a bearer token is
// required (any value will do here). The client sends it from
// `app/airplane/request.ts`; build-time introspection sends `schemaHeaders`.
export default defineEventHandler((event) => {
  const auth = getHeader(event, 'authorization')
  if (!auth?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Missing bearer token' })
  }
  return graphql(event)
})
