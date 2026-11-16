<script setup lang="ts">
import { mdiCheck, mdiClose, mdiHomeOutline, mdiPackageVariantClosed, mdiReceiptTextOutline, mdiTruckOutline } from '@mdi/js'
import type { OrderStatus } from '~/composables/useOrders'

// Where an order is: placed, packed, shipped, delivered. A cancelled order says so instead.
const props = defineProps<{ status: OrderStatus }>()
const STEPS = [
  { label: 'Placed', icon: mdiReceiptTextOutline },
  { label: 'Packed', icon: mdiPackageVariantClosed },
  { label: 'Shipped', icon: mdiTruckOutline },
  { label: 'Delivered', icon: mdiHomeOutline },
]
const step = computed(() => ORDER_STATUS[props.status].step)
</script>

<template>
  <v-alert
    v-if="status === 'CANCELLED'"
    :icon="mdiClose"
    type="error"
    variant="tonal"
    text="This order was cancelled. Nothing was charged, and its stock went back on the shelves."
  />
  <div
    v-else
    class="d-flex align-start"
  >
    <template
      v-for="(s, i) in STEPS"
      :key="s.label"
    >
      <div
        v-if="i"
        class="flex-grow-1 mt-5 mx-1"
        style="height: 3px; border-radius: 2px"
        :class="i < step ? 'bg-primary' : 'bg-surface-light'"
      />
      <div
        class="d-flex flex-column align-center"
        style="width: 76px"
      >
        <v-avatar
          :color="i < step ? 'primary' : 'surface-light'"
          size="42"
        >
          <v-icon
            :icon="i < step - 1 ? mdiCheck : s.icon"
            size="22"
          />
        </v-avatar>
        <span
          class="text-body-small mt-1"
          :class="i < step ? 'font-weight-bold' : 'text-medium-emphasis'"
        >{{ s.label }}</span>
      </div>
    </template>
  </div>
</template>
