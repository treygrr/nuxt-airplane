// The tables are the only store: `store` writes a response into `db.Site`
// (a table the module inferred from the documents, keyed on `id`) and `read`
// builds the result from it. `read` is what `useQuery('GetSites')` returns,
// online or offline, so a mutation that edits a row shows at once, and a
// filter the server has never seen (a search typed while offline) still works.

export default defineQueryHandler('GetSites', {
  store: ({ db }, data) => db.Site.bulkPut(data.sites),

  async read({ db, variables }) {
    const { archived, search } = variables ?? {}
    const q = search?.trim().toLowerCase()
    const sites = (await db.Site.toArray())
      .filter(s => archived == null || s.archived === archived)
      .filter(s => !q || s.name.toLowerCase().includes(q))
    return { sites }
  },
})
