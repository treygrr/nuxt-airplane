<script setup lang="ts">
// What something comes to: subtotal, discount, shipping, tax, total. The
// cart's summary and a placed order both read this way.
defineProps<{ totals: { subtotal: number, discount: number, shipping: number, tax: number, total: number } }>()
</script>

<template>
  <div class="text-body-medium">
    <div class="d-flex justify-space-between mb-2">
      <span>Subtotal</span><span>{{ formatMoney(totals.subtotal) }}</span>
    </div>
    <div
      v-if="totals.discount"
      class="d-flex justify-space-between mb-2 text-success"
    >
      <span>Discount</span><span>−{{ formatMoney(totals.discount) }}</span>
    </div>
    <div class="d-flex justify-space-between mb-2">
      <span>Shipping</span><span>{{ totals.shipping ? formatMoney(totals.shipping) : 'Free' }}</span>
    </div>
    <div class="d-flex justify-space-between mb-3">
      <span>Tax</span><span>{{ formatMoney(totals.tax) }}</span>
    </div>
    <v-divider class="mb-3" />
    <div class="d-flex justify-space-between text-title-large font-weight-bold">
      <span>Total</span><span>{{ formatMoney(totals.total) }}</span>
    </div>
  </div>
</template>
