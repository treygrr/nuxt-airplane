<script setup lang="ts">
import { mdiAlertCircleOutline, mdiClockOutline, mdiPauseCircleOutline, mdiRefresh, mdiSync, mdiUndo } from '@mdi/js'
import type { QueueRow } from '~/composables/useQueue'

// One change in the queue: what it is, where it stands, and what can be done.
const props = defineProps<{ item: QueueRow }>()
defineEmits<{ retry: [], rollback: [] }>()

const STATES = {
  pending: { label: 'Waiting', color: 'info', icon: mdiClockOutline },
  syncing: { label: 'Sending', color: 'primary', icon: mdiSync },
  failed: { label: 'Failed', color: 'error', icon: mdiAlertCircleOutline },
  held: { label: 'Held back', color: 'warning', icon: mdiPauseCircleOutline },
} as const
const state = computed(() => STATES[props.item.state])

const age = computed(() => {
  const seconds = Math.max(0, Math.round((Date.now() - props.item.row.createdAt) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
})
</script>

<template>
  <div
    class="queue-item d-flex ga-3 py-3 pe-3"
    :style="{ paddingInlineStart: `${12 + item.depth * 20}px` }"
  >
    <v-icon
      :icon="state.icon"
      :color="state.color"
      size="20"
      class="mt-1"
    />
    <div class="flex-grow-1 min-width-0">
      <div class="text-body-medium font-weight-medium">
        {{ item.row.description }}
      </div>
      <div class="d-flex align-center flex-wrap ga-2 text-body-small text-medium-emphasis">
        <v-chip
          :color="state.color"
          size="x-small"
          variant="tonal"
        >
          {{ state.label }}
        </v-chip>
        <span>{{ age }}</span>
        <span v-if="item.row.attempts">· sent {{ item.row.attempts }}×</span>
      </div>
      <div
        v-if="item.row.error"
        class="text-body-small text-error mt-1"
      >
        {{ item.row.error }}
      </div>
      <div
        v-else-if="item.state === 'held'"
        class="text-body-small text-medium-emphasis mt-1"
      >
        Waits for a failed change above it.
      </div>
    </div>
    <div class="d-flex flex-column ga-1">
      <v-btn
        v-if="item.state === 'failed'"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="tonal"
        color="primary"
        @click="$emit('retry')"
      >
        Retry
      </v-btn>
      <v-btn
        v-if="item.state !== 'syncing'"
        :prepend-icon="mdiUndo"
        size="small"
        variant="text"
        @click="$emit('rollback')"
      >
        Undo
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.queue-item + .queue-item {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.min-width-0 {
  min-width: 0;
}
</style>
