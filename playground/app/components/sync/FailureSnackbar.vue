<script setup lang="ts">
// Says so where the shopper is looking when a change is refused by the
// server, with a way to the queue to retry or undo it.
const failed = useFailedMutations()
const drawer = useQueueDrawer()
const shown = ref(false)
const latest = ref<{ description: string, error?: string } | null>(null)

// Only a failure that is new since the last look: not every one, on every load.
const seen = new Set<number>()
onMounted(() => failed.value.forEach(m => seen.add(m.id)))
watch(failed, (rows) => {
  const fresh = rows.find(m => !seen.has(m.id))
  rows.forEach(m => seen.add(m.id))
  if (!fresh) return
  latest.value = fresh
  shown.value = true
})

// Opened once this click is over: during it, the click would count as one
// outside the drawer and close it again.
function review() {
  shown.value = false
  setTimeout(() => (drawer.value = true))
}
</script>

<template>
  <v-snackbar
    v-model="shown"
    color="error"
    timeout="12000"
    location="bottom end"
  >
    <div class="font-weight-medium">
      Not saved: {{ latest?.description }}
    </div>
    <div
      v-if="latest?.error"
      class="text-body-small opacity-90"
    >
      {{ latest.error }}
    </div>
    <template #actions>
      <v-btn
        variant="text"
        @click="review"
      >
        Review
      </v-btn>
    </template>
  </v-snackbar>
</template>
