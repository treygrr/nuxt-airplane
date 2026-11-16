<script setup lang="ts">
import { mdiArrowRight } from '@mdi/js'

// A section's title, with a link to see more.
defineProps<{ title: string, subtitle?: string, to?: string, linkText?: string }>()
</script>

<template>
  <div class="d-flex align-end justify-space-between flex-wrap ga-2 mb-4">
    <div>
      <h2 class="text-headline-small font-weight-bold mb-1">
        {{ title }}
      </h2>
      <div
        v-if="subtitle"
        class="text-body-medium text-medium-emphasis"
      >
        {{ subtitle }}
      </div>
    </div>
    <v-btn
      v-if="to"
      :to="to"
      :append-icon="mdiArrowRight"
      variant="text"
      color="primary"
    >
      {{ linkText ?? 'See all' }}
    </v-btn>
  </div>
</template>
