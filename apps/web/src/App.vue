<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { Gauge, Library, RotateCcw, Settings, Volume2, X } from "lucide-vue-next";
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
          <header><div><span class="eyebrow">PLAYER SETUP</span><h2>控制与延迟</h2></div><button class="icon-button" @click="settingsOpen = false"><X /></button></header>
          <div class="setting-block">
            <label>四轨键位</label>
            <div class="key-grid">
              <button v-for="(label, index) in keyLabels" :key="index" @keydown="captureKey(index, $event)">{{ label }}<small>点击后按键</small></button>
            </div>
          </div>
          <div class="setting-block">
            <label for="volume">歌曲音量 <strong>{{ Math.round(settings.volume * 100) }}%</strong></label>
            <input id="volume" v-model.number="settings.volume" type="range" min="0" max="1" step="0.01" />
          </div>
          <div class="setting-block">
            <label for="hit-volume"><Volume2 :size="16" /> 打击音量 <strong>{{ Math.round(settings.hitVolume * 100) }}%</strong></label>
            <input id="hit-volume" v-model.number="settings.hitVolume" type="range" min="0" max="1" step="0.01" />
            <p>只调整音符命中时的镲片音量，不影响歌曲音量。</p>
          </div>
          <div class="setting-block">
            <label for="latency">设备延迟 <strong>{{ settings.latencyMs }} ms</strong></label>
            <input id="latency" v-model.number="settings.latencyMs" type="range" min="-200" max="200" step="1" />
            <p>音符看起来偏晚时调高，偏早时调低。</p>
          </div>
          <div class="setting-block">
            <label for="speed"><Gauge :size="16" /> 下落速度 <strong>{{ settings.scrollSpeed }} / 10</strong></label>
            <input id="speed" v-model.number="settings.scrollSpeed" type="range" min="1" max="10" step="1" />
            <p>速度只改变音符的可视距离，不影响音乐时间和判定。</p>
          </div>
          <footer><button class="ghost-button" @click="reset"><RotateCcw :size="16" />恢复默认</button><button class="primary-button" @click="settingsOpen = false">保存设置</button></footer>
        </section>
      </div>
    </Transition>
  </div>
</template>
