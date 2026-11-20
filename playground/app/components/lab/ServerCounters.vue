<script setup lang="ts">
// What the server saw of the client, asked for every second. An online
// query: it comes from the server only, and the first answer is in the page
// as it is rendered. Offline it has nothing new to show, which is the point
// of having one query like that.
const { data, error, refresh } = useOnlineQuery('LabStats')

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(refresh, 1000)))
onBeforeUnmount(() => clearInterval(timer))

const ROWS = [
  { key: 'products', label: 'Products in the catalog' },
  { key: 'requests', label: 'Requests' },
  { key: 'mutations', label: 'Mutations' },
  { key: 'maxConcurrent', label: 'Most mutations at once' },
  { key: 'repeatedKeys', label: 'Retries answered from the first answer', good: true },
  { key: 'appliedTwice', label: 'Applied twice', bad: true },
  { key: 'overlaps', label: 'Two changes to one thing at once', bad: true },
  { key: 'dropped', label: 'Dropped' },
  { key: 'lostAnswers', label: 'Answers lost' },
  { key: 'unauthorized', label: '401 session expired' },
  { key: 'rateLimited', label: '429 rate limited' },
  { key: 'unavailable', label: '503 unavailable' },
  { key: 'rejected', label: 'Rejected on purpose' },
] as const

const stats = computed(() => data.value?.labStats)
const recent = computed(() => (stats.value?.log ?? []).slice(-8).reverse().map(line => JSON.parse(line) as { op: string, entity: string | null, outcome: string, error?: string }))
</script>

<template>
  <v-card
    title="Server"
    subtitle="What it saw of this client"
  >
    <v-card-text>
      <v-alert
        v-if="error && !stats"
        type="warning"
        variant="tonal"
        density="compact"
        :text="error.message"
      />
      <v-table
        v-if="stats"
        density="compact"
      >
        <tbody>
          <tr
            v-for="row in ROWS"
            :key="row.key"
          >
            <td>{{ row.label }}</td>
            <td
              class="text-end font-weight-medium"
              :class="{ 'text-error': 'bad' in row && stats[row.key] > 0, 'text-success': 'good' in row && stats[row.key] > 0 }"
            >
              {{ stats[row.key].toLocaleString() }}
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-list
        v-if="recent.length"
        density="compact"
        class="mt-2"
      >
        <v-list-subheader>Latest mutations</v-list-subheader>
        <v-list-item
          v-for="(entry, i) in recent"
          :key="i"
          :title="entry.op"
          :subtitle="entry.error ?? entry.entity ?? ''"
        >
          <template #append>
            <v-chip
              size="x-small"
              :color="entry.outcome === 'applied' ? 'success' : entry.outcome === 'repeated' ? 'info' : 'error'"
            >
              {{ entry.outcome }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>
