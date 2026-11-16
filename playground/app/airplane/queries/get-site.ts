export default defineQueryHandler('GetSite', {
  store: async ({ db }, data) => {
    if (data.site) await db.Site.put(data.site)
  },
  read: async ({ db, variables }) => ({ site: (await db.Site.get(variables.id)) ?? null }),
})
