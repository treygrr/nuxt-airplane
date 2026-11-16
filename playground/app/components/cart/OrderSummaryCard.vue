<script setup lang="ts">
import { mdiInformationOutline } from '@mdi/js'

// What the cart comes to. The totals are the server's: tax, shipping and
// coupons are worked out there. While a change to the cart is waiting, the
// totals shown are from before it, and the card says so.
defineProps<{ action?: { title: string, to?: string, disabled?: boolean } }>()

const { summary, lines, summaryFetching } = useCart()
const { online } = useSync()
const pending = usePendingRows('CartLine')
const stale = computed(() => lines.value.some(l => pending.value.has(l.id)))
</script>

<template>
  <v-card
    border
    flat
    class="pa-6"
  >
    <div class="d-flex align-center mb-4">
      <h2 class="text-title-large font-weight-bold me-auto">
        Order summary
      </h2>
      <v-progress-circular
        v-if="summaryFetching"
        size="18"
        width="2"
        indeterminate
      />
    </div>
    <TotalsTable
      v-if="summary"
      :totals="summary"
    />
    <v-skeleton-loader
      v-else
      type="list-item@4"
    />
    <v-alert
      v-if="stale"
      :icon="mdiInformationOutline"
      density="compact"
      variant="tonal"
      type="info"
      class="mt-4 text-body-small"
    >
      {{ online ? 'Totals update once your changes reach the store.' : 'You are offline: totals update when your changes sync.' }}
    </v-alert>
    <slot />
    <v-btn
      v-if="action"
      :to="action.to"
      :disabled="action.disabled"
      color="primary"
      size="large"
      block
      class="mt-6"
    >
      {{ action.title }}
    </v-btn>
  </v-card>
</template>
