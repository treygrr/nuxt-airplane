<script setup lang="ts">
// Numbered pager: 1 … 4 [5] 6 … 12, with a window around the current page.
const props = defineProps<{ page: number, totalPages: number }>()
const emit = defineEmits<{ go: [page: number] }>()

const pages = computed(() => {
  const around = 2
  const wanted = new Set([1, props.totalPages])
  for (let p = props.page - around; p <= props.page + around; p++) {
    if (p >= 1 && p <= props.totalPages) wanted.add(p)
  }
  const sorted = [...wanted].sort((a, b) => a - b)
  // Insert a gap marker wherever the sequence jumps.
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? ['…', p] : [p]))
})
</script>

<template>
  <nav class="pager">
    <button
      :disabled="page <= 1"
      @click="emit('go', page - 1)"
    >
      ‹ Prev
    </button>
    <template
      v-for="(p, i) in pages"
      :key="i"
    >
      <span
        v-if="typeof p === 'string'"
        class="gap"
      >…</span>
      <button
        v-else
        :class="{ current: p === page }"
        :disabled="p === page"
        @click="emit('go', p)"
      >
        {{ p }}
      </button>
    </template>
    <button
      :disabled="page >= totalPages"
      @click="emit('go', page + 1)"
    >
      Next ›
    </button>
  </nav>
</template>

<style scoped>
.pager { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
.pager button.current { font-weight: bold; background: #222; color: #fff; border-color: #222; }
.gap { padding: 0 4px; color: #777; }
</style>
