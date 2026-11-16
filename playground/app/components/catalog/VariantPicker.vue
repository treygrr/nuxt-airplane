<script setup lang="ts">
// Chooses one of a product's variants (a size, a pack, a kit), with each
// one's price and whether it is in stock.
defineProps<{ variants: { id: string, name: string, price: number, stock: number }[] }>()
const selected = defineModel<string | null>({ default: null })
</script>

<template>
  <v-chip-group
    v-model="selected"
    selected-class="text-primary"
    mandatory
    column
  >
    <v-chip
      v-for="variant in variants"
      :key="variant.id"
      :value="variant.id"
      variant="outlined"
      filter
    >
      {{ variant.name }} · {{ formatMoney(variant.price) }}
      <span
        v-if="!variant.stock"
        class="text-error ms-1"
      >(out)</span>
    </v-chip>
  </v-chip-group>
</template>
