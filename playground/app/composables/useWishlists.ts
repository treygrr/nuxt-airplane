// Wishlists: the lists, their items, and every change to them. A list made
// offline can be filled, noted and renamed before it syncs: those changes
// wait for it, and undoing it undoes them.

export function useWishlists() {
  const query = useAirplaneQuery('GetWishlists')
  return {
    ...query,
    lists: computed(() => query.data.value?.wishlists ?? []),
    create: useMutation('CreateWishlist'),
    rename: useMutation('RenameWishlist'),
    remove: useMutation('DeleteWishlist'),
    addItem: useMutation('AddWishlistItem'),
    setNote: useMutation('SetWishlistItemNote'),
    removeItem: useMutation('RemoveWishlistItem'),
    moveToCart: useMutation('MoveWishlistItemToCart'),
  }
}
