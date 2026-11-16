<script setup lang="ts">
// "Keep the catalog offline": after the first page of products, fetch the
// rest in the background so the whole catalog can be browsed offline.
const enabled = useOfflineCatalog()
</script>

<template>
  <v-switch
    v-model="enabled"
    label="Keep the catalog offline"
    color="primary"
    density="compact"
    hide-details
    inset
  />
</template>
