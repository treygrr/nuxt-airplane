<script setup lang="ts">
// A restock quantity: steps a box at a time and starts at the minimum order.
// A typed number that may be ordered is sent as it is; any other is rounded
// up to one that may, once the field is left, so typing is not cut short.
// With `optional`, 0 stands for "nothing to order" and is kept as it is.
import { fitRestock, type OrderRules } from '~/lib/restock'

const props = defineProps<{ modelValue: number, rules: OrderRules, optional?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [quantity: number] }>()

const value = ref<number | null>(props.modelValue)
watch(() => props.modelValue, (v) => {
  value.value = v
})

const fit = (v: number) => (props.optional && v <= 0 ? 0 : fitRestock(props.rules, v))

function send(quantity: number) {
  value.value = quantity
  if (quantity !== props.modelValue) emit('update:modelValue', quantity)
}

function input(v: number | null) {
  value.value = v
  if (v != null && fit(v) === v) send(v)
}

const settle = () => send(fit(value.value ?? 0))
</script>

<template>
  <v-number-input
    :model-value="value"
    :min="optional ? 0 : fitRestock(rules, 1)"
    :step="rules.boxQuantity ?? 1"
    density="compact"
    control-variant="split"
    hide-details
    @update:model-value="input"
    @blur="settle"
    @keydown.enter="settle"
  />
</template>
