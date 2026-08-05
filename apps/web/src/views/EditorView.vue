<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ChartNote, ChartSet, Difficulty, SongDetail } from "@beatforge/shared";
import { beatToTimeMs, timeMsToBeat } from "@beatforge/shared";
import { api, ApiError } from "../api";
import EditorBoard from "../components/EditorBoard.vue";
import WaveformStrip from "../components/WaveformStrip.vue";
import { ArrowLeft, Check, ChevronDown, Clipboard, Copy, Gauge, Grid3X3, MousePointer2, Pause, Play, Redo2, Save, Scissors, Trash2, Undo2, Volume2, WandSparkles } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const songId = String(route.params.songId);
const song = ref<SongDetail>();
const chart = ref<ChartSet>();
const loading = ref(true);
const error = ref("");
const difficulty = ref<Difficulty>("normal");
const selectedIds = ref<string[]>([]);
const tool = ref<"select" | "tap" | "hold">("tap");
const snap = ref(0.5);
const visibleBeats = ref(16);
const currentBeat = ref(0);
const playing = ref(false);
const playbackRate = ref(1);
const saveState = ref<"saved" | "dirty" | "saving" | "conflict">("saved");
const baseRevision = ref(0);
const loopEnabled = ref(false);
const loopStartBeat = ref(0);
const loopEndBeat = ref(8);
const metronome = ref(false);
const hitsound = ref(true);
const history = ref<ChartSet[]>([]);
const future = ref<ChartSet[]>([]);
const clipboard = ref<ChartNote[]>([]);
let audio: HTMLAudioElement | undefined;
let animationFrame = 0;
let autosaveTimer: number | undefined;
let lastMetronomeBeat = -1;

const notes = computed(() => chart.value?.charts[difficulty.value].notes ?? []);
const selectedNote = computed(() => notes.value.find((note) => selectedIds.value[0] === note.id));
const currentAnchorIndex = computed(() => {
  const anchors = chart.value?.timing.anchors ?? [];
  if (!anchors.length) return -1;
  return anchors.reduce((best, anchor, index) => Math.abs(anchor.beat - currentBeat.value) < Math.abs(anchors[best].beat - currentBeat.value) ? index : best, 0);
});
const currentAnchor = computed(() => chart.value?.timing.anchors[currentAnchorIndex.value]);
const waveformProgress = computed(() => {
  void currentBeat.value;
  return song.value?.durationMs ? (audio?.currentTime ?? 0) * 1000 / song.value.durationMs : 0;
});
const loopRatios = computed(() => {
  const duration = song.value?.durationMs || 1;
  if (!chart.value) return { start: 0, end: 0 };
  return {
    start: beatToTimeMs(loopStartBeat.value, chart.value.timing.anchors) / duration,
    end: beatToTimeMs(loopEndBeat.value, chart.value.timing.anchors) / duration,
  };
});

function cloneChart() { return structuredClone(chart.value!); }

function mutate(action: () => void) {
  if (!chart.value) return;
  history.value.push(cloneChart());
  if (history.value.length > 100) history.value.shift();
  future.value = [];
  action();
  saveState.value = "dirty";
  scheduleSave();
}

function scheduleSave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => void saveNow(), 1500);
}

async function saveNow() {
  if (!chart.value || saveState.value === "saving" || saveState.value === "saved") return;
  saveState.value = "saving";
  try {
    const result = await api.saveChart(songId, baseRevision.value, cloneChart());
    chart.value.revision = result.chartSet.revision;
    baseRevision.value = result.chartSet.revision;
    saveState.value = "saved";
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) saveState.value = "conflict";
    else { saveState.value = "dirty"; error.value = cause instanceof Error ? cause.message : "保存失败"; }
  }
}

function undo() {
  const previous = history.value.pop();
  if (!previous || !chart.value) return;
  future.value.push(cloneChart());
  chart.value = previous;
  selectedIds.value = [];
  saveState.value = "dirty";
  scheduleSave();
}

