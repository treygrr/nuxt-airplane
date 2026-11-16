<script setup lang="ts">
// The average, and how the stars are spread.
const props = defineProps<{ reviews: { rating: number }[] }>()
const average = computed(() => (props.reviews.length ? props.reviews.reduce((n, r) => n + r.rating, 0) / props.reviews.length : 0))
const spread = computed(() => [5, 4, 3, 2, 1].map(stars => ({ stars, count: props.reviews.filter(r => r.rating === stars).length })))
</script>

<template>
  <div>
    <div class="d-flex align-center ga-3 mb-3">
      <span class="text-display-small font-weight-bold">{{ average.toFixed(1) }}</span>
      <div>
        <RatingStars :rating="average" />
        <div class="text-body-small text-medium-emphasis">
          {{ reviews.length }} review{{ reviews.length === 1 ? '' : 's' }}
        </div>
      </div>
    </div>
    <div
      v-for="row in spread"
      :key="row.stars"
      class="d-flex align-center ga-2 text-body-small mb-1"
    >
      <span style="width: 44px">{{ row.stars }} star</span>
      <v-progress-linear
        :model-value="reviews.length ? (100 * row.count) / reviews.length : 0"
        color="amber-darken-2"
        bg-color="surface-light"
        height="8"
        rounded
      />
      <span
        class="text-medium-emphasis text-end"
        style="width: 20px"
      >{{ row.count }}</span>
    </div>
  </div>
</template>
