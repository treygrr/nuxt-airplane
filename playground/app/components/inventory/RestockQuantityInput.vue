<script setup lang="ts">
// A restock quantity: steps a box at a time and starts at the minimum order.
// A typed number that may be ordered is sent as it is; any other is rounded
// up to one that may, once the field is left, so typing is not cut short.
import { fitRestock, type OrderRules } from '~/lib/restock'

const props = defineProps<{ modelValue: number, rules: OrderRules }>()
const emit = defineEmits<{ 'update:modelValue': [quantity: number] }>()

const value = ref<number | null>(props.modelValue)
watch(() => props.modelValue, (v) => {
  value.value = v
})

function send(quantity: number) {
  value.value = quantity
  if (quantity !== props.modelValue) emit('update:modelValue', quantity)
}

function input(v: number | null) {
  value.value = v
  if (v != null && fitRestock(props.rules, v) === v) send(v)
}

const settle = () => send(fitRestock(props.rules, value.value ?? 0))
</script>

<template>
  <v-number-input
    :model-value="value"
    :min="fitRestock(rules, 1)"
    :step="rules.boxQuantity ?? 1"
    density="compact"
    control-variant="split"
    hide-details
    @update:model-value="input"
    @blur="settle"
    @keydown.enter="settle"
  />
</template>