function redo() {
  const next = future.value.pop();
  if (!next || !chart.value) return;
  history.value.push(cloneChart());
  chart.value = next;
  selectedIds.value = [];
  saveState.value = "dirty";
  scheduleSave();
}

function playHit() {
  if (!hitsound.value) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.05, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.05);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.06);
}

function addNote(lane: 0 | 1 | 2 | 3, beat: number, type: "tap" | "hold") {
  mutate(() => {
    const note: ChartNote = { id: crypto.randomUUID(), lane, beat, type };
    if (type === "hold") note.endBeat = beat + Math.max(1, snap.value * 2);
    chart.value!.charts[difficulty.value].notes.push(note);
    chart.value!.charts[difficulty.value].notes.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
    selectedIds.value = [note.id];
  });
  playHit();
}

function selectNote(id: string, additive: boolean) {
  if (additive) selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter((value) => value !== id) : [...selectedIds.value, id];
  else selectedIds.value = [id];
}

function moveNote(id: string, lane: 0 | 1 | 2 | 3, beat: number) {
  const note = notes.value.find((value) => value.id === id);
  if (!note || (note.lane === lane && note.beat === beat)) return;
  mutate(() => {
    const duration = note.endBeat == null ? 0 : note.endBeat - note.beat;
    note.lane = lane; note.beat = beat;
    note.offsetMs = 0;
    if (note.type === "hold") note.endBeat = beat + duration;
    notes.value.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
  });
}

function deleteSelected() {
  if (!selectedIds.value.length) return;
  mutate(() => {
    chart.value!.charts[difficulty.value].notes = notes.value.filter((note) => !selectedIds.value.includes(note.id));
    selectedIds.value = [];
  });
}

function copySelected() { clipboard.value = notes.value.filter((note) => selectedIds.value.includes(note.id)).map((note) => structuredClone(note)); }
function pasteSelected() {
  if (!clipboard.value.length) return;
  const minimum = Math.min(...clipboard.value.map((note) => note.beat));
  const offset = Math.max(snap.value, currentBeat.value - minimum);
  mutate(() => {
    const pasted = clipboard.value.map((note) => ({
      ...note, id: crypto.randomUUID(), beat: Math.max(0, note.beat + offset),
      endBeat: note.endBeat == null ? undefined : Math.max(0, note.endBeat + offset),
    }));
    chart.value!.charts[difficulty.value].notes.push(...pasted);
    chart.value!.charts[difficulty.value].notes.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
    selectedIds.value = pasted.map((note) => note.id);
  });
}

function updateSelected(field: "lane" | "beat" | "endBeat" | "type" | "offsetMs", value: string | number) {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  mutate(() => {
    for (const note of notes.value.filter((item) => ids.includes(item.id))) {
      if (field === "lane") note.lane = Math.max(0, Math.min(3, Number(value))) as 0 | 1 | 2 | 3;
      if (field === "beat") {
        const duration = note.endBeat == null ? 0 : note.endBeat - note.beat;
        note.beat = Math.max(0, Number(value));
        note.offsetMs = 0;
        if (note.type === "hold") note.endBeat = note.beat + duration;
      }
      if (field === "endBeat" && note.type === "hold") note.endBeat = Math.max(note.beat + snap.value, Number(value));
      if (field === "offsetMs") note.offsetMs = Math.max(-180, Math.min(180, Number(value)));
      if (field === "type") {
        note.type = value as "tap" | "hold";
        if (note.type === "hold" && note.endBeat == null) note.endBeat = note.beat + 1;
        if (note.type === "tap") delete note.endBeat;
      }
    }
  });
}

function shiftTiming(deltaMs: number) {
  mutate(() => { for (const anchor of chart.value!.timing.anchors) anchor.timeMs += deltaMs; });
}

function updateAnchorTime(value: number) {
  const index = currentAnchorIndex.value;
  if (index < 0) return;
  mutate(() => {
    const anchors = chart.value!.timing.anchors;
    const minimum = index > 0 ? anchors[index - 1].timeMs + 1 : 0;
    const maximum = index < anchors.length - 1 ? anchors[index + 1].timeMs - 1 : Number.MAX_SAFE_INTEGER;
    anchors[index].timeMs = Math.max(minimum, Math.min(maximum, value));
  });
}

