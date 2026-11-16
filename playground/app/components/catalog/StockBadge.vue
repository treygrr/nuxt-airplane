<script setup lang="ts">
// How many can be bought, as the sites hold them when last fetched.
defineProps<{ stock: number }>()
</script>

<template>
  <v-chip
    v-if="stock === 0"
    size="x-small"
    color="error"
    variant="tonal"
  >
    Out of stock
  </v-chip>
  <v-chip
    v-else-if="stock < 10"
    size="x-small"
    color="warning"
    variant="tonal"
  >
    {{ stock }} left
  </v-chip>
  <v-chip
    v-else
    size="x-small"
    color="success"
    variant="tonal"
  >
    In stock
  </v-chip>
</template>
