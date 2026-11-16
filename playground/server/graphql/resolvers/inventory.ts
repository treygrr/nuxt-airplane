// Inventory management: sites and what each holds. A variant's stock in the
// shop is what the active sites hold of it, so every change here changes
// what the shop can sell.

import { catalogChanged, fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import { findVariant, paginate, siteItemView, siteView } from '../../utils/shop'
import type { Site } from '../../utils/seed'

const findSite = (id: string) => store().sites.find(s => s.id === id) ?? fail('NOT_FOUND', `No site ${id}`)
const named = (name: string) => name.trim() || fail('BAD_USER_INPUT', 'A site needs a name')

function checkOnHand(onHand: number) {
  if (!Number.isInteger(onHand) || onHand < 0) fail('BAD_USER_INPUT', 'On hand must be 0 or more')
}

export const inventory = {
  Query: {
    sites: (_: unknown, { archived, search }: { archived?: boolean | null, search?: string | null }) => {
      const q = search?.trim().toLowerCase()
      return store().sites
        .filter(s => archived == null || s.archived === archived)
        .filter(s => !q || s.name.toLowerCase().includes(q))
        .map(siteView)
    },
    site: (_: unknown, { id }: { id: string }) => {
      const site = store().sites.find(s => s.id === id)
      return site ? siteView(site) : null
    },
    siteItems: (_: unknown, { siteId, first, after, search }: { siteId: string, first?: number | null, after?: string | null, search?: string | null }) => {
      const site = findSite(siteId)
      const q = search?.trim().toLowerCase()
      const items = [...site.items].map(([variantId, onHand]) => siteItemView(site.id, variantId, onHand))
        .filter(item => !q || item.productName.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q))
        .sort((a, b) => a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName))
      return paginate(items, first ?? 50, after)
    },
  },
  Mutation: {
    createSite: (_: unknown, { name }: { name: string }, ctx: RequestContext) =>
      mutation(ctx, 'createSite', null, () => {
        const site: Site = { id: nextId('site'), name: named(name), archived: false, createdAt: new Date().toISOString(), items: new Map() }
        store().sites.push(site)
        return siteView(site)
      }),

    renameSite: (_: unknown, { id, name }: { id: string, name: string }, ctx: RequestContext) =>
      mutation(ctx, 'renameSite', `Site:${id}`, () => {
        const site = findSite(id)
        site.name = named(name)
        return siteView(site)
      }),

    archiveSite: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'archiveSite', `Site:${id}`, () => {
        const site = findSite(id)
        site.archived = true
        catalogChanged()
        return siteView(site)
      }),

    unarchiveSite: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'unarchiveSite', `Site:${id}`, () => {
        const site = findSite(id)
        site.archived = false
        catalogChanged()
        return siteView(site)
      }),

    deleteSite: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'deleteSite', `Site:${id}`, () => {
        const site = findSite(id)
        if ([...site.items.values()].some(n => n > 0)) fail('SITE_NOT_EMPTY', `${site.name} still holds stock; move or remove it first`)
        store().sites = store().sites.filter(s => s.id !== id)
        return id
      }),

    addSiteItem: (_: unknown, { siteId, variantId, onHand }: { siteId: string, variantId: string, onHand?: number | null }, ctx: RequestContext) =>
      mutation(ctx, 'addSiteItem', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        findVariant(variantId)
        if (site.items.has(variantId)) fail('ALREADY_AT_SITE', `${site.name} already holds that; change its count instead`)
        checkOnHand(onHand ?? 0)
        site.items.set(variantId, onHand ?? 0)
        catalogChanged()
        return siteItemView(site.id, variantId, onHand ?? 0)
      }),

    updateSiteItemOnHand: (_: unknown, { siteId, variantId, onHand }: { siteId: string, variantId: string, onHand: number }, ctx: RequestContext) =>
      mutation(ctx, 'updateSiteItemOnHand', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        if (!site.items.has(variantId)) fail('NOT_FOUND', `${site.name} does not hold ${variantId}`)
        checkOnHand(onHand)
        site.items.set(variantId, onHand)
        catalogChanged()
        return siteItemView(site.id, variantId, onHand)
      }),

    removeSiteItem: (_: unknown, { siteId, variantId }: { siteId: string, variantId: string }, ctx: RequestContext) =>
      mutation(ctx, 'removeSiteItem', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        if (!site.items.delete(variantId)) fail('NOT_FOUND', `${site.name} does not hold ${variantId}`)
        catalogChanged()
        return `${siteId}~${variantId}`
      }),
  },
}
