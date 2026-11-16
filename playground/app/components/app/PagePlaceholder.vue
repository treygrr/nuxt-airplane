<script setup lang="ts">
// Stands in for a page whose part of the shop is not built yet.
defineProps<{ title: string, icon: string }>()
</script>

<template>
  <v-empty-state
    :headline="title"
    :icon="icon"
    title="Coming soon"
    text="This part of the shop is built in a later step."
  />
</template>
