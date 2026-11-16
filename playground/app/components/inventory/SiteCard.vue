<script setup lang="ts">
import { mdiArchiveArrowDownOutline, mdiArchiveArrowUpOutline, mdiDeleteOutline, mdiDotsVertical, mdiPencilOutline } from '@mdi/js'

// One site in the list: its counts, and what can be done to it.
defineProps<{
  site: { id: string, name: string, archived: boolean, tracksInventory: boolean, itemCount: number, unitCount: number }
  /** A queued change has touched it and has not reached the server yet. */
  pending?: boolean
}>()
defineEmits<{ rename: [], archive: [], unarchive: [], delete: [] }>()
</script>

<template>
  <v-card
    :to="`/inventory/${site.id}`"
    :class="{ 'opacity-60': site.archived }"
    variant="outlined"
  >
    <v-card-item>
      <v-card-title class="d-flex align-center ga-2">
        {{ site.name }}
        <v-chip
          v-if="site.archived"
          size="x-small"
        >
          Archived
        </v-chip>
        <v-chip
          v-if="site.tracksInventory"
          size="x-small"
          color="primary"
          variant="tonal"
        >
          Tracks levels
        </v-chip>
        <PendingChip v-if="pending" />
      </v-card-title>
      <v-card-subtitle>
        {{ site.itemCount.toLocaleString() }} items · {{ site.unitCount.toLocaleString() }} units
      </v-card-subtitle>
      <template #append>
        <v-menu>
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="mdiDotsVertical"
              variant="text"
              size="small"
              aria-label="Site actions"
              @click.prevent
            />
          </template>
          <v-list density="compact">
            <v-list-item
              :prepend-icon="mdiPencilOutline"
              title="Rename"
              @click="$emit('rename')"
            />
            <v-list-item
              v-if="site.archived"
              :prepend-icon="mdiArchiveArrowUpOutline"
              title="Unarchive"
              @click="$emit('unarchive')"
            />
            <v-list-item
              v-else
              :prepend-icon="mdiArchiveArrowDownOutline"
              title="Archive"
              @click="$emit('archive')"
            />
            <v-list-item
              :prepend-icon="mdiDeleteOutline"
              title="Delete"
              base-color="error"
              @click="$emit('delete')"
            />
          </v-list>
        </v-menu>
      </template>
    </v-card-item>
  </v-card>
</template>
