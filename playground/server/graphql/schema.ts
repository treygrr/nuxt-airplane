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

  type Query {
    sites(archived: Boolean): [Site!]!
    site(id: ID!): Site
    items: [Item!]!
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

export const resolvers = {
  Query: {
    sites: (_: unknown, { archived }: { archived?: boolean | null }) =>
      archived == null ? sites : sites.filter(s => s.archived === archived),
    site: (_: unknown, { id }: { id: string }) => sites.find(s => s.id === id) ?? null,
    items: () => catalog,
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
