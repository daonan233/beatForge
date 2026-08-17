<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { Gauge, Library, RotateCcw, Settings, Volume2, X } from "lucide-vue-next";
import LatencyCalibration from "./components/LatencyCalibration.vue";
import SpeedPreview from "./components/SpeedPreview.vue";
import { useSettings } from "./composables/settings";

const route = useRoute();
const settingsOpen = ref(false);
const { settings, reset } = useSettings();
const isGame = computed(() => route.name === "game");
const keyLabels = computed(() => settings.keys.map((key) => key.replace("Key", "")));

function captureKey(index: number, event: KeyboardEvent) {
  event.preventDefault();
  if (!settings.keys.includes(event.code) || settings.keys[index] === event.code) settings.keys[index] = event.code;
}

function applyLatency(latencyMs: number) {
  settings.latencyMs = latencyMs;
}
</script>

<template>
  <div class="app-shell" :class="{ 'game-shell': isGame }">
    <header v-if="!isGame" class="topbar">
      <RouterLink class="brand" to="/" aria-label="BeatForge 曲库">
        <span class="brand-mark"><i /><i /><i /><i /></span>
        <span><b>BEAT</b>FORGE</span>
      </RouterLink>
      <nav>
        <RouterLink to="/"><Library :size="17" />曲库</RouterLink>
        <button class="nav-button" @click="settingsOpen = true"><Settings :size="17" />设置</button>
      </nav>
      <div class="status-chip"><span /> 本地工作室</div>
    </header>
    <main :class="{ 'main-padded': !isGame }"><RouterView /></main>

    <Transition name="fade">
      <div v-if="settingsOpen" class="modal-backdrop" @mousedown.self="settingsOpen = false">
        <section class="modal-card settings-card" role="dialog" aria-modal="true" aria-label="游戏设置">
          <header><div><span class="eyebrow">PLAYER SETUP</span><h2>控制、速度与延迟</h2></div><button class="icon-button" aria-label="关闭设置" @click="settingsOpen = false"><X /></button></header>
          <div class="settings-scroll">
            <div class="setting-block">
              <label>四轨键位</label>
              <div class="key-grid">
                <button v-for="(label, index) in keyLabels" :key="index" @keydown="captureKey(index, $event)">{{ label }}<small>聚焦后按键</small></button>
              </div>
            </div>
            <div class="settings-two-column">
              <div class="setting-block">
                <label for="volume">歌曲音量 <strong>{{ Math.round(settings.volume * 100) }}%</strong></label>
                <input id="volume" v-model.number="settings.volume" type="range" min="0" max="1" step="0.01" />
              </div>
              <div class="setting-block">
                <label for="hit-volume"><Volume2 :size="16" /> 打击音量 <strong>{{ Math.round(settings.hitVolume * 100) }}%</strong></label>
                <input id="hit-volume" v-model.number="settings.hitVolume" type="range" min="0" max="1" step="0.01" />
              </div>
            </div>
            <div class="setting-block latency-setting">
              <label for="latency">设备延迟 <strong>{{ settings.latencyMs > 0 ? '+' : '' }}{{ settings.latencyMs }} ms</strong></label>
              <input id="latency" v-model.number="settings.latencyMs" type="range" min="-200" max="200" step="1" />
              <p>可以手动调整，也可以跟随鼓点 Tap 自动测量端到端设备延迟。</p>
              <LatencyCalibration :current-latency="settings.latencyMs" :hit-volume="settings.hitVolume" @apply="applyLatency" />
            </div>
            <div class="setting-block speed-setting">
              <label for="speed"><Gauge :size="16" /> 下落速度 <strong>{{ settings.scrollSpeed }} / 30</strong></label>
              <input id="speed" v-model.number="settings.scrollSpeed" type="range" min="1" max="30" step="1" />
              <SpeedPreview :speed="settings.scrollSpeed" />
              <p>速度只改变音符的可视提前量，不影响音乐时间和判定。</p>
            </div>
          </div>
          <footer><button class="ghost-button" @click="reset"><RotateCcw :size="16" />恢复默认</button><button class="primary-button" @click="settingsOpen = false">保存设置</button></footer>
        </section>
      </div>
    </Transition>
  </div>
</template>
