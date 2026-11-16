<script setup lang="ts">
import { mdiCartArrowRight, mdiClose } from '@mdi/js'

// One saved product: its picture, price, a note, and moving it to the cart.
// The note is saved as it is typed; the versions of one note fold into one.
const props = defineProps<{ item: NuxtAirplaneStores['WishlistItem'], pending?: boolean }>()
const emit = defineEmits<{ note: [note: string], move: [], remove: [] }>()

const note = ref(props.item.note)
watch(() => props.item.note, n => (note.value = n))
let timer: ReturnType<typeof setTimeout> | undefined
function typed(value: string) {
  note.value = value
  clearTimeout(timer)
  timer = setTimeout(() => value !== props.item.note && emit('note', value), 400)
}
</script>

<template>
  <div class="d-flex ga-4 py-4">
    <NuxtLink :to="`/p/${item.productId}`">
      <v-img
        :src="item.imageUrl"
        :alt="item.productName"
        width="88"
        :aspect-ratio="1"
        rounded="lg"
        class="border flex-grow-0"
        cover
      />
    </NuxtLink>
    <div class="flex-grow-1">
      <div class="d-flex align-start ga-2">
        <div class="me-auto">
          <NuxtLink
            :to="`/p/${item.productId}`"
            class="text-body-large font-weight-medium text-high-emphasis text-decoration-none"
          >
            {{ item.productName }}
          </NuxtLink>
          <div class="d-flex align-center ga-2 text-body-small text-medium-emphasis">
            {{ formatMoney(item.price) }} · saved {{ formatDate(item.addedAt) }}
            <PendingChip v-if="pending" />
          </div>
        </div>
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          aria-label="Remove from the list"
          @click="emit('remove')"
        />
      </div>
      <div class="d-flex align-center ga-2 mt-2">
        <v-text-field
          :model-value="note"
          placeholder="Add a note"
          density="compact"
          hide-details
          @update:model-value="typed"
        />
        <v-btn
          :prepend-icon="mdiCartArrowRight"
          color="primary"
          variant="tonal"
          height="40"
          @click="emit('move')"
        >
          Move to cart
        </v-btn>
      </div>
    </div>
  </div>
</template>
