<script setup lang="ts">
import { mdiDeleteOutline, mdiPencilOutline } from '@mdi/js'

// One review. The customer's own can be edited and deleted.
defineProps<{
  review: { id: string, authorName: string, rating: number, title: string, body: string, createdAt: string, mine: boolean }
  pending?: boolean
  busy?: boolean
}>()
defineEmits<{ edit: [], delete: [] }>()
</script>

<template>
  <v-card
    border
    flat
    class="pa-5"
  >
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <RatingStars :rating="review.rating" />
      <span class="text-title-small font-weight-bold">{{ review.title }}</span>
      <PendingChip v-if="pending" />
      <v-spacer />
      <template v-if="review.mine">
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
          :loading="busy"
          :disabled="busy"
          @click="$emit('delete')"
        />
      </template>
    </div>
    <p class="text-body-medium mb-3">
      {{ review.body }}
    </p>
    <div class="text-body-small text-medium-emphasis">
      {{ review.authorName }}<template v-if="review.mine">
        (you)
      </template> · {{ formatDate(review.createdAt) }}
    </div>
  </v-card>
</template>
