<script setup lang="ts">
import { mdiHeartOutline, mdiPlus } from '@mdi/js'

// The customer's lists of saved products.
useHead({ title: 'Wishlists · Toolshed' })
const wishlists = useWishlists()
const { lists, loading } = wishlists
const pendingLists = usePendingRows('Wishlist')
const pendingItems = usePendingRows('WishlistItem')

const naming = ref<{ id?: string, name?: string } | null>(null)
function saveName(name: string) {
  if (naming.value?.id) void wishlists.rename.mutate({ id: naming.value.id, name })
  else void wishlists.create.mutate({ name })
}
</script>

<template>
  <div>
    <div class="d-flex align-center mb-6">
      <h1 class="text-headline-medium font-weight-bold me-auto">
        Wishlists
      </h1>
      <v-btn
        :prepend-icon="mdiPlus"
        color="primary"
        @click="naming = {}"
      >
        New list
      </v-btn>
    </div>
    <v-skeleton-loader
      v-if="loading && !lists.length"
      type="card@2"
    />
    <v-empty-state
      v-else-if="!lists.length"
      :icon="mdiHeartOutline"
      title="No lists yet"
      text="Make a list for the next project and save tools to it."
    />
    <div
      v-else
      class="d-flex flex-column ga-4"
    >
      <WishlistCard
        v-for="list in lists"
        :key="list.id"
        :list="list"
        :pending-list="pendingLists.has(list.id)"
        :pending-items="pendingItems"
        @rename="naming = list"
        @delete="wishlists.remove.mutate({ id: list.id })"
        @note="(itemId, note) => wishlists.setNote.mutate({ itemId, note })"
        @move="itemId => wishlists.moveToCart.mutate({ itemId, quantity: 1 })"
        @remove="itemId => wishlists.removeItem.mutate({ itemId })"
      />
    </div>
    <TextPromptDialog
      :model-value="!!naming"
      :title="naming?.id ? 'Rename list' : 'New list'"
      label="Name"
      :value="naming?.name"
      :action="naming?.id ? 'Rename' : 'Create'"
      @update:model-value="!$event && (naming = null)"
      @submit="saveName"
    />
  </div>
</template>
