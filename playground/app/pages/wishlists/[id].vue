<script setup lang="ts">
import { mdiArrowLeft, mdiDeleteOutline, mdiDotsVertical, mdiPencilOutline } from '@mdi/js'

// One list: its items, a note on each, and moving them to the cart.
const route = useRoute()
const wishlists = useWishlists()
const { lists, loading } = wishlists
const list = computed(() => lists.value.find(l => l.id === route.params.id))
const pendingList = usePendingRows('Wishlist')
const pendingItems = usePendingRows('WishlistItem')
useHead({ title: () => `${list.value?.name ?? 'Wishlist'} · Toolshed` })

// A list made offline is opened by its temp id, which goes away when it
// syncs. Follow it to the server's id. The module keeps that map only in its
// own bookkeeping, so this reads it there (FINDINGS.md, 10).
const airplane = useAirplane()
watch(list, async (now, before) => {
  if (now || !before || !String(route.params.id).startsWith('tmp-')) return
  const raw = (await airplane?.db.meta.get('tempIds'))?.value
  const id = raw && (JSON.parse(raw) as Record<string, string>)[String(route.params.id)]
  if (id) await navigateTo(`/wishlists/${id}`, { replace: true })
})

const renaming = ref(false)
async function remove(id: string) {
  void wishlists.remove.mutate({ id })
  await navigateTo('/wishlists')
}
</script>

<template>
  <div>
    <v-btn
      :prepend-icon="mdiArrowLeft"
      to="/wishlists"
      variant="text"
      class="mb-2"
    >
      Wishlists
    </v-btn>
    <v-skeleton-loader
      v-if="loading && !list"
      type="article"
    />
    <v-empty-state
      v-else-if="!list"
      title="List not found"
      text="It may have been deleted, or not loaded on this device yet."
    />
    <template v-else>
      <div class="d-flex align-center ga-2 mb-6">
        <h1 class="text-headline-medium font-weight-bold">
          {{ list.name }}
        </h1>
        <span class="text-body-medium text-medium-emphasis">{{ list.items.length }} item{{ list.items.length === 1 ? '' : 's' }}</span>
        <PendingChip v-if="pendingList.has(list.id)" />
        <v-spacer />
        <v-menu>
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="mdiDotsVertical"
              variant="text"
              aria-label="List actions"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              :prepend-icon="mdiPencilOutline"
              title="Rename"
              @click="renaming = true"
            />
            <v-list-item
              :prepend-icon="mdiDeleteOutline"
              title="Delete the list"
              base-color="error"
              :disabled="wishlists.remove.loading.value"
              @click="remove(list.id)"
            />
          </v-list>
        </v-menu>
      </div>
      <v-card
        border
        flat
        class="px-6 py-2"
      >
        <p
          v-if="!list.items.length"
          class="text-body-medium text-medium-emphasis py-4"
        >
          Nothing saved yet. Use “Save to a list” on any product.
        </p>
        <template
          v-for="(item, i) in list.items"
          :key="item.id"
        >
          <v-divider v-if="i" />
          <WishlistItemRow
            :item="item"
            :pending="pendingItems.has(item.id)"
            :busy="wishlists.moveToCart.loading.value || wishlists.removeItem.loading.value"
            @note="wishlists.setNote.mutate({ itemId: item.id, note: $event })"
            @move="wishlists.moveToCart.mutate({ itemId: item.id, quantity: 1 })"
            @remove="wishlists.removeItem.mutate({ itemId: item.id })"
          />
        </template>
      </v-card>
      <TextPromptDialog
        v-model="renaming"
        title="Rename list"
        label="Name"
        :value="list.name"
        action="Rename"
        @submit="name => wishlists.rename.mutate({ id: list!.id, name })"
      />
    </template>
  </div>
</template>
