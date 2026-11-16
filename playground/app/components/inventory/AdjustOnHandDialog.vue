<script setup lang="ts">
// Sets what a site holds of an item after a count: the new total, or a
// change up or down from what it holds now.
const props = defineProps<{ item: { siteId: string, variantId: string, productName: string, variantName: string, onHand: number } | null }>()
const emit = defineEmits<{ close: [] }>()

const onHand = ref(0)
watch(() => props.item, (item) => {
  if (item) onHand.value = item.onHand
}, { immediate: true })
const change = computed(() => onHand.value - (props.item?.onHand ?? 0))

const { setOnHand } = useInventory()
function save() {
  if (!props.item || onHand.value < 0) return
  if (change.value) setOnHand.mutate({ siteId: props.item.siteId, variantId: props.item.variantId, onHand: onHand.value })
  emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="!!item"
    max-width="400"
    @update:model-value="!$event && emit('close')"
  >
    <v-card
      v-if="item"
      title="Adjust on hand"
      :subtitle="`${item.productName} · ${item.variantName}`"
    >
      <v-card-text>
        <v-number-input
          v-model="onHand"
          label="On hand"
          :min="0"
          control-variant="split"
          autofocus
          :hint="change ? `${change > 0 ? '+' : ''}${change} from ${item.onHand}` : `Holds ${item.onHand} now`"
          persistent-hint
          @keydown.enter="save"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('close')">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
