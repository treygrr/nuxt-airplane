<script setup lang="ts">
import { mdiMagnify } from '@mdi/js'

// The search box, with name completions from the server while online.
// Enter (or picking a completion) opens the results.
const route = useRoute()
const text = ref(String(route.query.q ?? ''))
watch(() => route.query.q, q => (text.value = String(q ?? '')))
const suggestions = useSearchSuggestions(text)
const menu = ref(false)

function go(value?: string | null) {
  const q = (value ?? text.value).trim()
  menu.value = false
  if (q) void navigateTo({ path: '/search', query: { q } })
}

// The combobox reports what is typed as its value too: only a picked
// completion opens the results; typing waits for Enter.
function picked(value: string | null) {
  if (value && suggestions.value.includes(value)) go(value)
}
</script>

<template>
  <v-combobox
    v-model:search="text"
    v-model:menu="menu"
    :items="suggestions"
    :prepend-inner-icon="mdiMagnify"
    placeholder="Search tools"
    density="compact"
    variant="solo-filled"
    flat
    hide-details
    hide-no-data
    @update:model-value="picked"
    @keydown.enter="go()"
  />
</template>
