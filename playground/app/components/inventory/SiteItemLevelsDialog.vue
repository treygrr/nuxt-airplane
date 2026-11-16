<script setup lang="ts">
// Changes the levels an item is kept between.
const props = defineProps<{ item: { siteId: string, variantId: string, productName: string, variantName: string, min: number, max: number } | null }>()
const emit = defineEmits<{ close: [] }>()

const min = ref(0)
const max = ref(0)
watch(() => props.item, (item) => {
  if (!item) return
  min.value = item.min
  max.value = item.max
}, { immediate: true })

const { setLevels } = useInventory()
function save() {
  if (!props.item || min.value > max.value) return
  setLevels.mutate({ siteId: props.item.siteId, variantId: props.item.variantId, min: min.value, max: max.value })
  emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="!!item"
    max-width="440"
    @update:model-value="!$event && emit('close')"
  >
    <v-card
      v-if="item"
      title="Inventory levels"
      :subtitle="`${item.productName} · ${item.variantName}`"
    >
      <v-card-text>
        <LevelFields
          v-model:min="min"
          v-model:max="max"
          tracking
          hide-on-hand
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('close')">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="min > max"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
