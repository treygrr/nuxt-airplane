<script setup lang="ts">
import { mdiPackageVariantClosed } from '@mdi/js'

// Order history, newest first. An order's status moves on by itself on the
// server, so the list asks again every so often while it is open.
useHead({ title: 'Orders · Toolshed' })
const { orders, loading, refresh } = useOrders()
const pending = usePendingRows('Order')

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(refresh, 15_000)))
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div>
    <h1 class="text-headline-medium font-weight-bold mb-6">
      Your orders
    </h1>
    <v-skeleton-loader
      v-if="loading && !orders.length"
      type="card@3"
    />
    <v-empty-state
      v-else-if="!orders.length"
      :icon="mdiPackageVariantClosed"
      title="No orders yet"
      text="Orders you place show up here."
      action-text="Start shopping"
      to="/"
    />
    <div
      v-else
      class="d-flex flex-column ga-3"
    >
      <OrderCard
        v-for="order in orders"
        :key="order.id"
        :order="order"
        :pending="pending.has(order.id)"
      />
    </div>
  </div>
</template>
