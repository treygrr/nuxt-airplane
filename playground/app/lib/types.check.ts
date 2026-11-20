// Type checks, run by `npm run test:types` and never imported: what the
// handler contexts' `result(name, variables)` takes and hands back.

import type { QueryResult, ResultAccessor } from '#nuxt-airplane'

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
