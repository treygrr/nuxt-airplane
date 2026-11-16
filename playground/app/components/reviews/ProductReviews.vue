<script setup lang="ts">
import { mdiPencilOutline } from '@mdi/js'

// A product's reviews: the summary, the customer's own review form, and the
// list, newest first. Reviews and edits made offline show at once and sync later.
const props = defineProps<{ productId: string }>()

const { reviews, loading, create, update, remove } = useReviews(() => props.productId)
const pending = usePendingRows('Review')
const writing = ref(false)
const editing = ref<string | null>(null)
const editingReview = computed(() => reviews.value.find(r => r.id === editing.value))

function post(review: { rating: number, title: string, body: string }) {
  void create.mutate({ productId: props.productId, ...review })
  writing.value = false
}
function save(review: { rating: number, title: string, body: string }) {
  if (editing.value) void update.mutate({ id: editing.value, ...review })
  editing.value = null
}
</script>

<template>
  <section>
    <h2 class="text-headline-small font-weight-bold mb-6">
      Reviews
    </h2>
    <v-row>
      <v-col
        cols="12"
        md="4"
      >
        <ReviewSummary
          :reviews="reviews"
          class="mb-6"
        />
        <v-btn
          v-if="!writing"
          :prepend-icon="mdiPencilOutline"
          variant="outlined"
          block
          @click="writing = true"
        >
          Write a review
        </v-btn>
      </v-col>
      <v-col
        cols="12"
        md="8"
      >
        <ReviewForm
          v-if="writing"
          class="mb-4"
          @submit="post"
          @cancel="writing = false"
        />
        <ReviewForm
          v-if="editingReview"
          :key="editingReview.id"
          :initial="editingReview"
          class="mb-4"
          @submit="save"
          @cancel="editing = null"
        />
        <v-skeleton-loader
          v-if="loading && !reviews.length"
          type="list-item-three-line@2"
        />
        <p
          v-else-if="!reviews.length"
          class="text-body-medium text-medium-emphasis"
        >
          No reviews yet. Be the first.
        </p>
        <template v-else>
          <ReviewItem
            v-for="review in reviews"
            :key="review.id"
            :review="review"
            :pending="pending.has(review.id)"
            :busy="remove.loading.value"
            class="mb-3"
            @edit="editing = review.id"
            @delete="remove.mutate({ id: review.id })"
          />
        </template>
      </v-col>
    </v-row>
  </section>
</template>
