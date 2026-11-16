<script setup lang="ts">
import { mdiBellOutline, mdiCartPlus } from '@mdi/js'

// Puts a quantity of one variant in the cart, or asks to be told when an
// out-of-stock one is back. Both work offline: they are queued.
const props = defineProps<{ variant: { id: string, stock: number } }>()

const { add, lines } = useCart()
const backInStock = useBackInStock()
const quantity = ref(1)
watch(() => props.variant.id, () => (quantity.value = 1))

const inCart = computed(() => lines.value.find(l => l.variantId === props.variant.id)?.quantity ?? 0)
const asked = ref(false)

function addToCart() {
  void add(props.variant.id, quantity.value)
}
function notify() {
  void backInStock.mutate({ variantId: props.variant.id })
  asked.value = true
}
</script>

<template>
  <div
    v-if="variant.stock > 0"
    class="d-flex align-center flex-wrap ga-3"
  >
    <v-number-input
      v-model="quantity"
      :min="1"
      :max="variant.stock"
      label="Quantity"
      density="compact"
      control-variant="split"
      max-width="160"
      hide-details
    />
    <v-btn
      :prepend-icon="mdiCartPlus"
      color="primary"
      size="large"
      @click="addToCart"
    >
      Add to cart
    </v-btn>
    <span
      v-if="inCart"
      class="text-body-small text-medium-emphasis"
    >{{ inCart }} in your cart</span>
  </div>
  <div
    v-else
    class="d-flex align-center flex-wrap ga-3"
  >
    <v-btn
      :prepend-icon="mdiBellOutline"
      :disabled="asked"
      variant="tonal"
      @click="notify"
    >
      {{ asked ? 'We will tell you' : 'Tell me when it is back' }}
    </v-btn>
  </div>
</template>
