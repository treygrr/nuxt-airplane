<script setup lang="ts">
// Search results. The words are in the address (`?q=`), so a search can be
// shared or reloaded; offline it is answered from the tables.
const route = useRoute()
const query = computed(() => String(route.query.q ?? ''))
useHead({ title: () => (query.value ? `“${query.value}” · Toolshed` : 'Search · Toolshed') })
</script>

<template>
  <div>
    <h1 class="text-headline-medium mb-4">
      {{ query ? `Results for “${query}”` : 'Search' }}
    </h1>
    <SearchBox
      v-if="!query"
      class="mb-4"
    />
    <ProductListing :search="query || null" />
  </div>
</template>
