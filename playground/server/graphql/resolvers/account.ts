import { fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import type { Address } from '../../utils/seed'

type AddressFields = Omit<Address, 'id' | 'isDefault'>
const REQUIRED: (keyof AddressFields)[] = ['name', 'line1', 'city', 'region', 'postalCode', 'country']

const findAddress = (id: string) => store().addresses.find(a => a.id === id) ?? fail('NOT_FOUND', `No address ${id}`)

function check(address: AddressFields) {
  for (const field of REQUIRED) {
    if (!address[field]?.trim()) fail('BAD_USER_INPUT', `An address needs a ${field}`)
  }
}

export const account = {
  Query: {
    me: () => ({ ...store().customer }),
    addresses: () => store().addresses.map(a => ({ ...a })),
  },
  Mutation: {
    createAddress: (_: unknown, { input }: { input: Omit<AddressFields, 'line2'> & { line2?: string | null } }, ctx: RequestContext) =>
      mutation(ctx, 'createAddress', null, () => {
        const fields = { ...input, line2: input.line2 ?? '' }
        check(fields)
        const address: Address = { id: nextId('address'), ...fields, isDefault: store().addresses.length === 0 }
        store().addresses.push(address)
        return { ...address }
      }),

    updateAddress: (_: unknown, { id, ...patch }: { id: string } & Partial<Record<keyof AddressFields, string | null>>, ctx: RequestContext) =>
      mutation(ctx, 'updateAddress', `Address:${id}`, () => {
        const address = findAddress(id)
        const next = { ...address }
        for (const [field, value] of Object.entries(patch)) {
          if (value != null) (next as Record<string, unknown>)[field] = value
        }
        check(next)
        Object.assign(address, next)
        return { ...address }
      }),

    deleteAddress: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'deleteAddress', `Address:${id}`, () => {
        const address = findAddress(id)
        const data = store()
        data.addresses = data.addresses.filter(a => a.id !== id)
        // The default goes to the oldest address left.
        if (address.isDefault && data.addresses[0]) data.addresses[0].isDefault = true
        return id
      }),

    setDefaultAddress: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'setDefaultAddress', `Address:${id}`, () => {
        const address = findAddress(id)
        for (const a of store().addresses) a.isDefault = a === address
        return { ...address }
      }),

    updateProfile: (_: unknown, patch: { name?: string | null, email?: string | null, phone?: string | null }, ctx: RequestContext) =>
      mutation(ctx, 'updateProfile', 'Customer', () => {
        const { customer } = store()
        if (patch.name != null && !patch.name.trim()) fail('BAD_USER_INPUT', 'A name cannot be empty')
        if (patch.email != null && !/^[^@\s]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(patch.email)) fail('BAD_USER_INPUT', `${patch.email} is not an email address`)
        for (const field of ['name', 'email', 'phone'] as const) {
          if (patch[field] != null) customer[field] = patch[field]!
        }
        return { ...customer }
      }),

    setMarketingOptIn: (_: unknown, { optIn }: { optIn: boolean }, ctx: RequestContext) =>
      mutation(ctx, 'setMarketingOptIn', 'Customer', () => {
        store().customer.marketingOptIn = optIn
        return { ...store().customer }
      }),
  },
}
