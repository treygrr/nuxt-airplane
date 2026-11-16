<script setup lang="ts">
import { mdiArrowLeft, mdiCartArrowDown, mdiCheckCircleOutline } from '@mdi/js'

// One order: where it is, what is in it, what it came to. It can be
// cancelled until it ships, and ordered again: every line goes back in the
// cart, each as its own change, so a long order is a burst of them.
const route = useRoute()
const id = computed(() => String(route.params.id))
const { order, loading, refresh } = useOrder(id)
const cancel = useCancelOrder()
const { add } = useCart()
useHead({ title: () => `Order ${order.value?.number ?? ''} · Toolshed` })

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(refresh, 10_000)))
onBeforeUnmount(() => clearInterval(timer))

const confirmCancel = ref(false)
const reordered = ref(false)
async function reorder() {
  for (const line of order.value?.lines ?? []) await add(line.variantId, line.quantity)
  reordered.value = true
}
</script>

<template>
  <div>
    <v-btn
      :prepend-icon="mdiArrowLeft"
      to="/orders"
      variant="text"
      class="mb-2"
    >
      Orders
    </v-btn>
    <v-alert
      v-if="route.query.placed"
      :icon="mdiCheckCircleOutline"
      type="success"
      variant="tonal"
      class="mb-6"
      title="Thank you, your order is in"
      text="We will pack it shortly. Its status updates on this page."
    />
    <v-skeleton-loader
      v-if="loading && !order"
      type="article"
    />
    <v-empty-state
      v-else-if="!order"
      title="Order not found"
      text="It has not been loaded on this device."
    />
    <template v-else>
      <div class="d-flex align-center flex-wrap ga-3 mb-6">
        <h1 class="text-headline-medium font-weight-bold me-auto">
          Order {{ order.number }}
        </h1>
        <v-btn
          :prepend-icon="mdiCartArrowDown"
          variant="tonal"
          @click="reorder"
        >
          {{ reordered ? 'Added to your cart' : 'Order again' }}
        </v-btn>
        <v-btn
          v-if="cancellable(order.status)"
          color="error"
          variant="text"
          @click="confirmCancel = true"
        >
          Cancel order
        </v-btn>
      </div>
      <OrderStatusSteps
        :status="order.status"
        class="mb-8"
      />
      <v-row>
        <v-col
          cols="12"
          md="8"
        >
          <v-card
            border
            flat
          >
            <v-list>
              <v-list-item
                v-for="line in order.lines"
                :key="line.id"
                :to="`/p/${line.productId}`"
                :title="line.productName"
                :subtitle="`${line.variantName} · ${line.quantity} × ${formatMoney(line.unitPrice)}`"
              >
                <template #append>
                  <span class="font-weight-medium">{{ formatMoney(line.unitPrice * line.quantity) }}</span>
                </template>
              </v-list-item>
            </v-list>
          </v-card>
        </v-col>
        <v-col
          cols="12"
          md="4"
        >
          <v-card
            border
            flat
            class="pa-6"
          >
            <div class="text-body-small text-medium-emphasis">
              Placed {{ formatDate(order.placedAt) }}
            </div>
            <div class="text-body-medium mb-1">
              Ships to {{ order.shipTo }}
            </div>
            <div
              v-if="order.note"
              class="text-body-small text-medium-emphasis mb-1"
            >
              Note: {{ order.note }}
            </div>
            <v-divider class="my-4" />
            <TotalsTable :totals="order" />
          </v-card>
        </v-col>
      </v-row>
      <ConfirmDialog
        v-model="confirmCancel"
        title="Cancel this order?"
        action="Cancel order"
        @confirm="cancel.mutate({ id: order.id })"
      >
        Order {{ order.number }} is cancelled and its items go back on the shelves.
      </ConfirmDialog>
    </template>
  </div>
</template>
