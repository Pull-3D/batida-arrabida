
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const lastSelection = ref('')

onMounted(() => {
  lastSelection.value = localStorage.getItem('grooves:last-app') || ''
})

function openRoute(path: string, key: string) {
  localStorage.setItem('grooves:last-app', key)
  router.push(path)
}
</script>

<template>
  <div class="launcher-shell">
    <div class="launcher-noise"></div>
    <section class="launcher-hero">
      <div class="eyebrow">Lusophone Grooves Suite</div>
      <h1>Escolhe a experiência que queres abrir</h1>
      <p>Uma única app com dois fluxos: Batida do Sado para o teu ecossistema Deezer e Arrábida Grooves para Beatport, Tops e queue premium.</p>
      <div v-if="lastSelection" class="last-session">Última app aberta: <strong>{{ lastSelection === 'arrabida' ? 'Arrábida Grooves' : 'Batida do Sado' }}</strong></div>
    </section>

    <section class="launcher-grid">
      <article class="launcher-card arrabida" @click="openRoute('/arrabida', 'arrabida')">
        <div class="card-badge">Premium DJ downloads</div>
        <h2>Arrábida Grooves</h2>
        <p>Beatport, Tops, Quick Queue, download queue e branding sunset premium.</p>
        <ul>
          <li>Quick Queue em destaque</li>
          <li>Tops scanner para links /track/</li>
          <li>medium-hls, FLAC, tags e cover art</li>
        </ul>
        <button class="launcher-button warm">Abrir Arrábida Grooves</button>
      </article>

      <article class="launcher-card batida" @click="openRoute('/analyzer', 'batida')">
        <div class="card-badge">Library + sync</div>
        <h2>Batida do Sado</h2>
        <p>Deezer, playlists, sync, biblioteca, favoritos e tooling de conversão.</p>
        <ul>
          <li>Link analyzer e favoritos</li>
          <li>Charts, sync e perfis</li>
          <li>Workflow e releases já prontos</li>
        </ul>
        <button class="launcher-button cool">Abrir Batida do Sado</button>
      </article>
    </section>
  </div>
</template>

<style scoped>
.launcher-shell {
  min-height: calc(100vh - 40px);
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(255, 126, 95, 0.20), transparent 32%),
    radial-gradient(circle at top right, rgba(44, 214, 182, 0.18), transparent 26%),
    linear-gradient(180deg, #081018 0%, #05070c 100%);
  color: #eef4ff;
  padding: 3rem;
}
.launcher-noise {
  position: absolute; inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.06) 0.6px, transparent 0.6px);
  background-size: 20px 20px;
  opacity: 0.12;
  pointer-events: none;
}
.launcher-hero, .launcher-grid { position: relative; z-index: 1; }
.launcher-hero { max-width: 860px; margin-bottom: 2rem; }
.eyebrow {
  display: inline-flex; padding: .45rem .85rem; border-radius: 999px;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
  text-transform: uppercase; letter-spacing: .12em; font-size: .72rem; font-weight: 700; margin-bottom: 1rem;
}
.launcher-hero h1 { font-size: clamp(2.2rem, 5vw, 4rem); line-height: 1; font-weight: 800; margin-bottom: 1rem; }
.launcher-hero p { max-width: 760px; font-size: 1.08rem; color: rgba(238,244,255,.72); }
.last-session { margin-top: 1rem; color: rgba(238,244,255,.88); }
.launcher-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; }
.launcher-card {
  cursor: pointer; position: relative; overflow: hidden; padding: 1.75rem; border-radius: 28px;
  border: 1px solid rgba(255,255,255,.08); background: rgba(7, 12, 20, .78);
  box-shadow: 0 24px 80px rgba(0,0,0,.35); backdrop-filter: blur(24px);
  transition: transform .22s ease, border-color .22s ease, box-shadow .22s ease;
}
.launcher-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,.18); }
.launcher-card::before {
  content: ''; position: absolute; inset: auto -10% -45% 10%; height: 60%; border-radius: 50%; filter: blur(40px); opacity: .7;
}
.launcher-card.arrabida::before { background: radial-gradient(circle, rgba(255,132,76,.55), rgba(19,219,193,.15)); }
.launcher-card.batida::before { background: radial-gradient(circle, rgba(96,116,255,.4), rgba(90,184,255,.12)); }
.card-badge {
  display: inline-flex; font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  padding: .35rem .7rem; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
  margin-bottom: 1rem;
}
.launcher-card h2 { font-size: 1.9rem; font-weight: 800; margin-bottom: .75rem; }
.launcher-card p { color: rgba(238,244,255,.72); line-height: 1.55; margin-bottom: 1rem; }
.launcher-card ul { margin: 0 0 1.25rem 1rem; color: rgba(238,244,255,.86); display: grid; gap: .45rem; }
.launcher-button {
  border: none; border-radius: 14px; padding: .9rem 1rem; width: 100%; color: #fff; font-weight: 700; cursor: pointer;
}
.launcher-button.warm { background: linear-gradient(135deg, #ff8a50, #ff4d7e 48%, #12d6bb); }
.launcher-button.cool { background: linear-gradient(135deg, #4f6fff, #29a3ff 50%, #65ffe3); }
@media (max-width: 980px) { .launcher-grid { grid-template-columns: 1fr; } .launcher-shell { padding: 1.25rem; } }
</style>
