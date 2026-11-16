<script setup lang="ts">
// What a product is, in words.
defineProps<{ description: string }>()
</script>

<template>
  <div>
    <h2 class="text-title-large font-weight-bold mb-2">
      About this item
    </h2>
    <p class="text-body-large text-medium-emphasis">
      {{ description }}
    </p>
  </div>
</template>
