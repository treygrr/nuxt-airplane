// Type checks, run by `npm run test:types` and never imported: what the
// handler contexts' `result(name, variables)` takes and hands back.

import type { ResultAccessor } from '#nuxt-airplane'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const expectType = <T extends true>(_: T) => {}

declare const result: ResultAccessor

export async function storedResultTypes() {
  // Typed as the query's result.
  const _me = await result('GetMe').get()
  expectType<Equal<typeof _me, QueryResult<'GetMe'> | undefined>>(true)
  await result('GetMe').update((_data) => {
    expectType<Equal<typeof _data, QueryResult<'GetMe'>>>(true)
  })
  // @ts-expect-error the result of another query
  await result('GetMe').set({ cart: null })

  // A query that needs variables is not reached without them.
  // @ts-expect-error GetSite needs its id
  result('GetSite')
  result('GetSite', { id: 's1' })
  // @ts-expect-error not a variable of GetSite
  result('GetSite', { siteId: 's1' })
  // A query without variables may be given none, or an empty set.
  result('GetMe', {})
}

// Every hook gets it, and a query handler may keep its result whole.
export const viewerHandlers = [
  defineQueryHandler('GetMe', { store: 'result' }),
  defineQueryHandler('GetMe', {
    store: 'result',
    read: ({ result }) => result('GetMe').get(),
  }),
  defineMutationHandler('UpdateProfile', {
    describe: async ({ result }) => `Rename ${(await result('GetMe').get())?.me.name}`,
    apply: ({ result, variables }) => result('GetMe').update((data) => {
      if (variables.name) data.me.name = variables.name
    }),
    reconcile: ({ result }, answer) => result('GetMe').set({ me: answer.updateProfile }),
  }),
]

// The module's helper types need no import, and keep their type parameters.
type IsAny<T> = 0 extends (1 & T) ? true : false
export function globalTypes(db: AirplaneDexie, row: MutationRow) {
  expectType<Equal<IsAny<QueryResult<'GetMe'>>, false>>(true)
  expectType<Equal<QueryResult<'GetMe'>['me']['name'], string>>(true)
  expectType<Equal<QueryVariables<'GetSite'>['id'], string>>(true)
  expectType<Equal<IsAny<MutationResult<'UpdateProfile'>>, false>>(true)
  expectType<Equal<MutationVariables<'UpdateProfile'>['name'], string | null | undefined>>(true)
  const _query: QueryName = 'GetMe'
  // @ts-expect-error not a query
  const _notQuery: QueryName = 'UpdateProfile'
  const _mutation: MutationName = 'UpdateProfile'
  expectType<Equal<typeof row.status, 'pending' | 'syncing' | 'failed'>>(true)
  expectType<Equal<IsAny<typeof db.Product>, false>>(true)
  return db.mutations.get(row.id)
}
