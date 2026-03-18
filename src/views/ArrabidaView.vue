
<script setup>
import ArrabidaModule from '../arrabida/ArrabidaModule.vue'
import '../arrabida/arrabida.css'
import { useRouter } from 'vue-router'

const router = useRouter()
function openLauncher() {
  localStorage.setItem('grooves:last-app', 'arrabida')
  router.push('/launcher')
}
function openBatida() {
  localStorage.setItem('grooves:last-app', 'batida')
  router.push('/analyzer')
}
</script>

<template>
  <div class="arrabida-host-shell">
    <div class="arrabida-host-topbar">
      <button class="host-chip" @click="openLauncher">← Launcher</button>
      <div class="host-title">Arrábida Grooves</div>
      <button class="host-chip primary" @click="openBatida">Abrir Batida do Sado</button>
    </div>
    <ArrabidaModule />
  </div>
</template>

<style scoped>
.arrabida-host-shell { height: 100%; min-height: 0; overflow: hidden; background: #05070c; display:flex; flex-direction:column; }
.arrabida-host-topbar {
  height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  background: linear-gradient(180deg, rgba(4,7,13,.92), rgba(4,7,13,.72)); border-bottom: 1px solid rgba(255,255,255,.06);
}
.host-title { color: #eef4ff; font-weight: 700; letter-spacing: .03em; }
.host-chip { border: 1px solid rgba(255,255,255,.1); color: #eef4ff; background: rgba(255,255,255,.06); border-radius: 999px; padding: .5rem .85rem; }
.host-chip.primary { background: linear-gradient(135deg, #ff8a50, #12d6bb); color: #04111b; font-weight: 700; border: none; }
:deep(.app-shell) { height: calc(100% - 56px); min-height: 0; }
:deep(.content) { overflow: auto; min-height: 0; }
:deep(.sidebar) { overflow: auto; min-height: 0; }
</style>
