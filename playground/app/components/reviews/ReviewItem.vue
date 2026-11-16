<script setup lang="ts">
import { mdiDeleteOutline, mdiPencilOutline } from '@mdi/js'

// One review. The customer's own can be edited and deleted.
defineProps<{
  review: { id: string, authorName: string, rating: number, title: string, body: string, createdAt: string, mine: boolean }
  pending?: boolean
}>()
defineEmits<{ edit: [], delete: [] }>()
</script>

<template>
  <v-list-item class="px-0">
    <div class="d-flex align-center ga-2">
      <RatingStars :rating="review.rating" />
      <span class="text-title-small">{{ review.title }}</span>
      <PendingChip v-if="pending" />
    </div>
    <div class="text-body-medium my-1">
      {{ review.body }}
    </div>
    <div class="text-body-small text-medium-emphasis">
      {{ review.authorName }}, {{ formatDate(review.createdAt) }}
    </div>
    <template
      v-if="review.mine"
      #append
    >
      <v-btn
        :icon="mdiPencilOutline"
        variant="text"
        size="small"
        aria-label="Edit"
        @click="$emit('edit')"
      />
      <v-btn
        :icon="mdiDeleteOutline"
        variant="text"
        size="small"
        aria-label="Delete"
        @click="$emit('delete')"
      />
    </template>
  </v-list-item>
</template>
