// A site item's id is the site's and the variant's together, so the client
// can name it without waiting for the server. Added to a site created
// offline, that id carries the site's placeholder.

export default defineMutationHandler('AddSiteItem', {
  async describe({ db, variables }) {
    const variant = await db.Variant.get(variables.variantId)
    const product = variant && await db.Product.get(variant.productId)
    const site = await db.Site.get(variables.siteId)
    return `Stock ${product?.name ?? 'an item'} at ${site?.name ?? 'a site'}`
  },
  async apply({ db, variables }) {
    const variant = await db.Variant.get(variables.variantId)
    const product = variant && await db.Product.get(variant.productId)
    if (!variant || !product) throw new Error(`Variant ${variables.variantId} is not stored`)
    const onHand = variables.onHand ?? 0
    await db.SiteItem.put({
      id: `${variables.siteId}~${variant.id}`,
      siteId: variables.siteId,
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      onHand,
      min: variables.min ?? 0,
      max: variables.max ?? 0,
      boxQuantity: variant.boxQuantity ?? null,
      minOrderQuantity: variant.minOrderQuantity ?? null,
    })
    await db.Site.where('id').equals(variables.siteId).modify((site) => {
      site.itemCount++
      site.unitCount += onHand
    })
  },
  reconcile: ({ db }, result) => db.SiteItem.put(result.addSiteItem),
  // A site's stock is the shop's stock: the catalog's numbers change too.
  refetch: ['GetSites', 'GetSite', 'GetSiteItems', 'GetProduct', 'GetProducts'],
})
