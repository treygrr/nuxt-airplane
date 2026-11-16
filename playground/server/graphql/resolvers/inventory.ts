// Inventory management: sites, what each holds, and, at sites that track
// inventory, the levels each item is kept between and a restock cart. A
// variant's stock in the shop is what the active sites hold of it, so every
// change to what a site holds changes what the shop can sell.

import { catalogChanged, fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import { findVariant, fitRestock, paginate, restockProblem, siteCartLineView, siteItemId, siteItemView, siteView } from '../../utils/shop'
import type { Site } from '../../utils/seed'

const findSite = (id: string) => store().sites.find(s => s.id === id) ?? fail('NOT_FOUND', `No site ${id}`)
const named = (name: string) => name.trim() || fail('BAD_USER_INPUT', 'A site needs a name')

function checkOnHand(onHand: number) {
  if (!Number.isInteger(onHand) || onHand < 0) fail('BAD_USER_INPUT', 'On hand must be 0 or more')
}

function checkLevels(min: number, max: number) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0) fail('BAD_USER_INPUT', 'Min and max must be 0 or more')
  if (min > max) fail('BAD_USER_INPUT', 'Min cannot be more than max')
}

function holding(site: Site, variantId: string) {
  if (!site.items.has(variantId)) fail('NOT_FOUND', `${site.name} does not hold ${variantId}`)
}

function tracking(site: Site) {
  if (!site.tracksInventory) fail('NOT_TRACKED', `${site.name} does not track inventory`)
}

