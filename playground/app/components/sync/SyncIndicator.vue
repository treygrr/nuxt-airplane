<script setup lang="ts">
import { mdiAlertCircleOutline, mdiCloudCheckOutline, mdiCloudOffOutline, mdiCloudSyncOutline } from '@mdi/js'

// The connection and the queue at a glance, with the work-offline switch in its menu.
const sync = useSync()

const failed = computed(() => sync.pending.value.filter(m => m.status === 'failed').length)
const waiting = computed(() => sync.pending.value.length)

const state = computed(() => {
  if (!sync.online.value) return { icon: mdiCloudOffOutline, color: 'warning', label: 'Offline' }
  if (failed.value) return { icon: mdiAlertCircleOutline, color: 'error', label: `${failed.value} failed` }
  if (sync.syncing.value) return { icon: mdiCloudSyncOutline, color: 'info', label: `Syncing ${sync.syncCount.value} of ${sync.syncTotal.value}` }
  if (waiting.value) return { icon: mdiCloudSyncOutline, color: 'info', label: `${waiting.value} pending` }
  return { icon: mdiCloudCheckOutline, color: 'success', label: 'Synced' }
})
</script>

<template>
  <v-menu :close-on-content-click="false">
    <template #activator="{ props }">
      <v-chip
        v-bind="props"
        :prepend-icon="state.icon"
        :color="state.color"
        variant="tonal"
        size="small"
      >
        {{ state.label }}
      </v-chip>
    </template>

    <v-card
      min-width="260"
      title="Connection"
    >
      <v-card-text>
        <v-progress-linear
          v-if="sync.syncing.value"
          :model-value="sync.syncTotal.value ? (100 * sync.syncCount.value) / sync.syncTotal.value : 0"
          color="info"
          class="mb-3"
        />
        <div class="text-body-medium mb-1">
          {{ waiting }} change{{ waiting === 1 ? '' : 's' }} waiting<template v-if="sync.blocked.value">
            , {{ sync.blocked.value }} held back
          </template>
        </div>
        <div
          v-if="sync.lastError.value"
          class="text-body-small text-error"
        >
          {{ sync.lastError.value }}
        </div>
        <OfflineSwitch class="mt-2" />
        <OfflineCatalogSwitch />
      </v-card-text>
    </v-card>
  </v-menu>
</template>
