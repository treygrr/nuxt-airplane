<script setup lang="ts">
import { mdiCartOutline } from '@mdi/js'

// The cart: its lines, a coupon, and what it all comes to.
useHead({ title: 'Cart · Toolshed' })
const { lines, count, loading, setQuantity, removeLine, clear } = useCart()
const pending = usePendingRows('CartLine')
</script>

<template>
  <div>
    <div class="d-flex align-center mb-6">
      <h1 class="text-headline-medium font-weight-bold me-auto">
        Your cart
        <span
          v-if="count"
          class="text-title-medium text-medium-emphasis"
        >({{ count }} item{{ count === 1 ? '' : 's' }})</span>
      </h1>
      <v-btn
        v-if="lines.length"
        variant="text"
        size="small"
        @click="clear.mutate({})"
      >
        Empty the cart
      </v-btn>
    </div>

    <v-skeleton-loader
      v-if="loading && !lines.length"
      type="list-item-avatar-three-line@3"
    />
    <v-empty-state
      v-else-if="!lines.length"
      :icon="mdiCartOutline"
      title="Your cart is empty"
      text="Find something for the next job."
      action-text="Start shopping"
      to="/"
    />
    <v-row v-else>
      <v-col
        cols="12"
        md="8"
      >
        <v-card
          border
          flat
          class="px-6"
        >
          <template
            v-for="(line, i) in lines"
            :key="line.id"
          >
            <v-divider v-if="i" />
            <CartLineItem
              :line="line"
              :pending="pending.has(line.id)"
              @quantity="setQuantity.mutate({ lineId: line.id, quantity: $event })"
              @remove="removeLine.mutate({ lineId: line.id })"
            />
          </template>
        </v-card>
      </v-col>
      <v-col
        cols="12"
        md="4"
      >
        <OrderSummaryCard :action="{ title: 'Check out', to: '/checkout' }">
          <CouponForm class="mt-6" />
        </OrderSummaryCard>
      </v-col>
    </v-row>
  </div>
</template>