function smoothAnchors() {
  const center = currentAnchorIndex.value;
  if (center < 0 || !chart.value) return;
  mutate(() => {
    const anchors = chart.value!.timing.anchors;
    const start = Math.max(0, center - 4);
    const end = Math.min(anchors.length - 1, center + 4);
    const startTime = anchors[start].timeMs;
    const endTime = anchors[end].timeMs;
    for (let index = start + 1; index < end; index += 1) {
      anchors[index].timeMs = startTime + (index - start) / (end - start) * (endTime - startTime);
    }
  });
}

function togglePlayback() {
  if (!audio) return;
  if (audio.paused) { audio.playbackRate = playbackRate.value; void audio.play(); }
  else audio.pause();
  playing.value = !audio.paused;
}

function seekRatio(ratio: number) { if (audio && song.value) audio.currentTime = ratio * song.value.durationMs / 1000; }

function beep() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = Math.round(currentBeat.value) % 4 === 0 ? 1000 : 700;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.04);
  oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.05);
}

function tick() {
  if (audio && chart.value) {
    currentBeat.value = timeMsToBeat(audio.currentTime * 1000, chart.value.timing.anchors);
    playing.value = !audio.paused;
    if (loopEnabled.value && currentBeat.value >= loopEndBeat.value) audio.currentTime = beatToTimeMs(loopStartBeat.value, chart.value.timing.anchors) / 1000;
    const wholeBeat = Math.floor(currentBeat.value + 0.03);
    if (metronome.value && playing.value && wholeBeat !== lastMetronomeBeat) { lastMetronomeBeat = wholeBeat; beep(); }
  }
  animationFrame = requestAnimationFrame(tick);
}

function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches("input, select, textarea")) return;
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") { event.preventDefault(); redo(); }
  else if ((event.ctrlKey || event.metaKey) && event.code === "KeyC") copySelected();
  else if ((event.ctrlKey || event.metaKey) && event.code === "KeyV") { event.preventDefault(); pasteSelected(); }
  else if (event.code === "Delete" || event.code === "Backspace") { event.preventDefault(); deleteSelected(); }
  else if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
  else if (event.code === "Digit1") tool.value = "select";
  else if (event.code === "Digit2") tool.value = "tap";
  else if (event.code === "Digit3") tool.value = "hold";
}

async function load() {
  try {
    const [songResult, chartResult] = await Promise.all([api.getSong(songId), api.getChart(songId)]);
    song.value = songResult.song;
    chart.value = chartResult.chartSet;
    baseRevision.value = chartResult.chartSet.revision;
    loopEndBeat.value = Math.min(8, chart.value.timing.anchors.at(-1)?.beat ?? 8);
    audio = new Audio(api.audioUrl(songId));
    audio.preload = "auto";
    audio.addEventListener("ended", () => { playing.value = false; });
    await nextTick();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "无法打开编辑器"; }
  finally { loading.value = false; }
}

onMounted(() => { void load(); window.addEventListener("keydown", onKeydown); animationFrame = requestAnimationFrame(tick); });
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown); cancelAnimationFrame(animationFrame);
  if (autosaveTimer) clearTimeout(autosaveTimer);
  audio?.pause();
  if (saveState.value === "dirty") void saveNow();
});
</script>

