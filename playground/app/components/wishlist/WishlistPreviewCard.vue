<script setup lang="ts">
import { mdiHeartOutline } from '@mdi/js'

// A list at a glance: its first four products, its name and its size. The
// whole card opens the list.
type List = NuxtAirplaneStores['Wishlist'] & { items: NuxtAirplaneStores['WishlistItem'][] }
const props = defineProps<{ list: List, pending?: boolean }>()
const preview = computed(() => props.list.items.slice(0, 4))
</script>

<template>
  <v-card
    :to="`/wishlists/${list.id}`"
    border
    flat
    class="h-100"
  >
    <div class="preview pa-2">
      <template v-if="preview.length">
        <v-img
          v-for="item in preview"
          :key="item.id"
          :src="item.imageUrl"
          :alt="item.productName"
          :aspect-ratio="1"
          rounded="lg"
          cover
        />
        <div
          v-for="n in 4 - preview.length"
          :key="`empty-${n}`"
          class="empty rounded-lg"
        />
      </template>
      <div
        v-else
        class="none rounded-lg d-flex align-center justify-center"
      >
        <v-icon
          :icon="mdiHeartOutline"
          size="40"
          class="text-medium-emphasis"
        />
      </div>
    </div>
    <div class="px-4 pb-4 pt-2">
      <div class="d-flex align-center ga-2">
        <h2 class="text-title-medium font-weight-bold text-truncate">
          {{ list.name }}
        </h2>
        <PendingChip v-if="pending" />
      </div>
      <div class="text-body-small text-medium-emphasis">
        {{ list.items.length }} item{{ list.items.length === 1 ? '' : 's' }}
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.preview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.empty,
.none {
  background: rgba(var(--v-theme-on-surface), 0.04);
  aspect-ratio: 1;
}
.none {
  grid-column: span 2;
}
</style>
