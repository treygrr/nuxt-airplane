<script setup lang="ts">
// Writes a review, or edits one: stars, a title, a few words.
const props = defineProps<{ initial?: { rating: number, title: string, body: string } }>()
const emit = defineEmits<{ submit: [review: { rating: number, title: string, body: string }], cancel: [] }>()

const rating = ref(props.initial?.rating ?? 0)
const title = ref(props.initial?.title ?? '')
const body = ref(props.initial?.body ?? '')
const valid = computed(() => rating.value >= 1 && title.value.trim().length > 0)

function submit() {
  if (!valid.value) return
  emit('submit', { rating: rating.value, title: title.value.trim(), body: body.value.trim() })
  if (!props.initial) {
    rating.value = 0
    title.value = ''
    body.value = ''
  }
}
</script>

<template>
  <v-card
    variant="outlined"
    :title="initial ? 'Edit your review' : 'Write a review'"
  >
    <v-card-text>
      <v-rating
        v-model="rating"
        color="amber-darken-2"
        hover
        class="mb-2"
      />
      <v-text-field
        v-model="title"
        label="Title"
        density="compact"
      />
      <v-textarea
        v-model="body"
        label="What did you think?"
        rows="3"
        auto-grow
        hide-details
      />
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        v-if="initial"
        @click="$emit('cancel')"
      >
        Cancel
      </v-btn>
      <v-btn
        color="primary"
        :disabled="!valid"
        @click="submit"
      >
        {{ initial ? 'Save' : 'Post review' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>
