<script setup lang="ts">
import { mdiDeleteOutline } from '@mdi/js'

// One line of the cart: what it is, how many, what they cost. Each step of
// the quantity queues a change; the steps of one line fold into one.
const props = defineProps<{ line: NuxtAirplaneStores['CartLine'], pending?: boolean, busy?: boolean }>()
const emit = defineEmits<{ quantity: [quantity: number], remove: [] }>()

function setQuantity(quantity: number) {
  if (quantity >= 1 && quantity !== props.line.quantity) emit('quantity', quantity)
}
</script>

<template>
  <div class="d-flex ga-4 py-4">
    <NuxtLink :to="`/p/${line.productId}`">
      <v-img
        :src="line.imageUrl"
        :alt="line.productName"
        width="96"
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
            :to="`/p/${line.productId}`"
            class="text-body-large font-weight-medium text-high-emphasis text-decoration-none"
          >
            {{ line.productName }}
          </NuxtLink>
          <div class="text-body-small text-medium-emphasis d-flex align-center ga-2">
            {{ line.variantName }} · {{ formatMoney(line.unitPrice) }} each
            <PendingChip v-if="pending" />
          </div>
        </div>
        <span class="text-title-medium font-weight-bold">{{ formatMoney(line.unitPrice * line.quantity) }}</span>
      </div>
      <div class="d-flex align-center ga-2 mt-3">
        <v-number-input
          :model-value="line.quantity"
          :min="1"
          density="compact"
          control-variant="split"
          max-width="150"
          hide-details
          @update:model-value="setQuantity"
        />
        <v-btn
          :prepend-icon="mdiDeleteOutline"
          variant="text"
          size="small"
          :loading="busy"
          :disabled="busy"
          @click="emit('remove')"
        >
          Remove
        </v-btn>
      </div>
    </div>
  </div>
</template>
