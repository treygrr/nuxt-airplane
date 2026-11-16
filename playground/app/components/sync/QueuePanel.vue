<script setup lang="ts">
import { mdiCloudCheckOutline, mdiDeleteSweepOutline, mdiRefresh, mdiSync } from '@mdi/js'
import type { MutationRow } from '#nuxt-airplane'

// Every change waiting for the server, oldest first, each under what it
// depends on. Failed changes can be retried or undone, one at a time or all
// at once; undoing one takes the changes that cannot go on without it.
const queue = useQueue()

const counts = computed(() => ({
  failed: queue.rows.value.filter(r => r.state === 'failed').length,
  held: queue.rows.value.filter(r => r.state === 'held').length,
}))

// A countdown to the next automatic attempt, ticking once a second.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)))
onBeforeUnmount(() => clearInterval(timer))
const retryIn = computed(() => (queue.retryAt.value ? Math.max(0, Math.ceil((queue.retryAt.value - now.value) / 1000)) : null))

// Undo asks first, naming what goes with it.
const confirming = ref<{ kind: 'one', row: MutationRow, with: MutationRow[] } | { kind: 'failures', failed: MutationRow[], with: MutationRow[] } | null>(null)
function askUndo(row: MutationRow) {
  confirming.value = { kind: 'one', row, with: queue.dependents(row.id) }
}
function askClear() {
  const failed = queue.failed.value
  confirming.value = { kind: 'failures', failed, with: queue.clearable.value.filter(m => !failed.includes(m)) }
}
async function confirmed() {
  const c = confirming.value
  confirming.value = null
  if (c?.kind === 'one') await queue.rollback(c.row.id)
  else if (c) await queue.clearFailures()
}
</script>

<template>
  <div class="d-flex flex-column h-100">
    <div class="pa-4 pb-2">
      <div class="d-flex align-center mb-1">
        <h2 class="text-title-large font-weight-bold me-auto">
          Pending changes
        </h2>
        <v-btn
          :prepend-icon="mdiSync"
          :loading="queue.syncing.value"
          :disabled="!queue.online.value"
          size="small"
          variant="tonal"
          @click="queue.sync()"
        >
          Sync now
        </v-btn>
      </div>
      <div class="text-body-small text-medium-emphasis">
        {{ queue.rows.value.length }} waiting<template v-if="counts.failed">
          · {{ counts.failed }} failed
        </template><template v-if="counts.held">
          · {{ counts.held }} held back
        </template>
        <template v-if="!queue.online.value">
          · offline, sent when you are back
        </template>
        <template v-else-if="retryIn != null">
          · trying again in {{ retryIn }} s
        </template>
      </div>
      <div
        v-if="queue.lastError.value"
        class="text-body-small text-error mt-1"
      >
        {{ queue.lastError.value }}
      </div>
      <div
        v-if="counts.failed"
        class="d-flex ga-2 mt-3"
      >
        <v-btn
          :prepend-icon="mdiRefresh"
          size="small"
          color="primary"
          variant="tonal"
          @click="queue.retryFailed()"
        >
          Retry failed
        </v-btn>
        <v-btn
          :prepend-icon="mdiDeleteSweepOutline"
          size="small"
          color="error"
          variant="tonal"
          @click="askClear"
        >
          Clear failures
        </v-btn>
      </div>
    </div>
    <v-divider />
    <div class="flex-grow-1 overflow-y-auto">
      <v-empty-state
        v-if="!queue.rows.value.length"
        :icon="mdiCloudCheckOutline"
        title="All synced"
        text="Every change you made is on the server."
        size="64"
      />
      <QueueItem
        v-for="item in queue.rows.value"
        :key="item.row.id"
        :item="item"
        @retry="queue.retry(item.row.id)"
        @rollback="askUndo(item.row)"
      />
    </div>

    <ConfirmDialog
      :model-value="!!confirming"
      :title="confirming?.kind === 'failures' ? 'Clear failed changes?' : 'Undo this change?'"
      :action="confirming?.kind === 'failures' ? 'Clear' : 'Undo'"
      @update:model-value="!$event && (confirming = null)"
      @confirm="confirmed"
    >
      <template v-if="confirming?.kind === 'one'">
        <p class="mb-2">
          “{{ confirming.row.description }}” will be undone here and never sent.
        </p>
      </template>
      <template v-else-if="confirming?.kind === 'failures'">
        <p class="mb-1">
          These are undone here and never sent:
        </p>
        <ul class="ps-5 mb-3 text-body-medium">
          <li
            v-for="m in confirming.failed"
            :key="m.id"
          >
            {{ m.description }}
          </li>
        </ul>
      </template>
      <template v-if="confirming?.with.length">
        <p class="mb-1">
          These may go with {{ confirming.kind === 'one' ? 'it' : 'them' }}, if they cannot go on alone:
        </p>
        <ul class="ps-5 text-body-medium">
          <li
            v-for="m in confirming.with"
            :key="m.id"
          >
            {{ m.description }}
          </li>
        </ul>
      </template>
    </ConfirmDialog>
  </div>
</template>