<template>
  <div class="editor-view">
    <div v-if="loading" class="full-loading"><i /><span>正在展开谱面工作台…</span></div>
    <div v-else-if="error && !chart" class="fatal-state"><h2>无法打开谱面</h2><p>{{ error }}</p><button class="secondary-button" @click="router.push('/')">返回曲库</button></div>
    <template v-else-if="chart && song">
      <header class="editor-header">
        <button class="icon-button" @click="router.push('/')"><ArrowLeft /></button>
        <div class="editor-song"><span class="eyebrow">CHART EDITOR</span><h2>{{ song.title }}</h2><p>{{ song.artist || '未知艺术家' }}</p></div>
        <div class="difficulty-tabs">
          <button v-for="item in (['easy','normal','hard'] as Difficulty[])" :key="item" :class="{ active: difficulty === item }" @click="difficulty = item; selectedIds = []">
            {{ item }}<b>{{ chart.charts[item].notes.length }}</b>
          </button>
        </div>
        <div class="save-state" :class="saveState"><Check v-if="saveState === 'saved'" :size="15" /><Save v-else :size="15" />{{ saveState === 'saved' ? `已保存 · v${baseRevision}` : saveState === 'saving' ? '保存中' : saveState === 'conflict' ? '版本冲突' : '有未保存修改' }}</div>
        <button class="primary-button compact" @click="saveNow"><Save :size="16" />保存</button>
        <button class="secondary-button compact" @click="router.push(`/play/${songId}/${difficulty}`)"><Play :size="16" />试玩</button>
      </header>

      <div class="editor-toolbar">
        <div class="tool-group">
          <button :class="{ active: tool === 'select' }" title="选择 (1)" @click="tool = 'select'"><MousePointer2 :size="17" /><span>选择</span></button>
          <button :class="{ active: tool === 'tap' }" title="单点 (2)" @click="tool = 'tap'"><i class="tap-symbol" /><span>单点</span></button>
          <button :class="{ active: tool === 'hold' }" title="长按 (3)" @click="tool = 'hold'"><i class="hold-symbol" /><span>长按</span></button>
        </div>
        <div class="tool-divider" />
        <div class="tool-group compact-tools"><button :disabled="!history.length" title="撤销 Ctrl+Z" @click="undo"><Undo2 :size="17" /></button><button :disabled="!future.length" title="重做 Ctrl+Y" @click="redo"><Redo2 :size="17" /></button><button title="复制" @click="copySelected"><Copy :size="17" /></button><button title="粘贴" @click="pasteSelected"><Clipboard :size="17" /></button><button title="删除" @click="deleteSelected"><Trash2 :size="17" /></button></div>
        <div class="tool-divider" />
        <label class="toolbar-select"><Grid3X3 :size="16" />吸附<select v-model.number="snap"><option :value="1">1/4</option><option :value="0.5">1/8</option><option :value="1/3">1/12</option><option :value="0.25">1/16</option></select><ChevronDown :size="14" /></label>
        <label class="toolbar-range"><Gauge :size="16" />缩放<input v-model.number="visibleBeats" type="range" min="8" max="32" step="4" /></label>
        <span class="shortcut-hint">SPACE 播放 · 1/2/3 工具 · DELETE 删除</span>
      </div>

      <div class="editor-workspace">
        <aside class="inspector left-inspector">
          <section><span class="eyebrow">TIMING</span><h3>节拍网格</h3><div class="metric-row"><div><small>估算 BPM</small><strong>{{ song.analysis?.bpm.toFixed(1) ?? '—' }}</strong></div><div><small>可信度</small><strong>{{ Math.round((song.analysis?.confidence ?? 0) * 100) }}%</strong></div></div></section>
          <section v-if="currentAnchor" class="form-section"><label>当前锚点<strong>Beat {{ currentAnchor.beat + 1 }}</strong></label><label>音频时间 (ms)<input :value="Math.round(currentAnchor.timeMs)" type="number" @change="updateAnchorTime(Number(($event.target as HTMLInputElement).value))" /></label><div class="button-row"><button @click="shiftTiming(-10)">−10 ms</button><button @click="shiftTiming(10)">+10 ms</button></div><button class="wide-tool" @click="smoothAnchors"><WandSparkles :size="15" />平滑附近 8 拍</button></section>
          <section><span class="eyebrow">PLAYBACK</span><div class="toggle-row"><label><input v-model="metronome" type="checkbox" />节拍器</label><label><input v-model="hitsound" type="checkbox" />编辑打击音</label></div><label>试听速度<select v-model.number="playbackRate" @change="audio && (audio.playbackRate = playbackRate)"><option :value="0.5">0.50×</option><option :value="0.75">0.75×</option><option :value="1">1.00×</option></select></label></section>
          <section><span class="eyebrow">LOOP</span><label class="switch-label"><input v-model="loopEnabled" type="checkbox" />区间循环</label><div class="two-cols"><label>开始<input v-model.number="loopStartBeat" type="number" min="0" step="0.25" /></label><label>结束<input v-model.number="loopEndBeat" type="number" min="0" step="0.25" /></label></div></section>
        </aside>

        <section class="timeline-panel">
          <div class="lane-labels"><span /><b>D</b><b>F</b><b>J</b><b>K</b></div>
          <EditorBoard :notes="notes" :anchors="chart.timing.anchors" :current-beat="currentBeat" :snap="snap" :selected-ids="selectedIds" :tool="tool" :visible-beats="visibleBeats" @add="addNote" @select="selectNote" @clear-selection="selectedIds = []" @move="moveNote" />
          <div class="transport-bar"><button class="transport-play" @click="togglePlayback"><Pause v-if="playing" /><Play v-else /></button><span class="timecode">{{ Math.floor((audio?.currentTime ?? 0) / 60) }}:{{ String(Math.floor((audio?.currentTime ?? 0) % 60)).padStart(2, '0') }}.{{ String(Math.floor(((audio?.currentTime ?? 0) % 1) * 1000)).padStart(3, '0') }}</span><WaveformStrip :peaks="song.analysis?.waveform ?? []" :progress="waveformProgress" :loop-start="loopEnabled ? loopRatios.start : undefined" :loop-end="loopEnabled ? loopRatios.end : undefined" @seek="seekRatio" /><Volume2 :size="17" /></div>
        </section>

        <aside class="inspector note-inspector">
          <section><span class="eyebrow">SELECTION</span><h3>{{ selectedIds.length ? `${selectedIds.length} 个音符` : '未选择音符' }}</h3><p v-if="!selectedIds.length" class="muted-copy">点击音符选择；按住 Ctrl 或 Shift 可多选。拖动音符可以改变轨道和节拍。</p></section>
          <section v-if="selectedNote" class="form-section"><label>类型<select :value="selectedNote.type" @change="updateSelected('type', ($event.target as HTMLSelectElement).value)"><option value="tap">单点 Tap</option><option value="hold">长按 Hold</option></select></label><label>轨道<input :value="selectedNote.lane" type="number" min="0" max="3" @change="updateSelected('lane', Number(($event.target as HTMLInputElement).value))" /></label><label>开始 Beat<input :value="selectedNote.beat" type="number" min="0" :step="snap" @change="updateSelected('beat', Number(($event.target as HTMLInputElement).value))" /></label><label>微调 (ms)<input :value="selectedNote.offsetMs ?? 0" type="number" min="-180" max="180" step="1" @change="updateSelected('offsetMs', Number(($event.target as HTMLInputElement).value))" /></label><label v-if="selectedNote.type === 'hold'">结束 Beat<input :value="selectedNote.endBeat" type="number" :min="selectedNote.beat + snap" :step="snap" @change="updateSelected('endBeat', Number(($event.target as HTMLInputElement).value))" /></label><button class="danger-button" @click="deleteSelected"><Trash2 :size="15" />删除所选</button></section>
          <section class="chart-stats"><span class="eyebrow">CHART DATA</span><div><span>单点</span><b>{{ notes.filter(n => n.type === 'tap').length }}</b></div><div><span>长按</span><b>{{ notes.filter(n => n.type === 'hold').length }}</b></div><div><span>总锚点</span><b>{{ chart.timing.anchors.length }}</b></div></section>
          <div v-if="error" class="alert error small">{{ error }}</div>
          <div v-if="saveState === 'conflict'" class="conflict-box"><Scissors :size="19" /><b>检测到其他页面的修改</b><p>请返回曲库后重新打开，避免覆盖更新。</p></div>
        </aside>
      </div>
    </template>
  </div>
</template>
