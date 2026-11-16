<script setup lang="ts">
import { mdiCartPlus } from '@mdi/js'

// A quantity joined to the cart button that adds it, read as one control,
// with what the cart holds already beside the icon. The quantity field goes
// in the default slot. With nothing to add, the button is read-only rather
// than disabled, so the count stays readable.
defineProps<{ canAdd: boolean, inCart?: number, label: string }>()
defineEmits<{ add: [] }>()
</script>

<template>
  <div class="cart-quantity-group d-flex">
    <slot />
    <v-btn
      :readonly="!canAdd"
      :aria-disabled="!canAdd"
      :aria-label="label"
      :variant="canAdd ? 'flat' : 'tonal'"
      color="primary"
      height="40"
      min-width="56"
      rounded="0"
      class="cart-quantity-group__cart px-3"
      @click="canAdd && $emit('add')"
    >
      <v-icon :icon="mdiCartPlus" />
      <span
        v-if="inCart"
        class="ms-1"
        data-test="in-cart"
      >{{ inCart }}</span>
    </v-btn>
  </div>
</template>

<style scoped>
/* The field and the button read as one control: square where they meet. */
.cart-quantity-group > :deep(:first-child) {
  flex: 1 1 auto;
  min-width: 0;
}
.cart-quantity-group :deep(.v-field) {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}
.cart-quantity-group__cart {
  border-start-end-radius: 4px !important;
  border-end-end-radius: 4px !important;
}
</style>
