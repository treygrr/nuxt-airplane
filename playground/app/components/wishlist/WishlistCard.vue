<script setup lang="ts">
import { mdiDeleteOutline, mdiDotsVertical, mdiPencilOutline } from '@mdi/js'

// A list and its items.
type List = NuxtAirplaneStores['Wishlist'] & { items: NuxtAirplaneStores['WishlistItem'][] }
defineProps<{ list: List, pendingList?: boolean, pendingItems: Set<string> }>()
defineEmits<{
  rename: []
  delete: []
  note: [itemId: string, note: string]
  move: [itemId: string]
  remove: [itemId: string]
}>()
</script>

<template>
  <v-card
    border
    flat
    class="px-6 py-4"
  >
    <div class="d-flex align-center ga-2">
      <h2 class="text-title-large font-weight-bold">
        {{ list.name }}
      </h2>
      <span class="text-body-small text-medium-emphasis">{{ list.items.length }} item{{ list.items.length === 1 ? '' : 's' }}</span>
      <PendingChip v-if="pendingList" />
      <v-spacer />
      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :icon="mdiDotsVertical"
            variant="text"
            size="small"
            aria-label="List actions"
          />
        </template>
        <v-list density="compact">
          <v-list-item
            :prepend-icon="mdiPencilOutline"
            title="Rename"
            @click="$emit('rename')"
          />
          <v-list-item
            :prepend-icon="mdiDeleteOutline"
            title="Delete the list"
            base-color="error"
            @click="$emit('delete')"
          />
        </v-list>
      </v-menu>
    </div>
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
        @note="$emit('note', item.id, $event)"
        @move="$emit('move', item.id)"
        @remove="$emit('remove', item.id)"
      />
    </template>
  </v-card>
</template>
