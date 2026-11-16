<script setup lang="ts">
// Stars, and how many reviews they come from.
defineProps<{ rating: number, count?: number }>()
</script>

<template>
  <div class="d-flex align-center ga-1">
    <v-rating
      :model-value="rating"
      density="compact"
      size="x-small"
      color="amber-darken-2"
      half-increments
      readonly
    />
    <span
      v-if="count != null"
      class="text-body-small text-medium-emphasis"
    >{{ count ? `(${count})` : 'No reviews' }}</span>
  </div>
</template>
