// The schema's resolvers, one file per area. The schema itself is
// ./schema.graphql, loaded by server/api/graphql.ts, so the module generates
// types from the same file without a running server.

import { labStats } from '../../utils/lab'
import { account } from './account'
import { cart } from './cart'
import { catalog } from './catalog'
import { inventory } from './inventory'
import { orders } from './orders'
import { reviews } from './reviews'
import { wishlists } from './wishlists'

const areas = [catalog, cart, wishlists, account, reviews, orders, inventory]

export const resolvers = {
  Query: Object.assign({ labStats }, ...areas.map(a => a.Query)),
  Mutation: Object.assign({}, ...areas.map(a => ('Mutation' in a ? a.Mutation : {}))),
}