function checkRestock(variantId: string, quantity: number) {
  const problem = restockProblem(findVariant(variantId).variant, quantity)
  if (problem) fail('BAD_USER_INPUT', problem)
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
      const items = [...site.items.keys()].map(variantId => siteItemView(site, variantId))
        .filter(item => !q || item.productName.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q))
        .sort((a, b) => a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName))
      return paginate(items, first ?? 50, after)
    },
    siteCartLines: (_: unknown, { siteId }: { siteId?: string | null }) =>
      store().sites
        .filter(s => !siteId || s.id === siteId)
        .flatMap(site => [...site.cart.keys()].map(variantId => siteCartLineView(site, variantId)))
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
  },
  Mutation: {
    createSite: (_: unknown, { name }: { name: string }, ctx: RequestContext) =>
      mutation(ctx, 'createSite', null, () => {
        const site: Site = { id: nextId('site'), name: named(name), archived: false, createdAt: new Date().toISOString(), tracksInventory: false, items: new Map(), levels: new Map(), cart: new Map() }
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

    setSiteInventoryTracking: (_: unknown, { id, enabled }: { id: string, enabled: boolean }, ctx: RequestContext) =>
      mutation(ctx, 'setSiteInventoryTracking', `Site:${id}`, () => {
        const site = findSite(id)
        site.tracksInventory = enabled
        if (!enabled) site.cart.clear()
        return siteView(site)
      }),

    addSiteItem: (_: unknown, { siteId, variantId, onHand, min, max }: { siteId: string, variantId: string, onHand?: number | null, min?: number | null, max?: number | null }, ctx: RequestContext) =>
      mutation(ctx, 'addSiteItem', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        findVariant(variantId)
        if (site.items.has(variantId)) fail('ALREADY_AT_SITE', `${site.name} already holds that; change its count instead`)
        checkOnHand(onHand ?? 0)
        checkLevels(min ?? 0, max ?? 0)
        site.items.set(variantId, onHand ?? 0)
        site.levels.set(variantId, { min: min ?? 0, max: max ?? 0 })
        catalogChanged()
        return siteItemView(site, variantId)
      }),

    updateSiteItemOnHand: (_: unknown, { siteId, variantId, onHand }: { siteId: string, variantId: string, onHand: number }, ctx: RequestContext) =>
      mutation(ctx, 'updateSiteItemOnHand', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        holding(site, variantId)
        checkOnHand(onHand)
        site.items.set(variantId, onHand)
        catalogChanged()
        return siteItemView(site, variantId)
      }),

    updateSiteItemLevels: (_: unknown, { siteId, variantId, min, max }: { siteId: string, variantId: string, min: number, max: number }, ctx: RequestContext) =>
      mutation(ctx, 'updateSiteItemLevels', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        holding(site, variantId)
        checkLevels(min, max)
        site.levels.set(variantId, { min, max })
        return siteItemView(site, variantId)
      }),

    removeSiteItem: (_: unknown, { siteId, variantId }: { siteId: string, variantId: string }, ctx: RequestContext) =>
      mutation(ctx, 'removeSiteItem', `SiteItem:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        if (!site.items.delete(variantId)) fail('NOT_FOUND', `${site.name} does not hold ${variantId}`)
        site.levels.delete(variantId)
        site.cart.delete(variantId)
        catalogChanged()
        return siteItemId(siteId, variantId)
      }),

    addSiteCartLine: (_: unknown, { siteId, variantId, quantity }: { siteId: string, variantId: string, quantity: number }, ctx: RequestContext) =>
      mutation(ctx, 'addSiteCartLine', `SiteCartLine:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        tracking(site)
        holding(site, variantId)
        const line = site.cart.get(variantId)
        checkRestock(variantId, (line?.quantity ?? 0) + quantity)
        if (line) line.quantity += quantity
        else site.cart.set(variantId, { quantity, addedAt: new Date().toISOString() })
        return siteCartLineView(site, variantId)
      }),

    setSiteCartLineQuantity: (_: unknown, { siteId, variantId, quantity }: { siteId: string, variantId: string, quantity: number }, ctx: RequestContext) =>
      mutation(ctx, 'setSiteCartLineQuantity', `SiteCartLine:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        const line = site.cart.get(variantId) ?? fail('NOT_FOUND', `${variantId} is not in ${site.name}'s restock cart`)
        checkRestock(variantId, quantity)
        line.quantity = quantity
        return siteCartLineView(site, variantId)
      }),

    removeSiteCartLine: (_: unknown, { siteId, variantId }: { siteId: string, variantId: string }, ctx: RequestContext) =>
      mutation(ctx, 'removeSiteCartLine', `SiteCartLine:${siteId}~${variantId}`, () => {
        const site = findSite(siteId)
        if (!site.cart.delete(variantId)) fail('NOT_FOUND', `${variantId} is not in ${site.name}'s restock cart`)
        return siteItemId(siteId, variantId)
      }),

    fillSiteCartToMax: (_: unknown, { siteId }: { siteId: string }, ctx: RequestContext) =>
      mutation(ctx, 'fillSiteCartToMax', `SiteCart:${siteId}`, () => {
        const site = findSite(siteId)
        tracking(site)
        const now = new Date().toISOString()
        for (const [variantId, onHand] of site.items) {
          const line = site.cart.get(variantId)
          const short = (site.levels.get(variantId)?.max ?? 0) - onHand - (line?.quantity ?? 0)
          if (short <= 0) continue
          const quantity = fitRestock(findVariant(variantId).variant, short)
          if (line) line.quantity += quantity
          else site.cart.set(variantId, { quantity, addedAt: now })
        }
        return [...site.cart.keys()].map(variantId => siteCartLineView(site, variantId))
      }),

    checkOutSiteCart: (_: unknown, { siteId }: { siteId: string }, ctx: RequestContext) =>
      mutation(ctx, 'checkOutSiteCart', `SiteCart:${siteId}`, () => {
        const site = findSite(siteId)
        tracking(site)
        if (!site.cart.size) fail('EMPTY_CART', `${site.name}'s restock cart is empty`)
        const restocked = [...site.cart]
        for (const [variantId, line] of restocked) site.items.set(variantId, (site.items.get(variantId) ?? 0) + line.quantity)
        site.cart.clear()
        catalogChanged()
        return { site: siteView(site), items: restocked.map(([variantId]) => siteItemView(site, variantId)) }
      }),
  },
}
