<script setup lang="ts">
// Load generators. Each one is timed, from the click until the queue has
// drained or the walk has finished, and counts the main thread's long tasks
// (over 50 ms) on the way: how responsive the page stayed.
const airplane = useAirplane()
const sync = useSync()
const setOnHand = useMutation('UpdateSiteItemOnHand')
const addLine = useMutation('AddCartLine')
const setQuantity = useMutation('SetCartLineQuantity')

interface Run { label: string, queued?: number, queueMs?: number, totalMs: number, longTasks: number, longestTask: number }
const runs = ref<Run[]>([])
const busy = ref<string | null>(null)
const progress = ref('')

const until = async (check: () => boolean | Promise<boolean>) => {
  while (!(await check())) await new Promise(resolve => setTimeout(resolve, 100))
}
const drained = () => until(async () => !sync.syncing.value && (await airplane!.db.mutations.count()) === 0)

async function measure(label: string, work: () => Promise<{ queued?: number, queueMs?: number }>) {
  busy.value = label
  const tasks: number[] = []
  const observer = typeof PerformanceObserver !== 'undefined' ? new PerformanceObserver(list => list.getEntries().forEach(e => tasks.push(e.duration))) : null
  try {
    observer?.observe({ type: 'longtask', buffered: false })
  }
  catch {
    // Long tasks are not reported in this browser.
  }
  const started = performance.now()
  try {
    const extra = await work()
    runs.value.unshift({ label, ...extra, totalMs: Math.round(performance.now() - started), longTasks: tasks.length, longestTask: Math.round(Math.max(0, ...tasks)) })
  }
  finally {
    observer?.disconnect()
    busy.value = null
    progress.value = ''
  }
}

const generators = [
  {
    label: 'Prefetch the whole catalog',
    run: () => measure('Prefetch the whole catalog', async () => {
      await airplane!.fetchQuery('GetProducts', { first: 24 })
      await until(() => sync.prefetching.value === 0)
      return {}
    }),
  },
  {
    label: 'Visit 300 product pages',
    run: () => measure('Visit 300 product pages', async () => {
      for (let n = 1; n <= 300; n++) {
        progress.value = `${n} / 300`
        await airplane!.fetchQuery('GetProduct', { id: `p-${n}` })
      }
      return {}
    }),
  },
  {
    label: 'Queue 200 stock counts',
    run: () => measure('Queue 200 stock counts', async () => {
      await airplane!.fetchQuery('GetSiteItems', { siteId: 'site-1', first: 200 })
      const items = await airplane!.db.SiteItem.where('siteId').equals('site-1').limit(200).toArray()
      const started = performance.now()
      for (const [i, item] of items.entries()) await setOnHand.mutate({ siteId: 'site-1', variantId: item.variantId, onHand: 50 + (i % 40) })
      const queueMs = Math.round(performance.now() - started)
      await drained()
      return { queued: items.length, queueMs }
    }),
  },
  {
    label: 'Tap quantities 500 times across 50 cart lines',
    run: () => measure('Tap quantities 500 times across 50 cart lines', async () => {
      await airplane!.fetchQuery('GetProducts', { first: 200, inStockOnly: true })
      const inCart = new Set((await airplane!.db.CartLine.toArray()).map(l => l.variantId))
      const variants = (await airplane!.db.Variant.filter(v => v.stock >= 12 && !inCart.has(v.id)).limit(50).toArray())
      const started = performance.now()
      for (const v of variants) await addLine.mutate({ variantId: v.id, quantity: 1 })
      const lines = await airplane!.db.CartLine.toArray()
      for (let n = 0; n < 500 - variants.length; n++) {
        const line = lines[n % lines.length]!
        await setQuantity.mutate({ lineId: line.id, quantity: 1 + (n % 10) })
      }
      const queueMs = Math.round(performance.now() - started)
      await drained()
      return { queued: 500, queueMs }
    }),
  },
]

const headers = [
  { title: 'Run', key: 'label' },
  { title: 'Queued', key: 'queued', align: 'end' as const },
  { title: 'Queueing', key: 'queueMs', align: 'end' as const },
  { title: 'Total', key: 'totalMs', align: 'end' as const },
  { title: 'Long tasks', key: 'longTasks', align: 'end' as const },
  { title: 'Longest', key: 'longestTask', align: 'end' as const },
]
</script>

<template>
  <v-card
    title="Load"
    subtitle="Generators, timed until the work is done"
  >
    <v-card-text class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="g in generators"
        :key="g.label"
        :loading="busy === g.label"
        :disabled="!!busy && busy !== g.label"
        variant="tonal"
        color="primary"
        @click="g.run"
      >
        {{ g.label }}
      </v-btn>
      <span
        v-if="progress"
        class="align-self-center text-body-small"
      >{{ progress }}</span>
    </v-card-text>
    <v-data-table
      v-if="runs.length"
      :headers="headers"
      :items="runs"
      density="compact"
      hide-default-footer
    >
      <template #[`item.queueMs`]="{ value }">
        {{ value == null ? '' : `${value} ms` }}
      </template>
      <template #[`item.totalMs`]="{ value }">
        {{ value }} ms
      </template>
      <template #[`item.longestTask`]="{ value }">
        {{ value }} ms
      </template>
    </v-data-table>
  </v-card>
</template>
