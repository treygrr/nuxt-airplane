// The customer: their profile, for now. Addresses and the rest join it as
// those pages are built.

export function useMe() {
  const query = useQuery('GetMe')
  return { ...query, me: computed(() => query.data.value?.me ?? null) }
}
