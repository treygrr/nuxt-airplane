import { fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import { findProduct, imageUrl } from '../../utils/shop'
import type { Wishlist, WishlistItem } from '../../utils/seed'
import { addLine } from './cart'

function itemView(item: WishlistItem) {
  const product = findProduct(item.productId)
  const variant = product?.variants.find(v => v.id === item.variantId) ?? product?.variants[0]
  return { ...item, productName: product?.name ?? 'Discontinued product', imageUrl: imageUrl(item.productId), price: variant?.price ?? 0 }
}

const listView = (list: Wishlist) => ({ ...list, items: list.items.map(itemView) })

const findList = (id: string) => store().wishlists.find(w => w.id === id) ?? fail('NOT_FOUND', `No wishlist ${id}`)

function findItem(id: string) {
  for (const list of store().wishlists) {
    const item = list.items.find(i => i.id === id)
    if (item) return { list, item }
  }
  return fail('NOT_FOUND', `No wishlist item ${id}`)
}

const named = (name: string) => name.trim() || fail('BAD_USER_INPUT', 'A wishlist needs a name')

export const wishlists = {
  Query: {
    wishlists: () => store().wishlists.map(listView),
  },
  Mutation: {
    createWishlist: (_: unknown, { name }: { name: string }, ctx: RequestContext) =>
      mutation(ctx, 'createWishlist', null, () => {
        const list: Wishlist = { id: nextId('wishlist'), name: named(name), createdAt: new Date().toISOString(), items: [] }
        store().wishlists.push(list)
        return listView(list)
      }),

    renameWishlist: (_: unknown, { id, name }: { id: string, name: string }, ctx: RequestContext) =>
      mutation(ctx, 'renameWishlist', `Wishlist:${id}`, () => {
        const list = findList(id)
        list.name = named(name)
        return listView(list)
      }),

    deleteWishlist: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'deleteWishlist', `Wishlist:${id}`, () => {
        findList(id)
        store().wishlists = store().wishlists.filter(w => w.id !== id)
        return id
      }),

    addWishlistItem: (_: unknown, args: { wishlistId: string, productId: string, variantId?: string | null, note?: string | null }, ctx: RequestContext) =>
      mutation(ctx, 'addWishlistItem', `Wishlist:${args.wishlistId}`, () => {
        const list = findList(args.wishlistId)
        if (!findProduct(args.productId)) fail('NOT_FOUND', `No product ${args.productId}`)
        if (list.items.some(i => i.productId === args.productId)) fail('ALREADY_ON_LIST', 'That product is already on the list')
        const item: WishlistItem = { id: nextId('wishlist-item'), wishlistId: list.id, productId: args.productId, variantId: args.variantId ?? null, note: args.note ?? '', addedAt: new Date().toISOString() }
        list.items.push(item)
        return itemView(item)
      }),

    setWishlistItemNote: (_: unknown, { itemId, note }: { itemId: string, note: string }, ctx: RequestContext) =>
      mutation(ctx, 'setWishlistItemNote', `WishlistItem:${itemId}`, () => {
        const { item } = findItem(itemId)
        if (note.length > 500) fail('BAD_USER_INPUT', 'Notes are at most 500 characters')
        item.note = note
        return itemView(item)
      }),

    removeWishlistItem: (_: unknown, { itemId }: { itemId: string }, ctx: RequestContext) =>
      mutation(ctx, 'removeWishlistItem', `WishlistItem:${itemId}`, () => {
        const { list } = findItem(itemId)
        list.items = list.items.filter(i => i.id !== itemId)
        return itemId
      }),

    moveWishlistItemToCart: (_: unknown, { itemId, quantity }: { itemId: string, quantity?: number | null }, ctx: RequestContext) =>
      mutation(ctx, 'moveWishlistItemToCart', `WishlistItem:${itemId}`, () => {
        const { list, item } = findItem(itemId)
        const product = findProduct(item.productId) ?? fail('NOT_FOUND', 'That product is no longer sold')
        const variantId = item.variantId ?? product.variants[0]!.id
        // Into the cart first: if that fails, the item stays on its list.
        const line = addLine(variantId, quantity ?? 1)
        list.items = list.items.filter(i => i.id !== itemId)
        return line
      }),
  },
}
