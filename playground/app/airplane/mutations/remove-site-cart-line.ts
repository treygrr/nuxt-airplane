export default defineMutationHandler('RemoveSiteCartLine', {
  async describe({ db, variables }) {
    const line = await db.SiteCartLine.get(`${variables.siteId}~${variables.variantId}`)
    return `Take ${line?.productName ?? 'an item'} out of a restock cart`
  },
  apply: ({ db, variables }) => db.SiteCartLine.delete(`${variables.siteId}~${variables.variantId}`),
})
