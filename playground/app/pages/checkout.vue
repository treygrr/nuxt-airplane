<script setup lang="ts">
import { mdiCloudOffOutline, mdiPlus } from '@mdi/js'
import type { AddressFields } from '~/composables/useAccount'

// Checkout: where to ship, a note, and placing the order. Placing it is sent
// at once, not queued: the queue drains first, so the server has every change
// to the cart, and an address added offline goes out with its real id.
useHead({ title: 'Checkout · Toolshed' })
const { lines } = useCart()
const { addresses, defaultAddress, create } = useAddresses()
const { online } = useSync()
const place = usePlaceOrder()

const addressId = ref<string | null>(null)
watch(defaultAddress, a => (addressId.value ??= a?.id ?? null), { immediate: true })
const note = ref('')
const formOpen = ref(false)
const placing = ref(false)
const error = ref<string | null>(null)

// A new address shows at once, under a placeholder id: choose it as soon as
// it appears in the list.
let known: Set<string> | null = null
function addAddress(fields: Partial<AddressFields>) {
  known = new Set(addresses.value.map(a => a.id))
  void create.mutate({ input: fields as AddressFields })
}
watch(addresses, (list) => {
  const fresh = known && list.find(a => !known!.has(a.id))
  if (!fresh) return
  addressId.value = fresh.id
  known = null
})

async function placeOrder() {
  if (!addressId.value) return
  placing.value = true
  error.value = null
  try {
    const result = await place.mutate({ addressId: addressId.value, note: note.value.trim() || null })
    await navigateTo({ path: `/orders/${result.placeOrder.id}`, query: { placed: '1' } })
  }
  catch (e) {
    error.value = (e as Error).message
  }
  finally {
    placing.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="text-headline-medium font-weight-bold mb-6">
      Checkout
    </h1>
    <v-empty-state
      v-if="!lines.length"
      title="Nothing to check out"
      text="Your cart is empty."
      action-text="Start shopping"
      to="/"
    />
    <v-row v-else>
      <v-col
        cols="12"
        md="8"
      >
        <div class="d-flex align-center mb-3">
          <h2 class="text-title-large font-weight-bold me-auto">
            Ship to
          </h2>
          <v-btn
            :prepend-icon="mdiPlus"
            variant="text"
            @click="formOpen = true"
          >
            New address
          </v-btn>
        </div>
        <v-row class="mb-6">
          <v-col
            v-for="address in addresses"
            :key="address.id"
            cols="12"
            sm="6"
          >
            <AddressCard
              :address="address"
              :selected="address.id === addressId"
              class="cursor-pointer"
              @click="addressId = address.id"
            />
          </v-col>
        </v-row>
        <h2 class="text-title-large font-weight-bold mb-3">
          Note for the driver
        </h2>
        <v-textarea
          v-model="note"
          placeholder="Leave it by the side gate"
          rows="2"
          auto-grow
          class="mb-6"
        />
        <h2 class="text-title-large font-weight-bold mb-3">
          Items
        </h2>
        <v-card
          border
          flat
        >
          <v-list density="compact">
            <v-list-item
              v-for="line in lines"
              :key="line.id"
              :prepend-avatar="line.imageUrl"
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
        <OrderSummaryCard>
          <v-alert
            v-if="!online"
            :icon="mdiCloudOffOutline"
            type="warning"
            variant="tonal"
            density="compact"
            class="mt-4 text-body-small"
          >
            You are offline. Placing an order needs a connection; your cart is kept until you are back.
          </v-alert>
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-4 text-body-small"
            :text="error"
          />
          <v-btn
            color="primary"
            size="large"
            block
            class="mt-6"
            :loading="placing"
            :disabled="!online || !addressId"
            @click="placeOrder"
          >
            Place order
          </v-btn>
        </OrderSummaryCard>
      </v-col>
    </v-row>
    <AddressForm
      v-model="formOpen"
      @save="addAddress"
    />
  </div>
</template>
