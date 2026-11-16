<script setup lang="ts">
// Starting over, on either side. The server's catalog can be reseeded at the
// everyday size or the stress size (tens of thousands of products).
const airplane = useAirplane()
const { reset } = useLab()
const busy = ref<string | null>(null)
const last = ref<string | null>(null)

async function run(label: string, fn: () => Promise<unknown>) {
  busy.value = label
  const started = performance.now()
  try {
    const result = await fn()
    last.value = `${label}: ${Math.round(performance.now() - started)} ms${typeof result === 'number' ? `, ${result} rows dropped` : ''}`
  }
  finally {
    busy.value = null
  }
}

const actions = [
  { label: 'Reseed the server', color: 'primary', run: () => reset({ products: 2000 }) },
  { label: 'Reseed with the stress catalog', color: 'warning', run: () => reset({ stress: true }) },
  { label: 'Evict old rows', color: undefined, run: () => airplane!.evict() },
  { label: 'Clear the cache (keep the queue)', color: undefined, run: () => airplane!.clearCache() },
  { label: 'Clear everything here', color: 'error', run: () => airplane!.clear() },
]
</script>

<template>
  <v-card
    title="Start over"
    subtitle="Server data, and what this browser keeps"
  >
    <v-card-text class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="action in actions"
        :key="action.label"
        :color="action.color"
        :loading="busy === action.label"
        :disabled="!!busy && busy !== action.label"
        variant="tonal"
        @click="run(action.label, action.run)"
      >
        {{ action.label }}
      </v-btn>
    </v-card-text>
    <v-card-text
      v-if="last"
      class="pt-0 text-body-small text-medium-emphasis"
    >
      {{ last }}
    </v-card-text>
  </v-card>
</template>
