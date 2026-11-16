<script setup lang="ts">
// What this browser holds: rows per table, fetch records, the server's
// versions set aside under queued changes, the queue, and storage use.
const airplane = useAirplane()
const counts = ref<{ name: string, rows: number }[]>([])
const storage = ref<{ usage: number, quota: number } | null>(null)

async function measure() {
  if (!airplane) return
  counts.value = await Promise.all(airplane.db.tables.map(async table => ({ name: table.name, rows: await table.count() })))
  const estimate = await navigator.storage?.estimate?.()
  if (estimate?.quota) storage.value = { usage: estimate.usage ?? 0, quota: estimate.quota }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void measure()
  timer = setInterval(measure, 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const MODULE = ['queries', 'mutations', 'base', 'meta']
const module = computed(() => counts.value.filter(c => MODULE.includes(c.name)))
const data = computed(() => counts.value.filter(c => !MODULE.includes(c.name)))
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`
const LABELS: Record<string, string> = { queries: 'Fetch records', mutations: 'Queued mutations', base: 'Server versions set aside', meta: 'Bookkeeping' }
</script>

<template>
  <v-card
    title="This browser"
    subtitle="What IndexedDB holds"
  >
    <v-card-text>
      <div
        v-if="storage"
        class="mb-3"
      >
        <div class="d-flex justify-space-between text-body-small">
          <span>Storage</span>
          <span>{{ mb(storage.usage) }} of {{ mb(storage.quota) }}</span>
        </div>
        <v-progress-linear
          :model-value="(100 * storage.usage) / storage.quota"
          :color="storage.usage / storage.quota > 0.9 ? 'error' : 'primary'"
          rounded
        />
      </div>
      <v-table density="compact">
        <tbody>
          <tr
            v-for="c in module"
            :key="c.name"
          >
            <td>{{ LABELS[c.name] }}</td>
            <td class="text-end font-weight-medium">
              {{ c.rows.toLocaleString() }}
            </td>
          </tr>
          <tr
            v-for="c in data"
            :key="c.name"
          >
            <td class="text-medium-emphasis">
              {{ c.name }}
            </td>
            <td class="text-end">
              {{ c.rows.toLocaleString() }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>
