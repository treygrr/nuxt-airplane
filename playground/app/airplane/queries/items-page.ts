// Classic numbered pages over the same catalog. `read` slices the local
// `items` table at the same offset as the server, so a page that was fetched
// comes back identical; offline, a page that was never fetched shows what the
// local data has at that offset, and `totalPages` reflects local data.

export default defineQueryHandler('ItemsPage', {
  // Numbered pages prefetch the same way: page + 1 until the last one.
  prefetch: {
    next: (data, variables) => data.itemsPage.page < data.itemsPage.totalPages
      ? { ...variables, page: data.itemsPage.page + 1 }
      : null,
  },

  // A page is a subset: upsert only.
  store: ({ db }, data) => db.items.bulkPut(data.itemsPage.items),

  async read({ db, variables }) {
    const { query, page, pageSize } = variables ?? {}
    const size = pageSize ?? 20
    const current = page ?? 1
    const q = query?.trim().toLowerCase()
    const matches = (await db.items.orderBy('name').toArray())
      .filter(i => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return {
      itemsPage: {
        items: matches.slice((current - 1) * size, current * size),
        page: current,
        pageSize: size,
        totalCount: matches.length,
        totalPages: Math.max(1, Math.ceil(matches.length / size)),
      },
    }
  },
})
