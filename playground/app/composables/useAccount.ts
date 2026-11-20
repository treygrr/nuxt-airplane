// The customer: their profile and their address book. Every query and
// mutation about them goes through here.

export function useMe() {
  const query = useAirplaneQuery('GetMe')
  return {
    ...query,
    me: computed(() => query.data.value?.me ?? null),
    updateProfile: useMutation('UpdateProfile'),
    setMarketingOptIn: useMutation('SetMarketingOptIn'),
  }
}

export type Address = NuxtAirplaneStores['Address']
export type AddressFields = Omit<Address, 'id' | 'isDefault'>

export function useAddresses() {
  const query = useAirplaneQuery('GetAddresses')
  const addresses = computed(() => query.data.value?.addresses ?? [])
  return {
    ...query,
    addresses,
    defaultAddress: computed(() => addresses.value.find(a => a.isDefault) ?? addresses.value[0] ?? null),
    create: useMutation('CreateAddress'),
    update: useMutation('UpdateAddress'),
    remove: useMutation('DeleteAddress'),
    setDefault: useMutation('SetDefaultAddress'),
  }
}
