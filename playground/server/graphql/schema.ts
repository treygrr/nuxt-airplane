import { GraphQLError } from 'graphql'
import { catalog, sites } from '../utils/db'
import type { Site, SiteItem } from '../utils/db'

export const typeDefs = /* GraphQL */ `
  type Item {
    id: ID!
    name: String!
  }

  type SiteItem {
    id: ID!
    name: String!
    onHand: Int!
  }

  type Site {
    id: ID!
    name: String!
    archived: Boolean!
    items: [SiteItem!]!
  }

  type ItemEdge {
    cursor: String!
    node: Item!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type ItemConnection {
    edges: [ItemEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type ItemPage {
    items: [Item!]!
    page: Int!
    pageSize: Int!
    totalCount: Int!
    totalPages: Int!
  }

  type Query {
    sites(archived: Boolean, search: String): [Site!]!
    site(id: ID!): Site
    items: [Item!]!
    """
    Items whose name contains the query, sorted by name, paginated per the
    Relay connection spec (forward only).
    """
    searchItems(query: String, first: Int = 20, after: String): ItemConnection!
    "The same search with classic numbered pages (1-based)."
    itemsPage(query: String, page: Int = 1, pageSize: Int = 20): ItemPage!
  }

  type Mutation {
    archiveSite(id: ID!): Site!
    unarchiveSite(id: ID!): Site!
    renameSite(id: ID!, name: String!): Site!
    deleteSite(id: ID!): ID!

    addSiteItem(siteId: ID!, itemId: ID!, onHand: Int = 0): Site!
    removeSiteItem(siteId: ID!, itemId: ID!): Site!
    updateSiteItemOnHand(siteId: ID!, itemId: ID!, onHand: Int!): SiteItem!
  }
`

function notFound(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } })
}

function badInput(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } })
}

function findSite(id: string) {
  return sites.find(s => s.id === id) ?? notFound(`Site ${id} not found`)
}

function findSiteItem(site: Site, itemId: string) {
  return site.items.find(i => i.itemId === itemId) ?? notFound(`Item ${itemId} not found on site ${site.id}`)
}

function assertOnHand(onHand: number) {
  if (onHand < 0) badInput('onHand must be >= 0')
}

// Keyset cursors: opaque to clients, but deterministic from the row itself so
// a client with a local copy of the data can paginate it the same way.
const encodeCursor = (item: CatalogItem) => Buffer.from(`${item.name}\u0000${item.id}`).toString('base64')
function decodeCursor(cursor: string): CatalogItem {
  const [name, id] = Buffer.from(cursor, 'base64').toString().split('\u0000')
  if (name === undefined || id === undefined) badInput('Invalid cursor')
  return { name, id }
}
const compareItems = (a: CatalogItem, b: CatalogItem) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

function matchItems(query?: string | null) {
  const q = query?.trim().toLowerCase()
  return catalog.filter(i => !q || i.name.toLowerCase().includes(q)).sort(compareItems)
}

function itemsPage({ query, page, pageSize }: { query?: string | null, page?: number | null, pageSize?: number | null }) {
  const size = pageSize ?? 20
  const current = page ?? 1
  if (size < 1 || size > 100) badInput('pageSize must be between 1 and 100')
  if (current < 1) badInput('page must be >= 1')
  const matches = matchItems(query)
  return {
    items: matches.slice((current - 1) * size, current * size),
    page: current,
    pageSize: size,
    totalCount: matches.length,
    totalPages: Math.max(1, Math.ceil(matches.length / size)),
  }
}

function searchItems({ query, first, after }: { query?: string | null, first?: number | null, after?: string | null }) {
  const limit = first ?? 20
  if (limit < 1 || limit > 100) badInput('first must be between 1 and 100')
  const matches = matchItems(query)
  const start = after ? matches.findIndex(i => compareItems(i, decodeCursor(after)) > 0) : 0
  const page = start === -1 ? [] : matches.slice(start, start + limit)
  const edges = page.map(node => ({ cursor: encodeCursor(node), node }))
  return {
    edges,
    totalCount: matches.length,
    pageInfo: {
      hasNextPage: start !== -1 && start + limit < matches.length,
      hasPreviousPage: start > 0,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges.at(-1)?.cursor ?? null,
    },
  }
}

export const resolvers = {
  Query: {
    sites: (_: unknown, { archived, search }: { archived?: boolean | null, search?: string | null }) => {
      const q = search?.trim().toLowerCase()
      return sites.filter(s =>
        (archived == null || s.archived === archived)
        && (!q || s.name.toLowerCase().includes(q)))
    },
    site: (_: unknown, { id }: { id: string }) => sites.find(s => s.id === id) ?? null,
    items: () => catalog,
    searchItems: (_: unknown, args: { query?: string | null, first?: number | null, after?: string | null }) => searchItems(args),
    itemsPage: (_: unknown, args: { query?: string | null, page?: number | null, pageSize?: number | null }) => itemsPage(args),
  },

  SiteItem: {
    id: (si: SiteItem) => si.itemId,
    name: (si: SiteItem) => catalog.find(c => c.id === si.itemId)?.name ?? '',
  },

  Mutation: {
    archiveSite: (_: unknown, { id }: { id: string }) => {
      const site = findSite(id)
      site.archived = true
      return site
    },
    unarchiveSite: (_: unknown, { id }: { id: string }) => {
      const site = findSite(id)
      site.archived = false
      return site
    },
    renameSite: (_: unknown, { id, name }: { id: string, name: string }) => {
      const trimmed = name.trim()
      if (!trimmed) badInput('name must not be empty')
      const site = findSite(id)
      site.name = trimmed
      return site
    },
    deleteSite: (_: unknown, { id }: { id: string }) => {
      const index = sites.findIndex(s => s.id === id)
      if (index === -1) notFound(`Site ${id} not found`)
      sites.splice(index, 1)
      return id
    },

    addSiteItem: (_: unknown, { siteId, itemId, onHand }: { siteId: string, itemId: string, onHand: number }) => {
      assertOnHand(onHand)
      const site = findSite(siteId)
      if (!catalog.some(c => c.id === itemId)) notFound(`Item ${itemId} not found`)
      if (site.items.some(i => i.itemId === itemId)) badInput(`Item ${itemId} already on site ${siteId}`)
      site.items.push({ itemId, onHand })
      return site
    },
    removeSiteItem: (_: unknown, { siteId, itemId }: { siteId: string, itemId: string }) => {
      const site = findSite(siteId)
      const item = findSiteItem(site, itemId)
      site.items.splice(site.items.indexOf(item), 1)
      return site
    },
    updateSiteItemOnHand: (_: unknown, { siteId, itemId, onHand }: { siteId: string, itemId: string, onHand: number }) => {
      assertOnHand(onHand)
      const item = findSiteItem(findSite(siteId), itemId)
      item.onHand = onHand
      return item
    },
  },
}
