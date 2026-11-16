<script setup lang="ts">
import { mdiPackageVariantClosed, mdiArrowCollapseUp } from '@mdi/js'

// How a variant must be ordered, when it has rules: in boxes, a minimum.
defineProps<{ boxQuantity?: number | null, minOrderQuantity?: number | null }>()
</script>

<template>
  <v-chip
    v-if="boxQuantity"
    :prepend-icon="mdiPackageVariantClosed"
    size="x-small"
    variant="tonal"
  >
    Box of {{ boxQuantity }}
  </v-chip>
  <v-chip
    v-if="minOrderQuantity"
    :prepend-icon="mdiArrowCollapseUp"
    size="x-small"
    variant="tonal"
  >
    Min order {{ minOrderQuantity }}
  </v-chip>
</template>
