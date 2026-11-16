<script setup lang="ts">
// A product's reviews, newest first, and the form for the customer's own.
// A review written offline shows at once and syncs later; so do edits.
const props = defineProps<{ productId: string }>()

const { reviews, loading, create, update, remove } = useReviews(() => props.productId)
const pending = usePendingRows('Review')
const editing = ref<string | null>(null)
const editingReview = computed(() => reviews.value.find(r => r.id === editing.value))

function post(review: { rating: number, title: string, body: string }) {
  void create.mutate({ productId: props.productId, ...review })
}
function save(review: { rating: number, title: string, body: string }) {
  if (editing.value) void update.mutate({ id: editing.value, ...review })
  editing.value = null
}
</script>

<template>
  <section>
    <h2 class="text-title-large mb-3">
      Reviews
    </h2>
    <ReviewForm
      v-if="editingReview"
      :key="editingReview.id"
      :initial="editingReview"
      class="mb-4"
      @submit="save"
      @cancel="editing = null"
    />
    <ReviewForm
      v-else
      class="mb-4"
      @submit="post"
    />
    <v-skeleton-loader
      v-if="loading && !reviews.length"
      type="list-item-three-line@2"
    />
    <p
      v-else-if="!reviews.length"
      class="text-body-medium text-medium-emphasis"
    >
      No reviews yet.
    </p>
    <v-list v-else>
      <template
        v-for="(review, i) in reviews"
        :key="review.id"
      >
        <v-divider v-if="i" />
        <ReviewItem
          :review="review"
          :pending="pending.has(review.id)"
          @edit="editing = review.id"
          @delete="remove.mutate({ id: review.id })"
        />
      </template>
    </v-list>
  </section>
</template>
