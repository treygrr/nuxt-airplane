import { now } from '../../lib/airplane'

export default defineMutationHandler('CreateSite', {
  describe: ({ variables }) => `Create the site ${variables.name}`,
  apply: ({ db, variables, tempId }) =>
    db.Site.put({ id: tempId(), name: variables.name, archived: false, createdAt: now(), tracksInventory: false, itemCount: 0, unitCount: 0 }),
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.createSite.id)
    await db.Site.put(result.createSite)
  },
})
