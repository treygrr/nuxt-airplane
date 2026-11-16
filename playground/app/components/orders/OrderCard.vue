<script setup lang="ts">
// An order in the history: number, date, status, what is in it, the total.
const props = defineProps<{ order: NuxtAirplaneStores['Order'], pending?: boolean }>()
const items = computed(() => props.order.lines.reduce((n, l) => n + l.quantity, 0))
const status = computed(() => ORDER_STATUS[props.order.status])
</script>

<template>
  <v-card
    :to="`/orders/${order.id}`"
    border
    flat
    hover
    class="lift pa-5"
  >
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <span class="text-title-medium font-weight-bold">Order {{ order.number }}</span>
      <v-chip
        :color="status.color"
        size="small"
        variant="tonal"
      >
        {{ status.label }}
      </v-chip>
      <PendingChip v-if="pending" />
      <v-spacer />
      <span class="text-title-medium font-weight-bold">{{ formatMoney(order.total) }}</span>
    </div>
    <div class="text-body-small text-medium-emphasis mb-2">
      Placed {{ formatDate(order.placedAt) }} · {{ items }} item{{ items === 1 ? '' : 's' }}
    </div>
    <div class="text-body-medium line-clamp-2">
      {{ order.lines.map(l => l.productName).join(', ') }}
    </div>
  </v-card>
</template>
