<script setup>
defineProps({ active: Boolean, label: String, view: String })
const emit = defineEmits(['select'])
</script>

<template>
  <button class="nav-item" :class="{ active }" @click="emit('select', view)">{{ label }}</button>
</template>
