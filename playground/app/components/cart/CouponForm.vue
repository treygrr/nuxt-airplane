<script setup lang="ts">
import { mdiClose, mdiTagOutline } from '@mdi/js'

// A coupon code. Applying one works offline: the server checks it when the
// cart syncs, and a code it refuses shows up in the queue with the reason.
const { cart, applyCoupon, removeCoupon } = useCart()
const code = ref('')

function apply() {
  const value = code.value.trim()
  if (!value) return
  void applyCoupon.mutate({ code: value })
  code.value = ''
}
</script>

<template>
  <div>
    <v-chip
      v-if="cart?.coupon"
      :prepend-icon="mdiTagOutline"
      color="success"
      variant="tonal"
      closable
      :close-icon="mdiClose"
      @click:close="removeCoupon.mutate({})"
    >
      {{ cart.coupon.code }}: {{ cart.coupon.description }}
    </v-chip>
    <div
      v-else
      class="d-flex ga-2"
    >
      <v-text-field
        v-model="code"
        :prepend-inner-icon="mdiTagOutline"
        placeholder="Coupon code"
        density="compact"
        hide-details
        @keydown.enter="apply"
      />
      <v-btn
        :disabled="!code.trim()"
        variant="tonal"
        height="40"
        @click="apply"
      >
        Apply
      </v-btn>
    </div>
  </div>
</template>
