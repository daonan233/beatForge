<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { AudioLines, Check, Hand, RotateCcw, TimerReset } from "lucide-vue-next";
import { HitSoundPlayer } from "../game/hit-sound";
import { estimateLatencyMs } from "../game/latency";

const props = defineProps<{ currentLatency: number; hitVolume: number }>();
const emit = defineEmits<{ apply: [latencyMs: number] }>();

const BPM = 120;
const INTERVAL_SECONDS = 60 / BPM;
const COUNT_IN_BEATS = 4;
const SAMPLE_BEATS = 12;
const TOTAL_BEATS = COUNT_IN_BEATS + SAMPLE_BEATS;

type Phase = "idle" | "countIn" | "recording" | "complete";
const phase = ref<Phase>("idle");
const currentBeat = ref(-1);
const offsets = ref<number[]>([]);
const usedBeats = new Set<number>();
let context: AudioContext | undefined;
let hitSounds: HitSoundPlayer | undefined;
let beatTimes: number[] = [];
let timer: number | undefined;
let finishTimer: number | undefined;
let scheduledNodes: AudioScheduledSourceNode[] = [];

const recommendation = computed(() => estimateLatencyMs(offsets.value));
const sampleProgress = computed(() => Math.min(SAMPLE_BEATS, offsets.value.length));
const statusLabel = computed(() => {
  if (phase.value === "countIn") return `预备拍 ${Math.min(COUNT_IN_BEATS, currentBeat.value + 1)} / ${COUNT_IN_BEATS}`;
  if (phase.value === "recording") return `跟随鼓点 Tap · ${sampleProgress.value} / ${SAMPLE_BEATS}`;
  if (phase.value === "complete") return recommendation.value == null ? "有效点击不足，请再试一次" : "校准完成";
  return "约 8 秒完成校准";
});

function scheduleDrum(time: number, accent: boolean) {
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(accent ? 170 : 125, time);
  oscillator.frequency.exponentialRampToValueAtTime(accent ? 52 : 43, time + .13);
  gain.gain.setValueAtTime(.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? .82 : .62, time + .006);
  gain.gain.exponentialRampToValueAtTime(.0001, time + .2);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(time);
  oscillator.stop(time + .21);
  scheduledNodes.push(oscillator);
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

function updateBeat() {
  if (!context || !beatTimes.length) return;
  const now = context.currentTime;
  let index = -1;
  for (let beat = 0; beat < beatTimes.length; beat += 1) {
    if (now >= beatTimes[beat]) index = beat;
    else break;
  }
  currentBeat.value = index;
  phase.value = index < COUNT_IN_BEATS ? "countIn" : "recording";
}

async function start() {
  stop(false);
  context = new AudioContext({ latencyHint: "interactive" });
  await context.resume();
  hitSounds = new HitSoundPlayer(context);
  await hitSounds.prepare();
  offsets.value = [];
  usedBeats.clear();
  currentBeat.value = -1;
  phase.value = "countIn";
  const firstBeat = context.currentTime + .35;
  beatTimes = Array.from({ length: TOTAL_BEATS }, (_, index) => firstBeat + index * INTERVAL_SECONDS);
  beatTimes.forEach((time, index) => scheduleDrum(time, index % 4 === 0));
  timer = window.setInterval(updateBeat, 20);
  finishTimer = window.setTimeout(finish, (TOTAL_BEATS * INTERVAL_SECONDS + .7) * 1000);
  window.addEventListener("keydown", handleKeydown);
}

function tap() {
  if (!context || (phase.value !== "countIn" && phase.value !== "recording")) return;
  hitSounds?.play({ kind: "tap", lane: offsets.value.length % 4, grade: "perfect", volume: props.hitVolume });
  const now = context.currentTime;
  let nearestIndex = -1;
  let nearestOffset = Number.POSITIVE_INFINITY;
  for (let index = COUNT_IN_BEATS; index < beatTimes.length; index += 1) {
    if (usedBeats.has(index)) continue;
    const offset = now - beatTimes[index];
    if (Math.abs(offset) < Math.abs(nearestOffset)) {
      nearestIndex = index;
      nearestOffset = offset;
    }
  }
  if (nearestIndex >= 0 && Math.abs(nearestOffset) <= .28) {
    usedBeats.add(nearestIndex);
    offsets.value = [...offsets.value, nearestOffset * 1000];
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.repeat || !["Space", "KeyD", "KeyF", "KeyJ", "KeyK"].includes(event.code)) return;
  event.preventDefault();
  tap();
}

function finish() {
  if (timer != null) window.clearInterval(timer);
  timer = undefined;
  window.removeEventListener("keydown", handleKeydown);
  phase.value = "complete";
  currentBeat.value = TOTAL_BEATS;
}

function stop(resetPhase = true) {
  if (timer != null) window.clearInterval(timer);
  if (finishTimer != null) window.clearTimeout(finishTimer);
  timer = undefined;
  finishTimer = undefined;
  window.removeEventListener("keydown", handleKeydown);
  for (const node of scheduledNodes) {
    try { node.stop(); } catch { /* already stopped */ }
  }
  scheduledNodes = [];
  hitSounds?.dispose();
  hitSounds = undefined;
  if (context && context.state !== "closed") void context.close();
  context = undefined;
  beatTimes = [];
  if (resetPhase) phase.value = "idle";
}

function apply() {
  if (recommendation.value == null) return;
  emit("apply", recommendation.value);
  stop();
}

onBeforeUnmount(() => stop());
</script>

<template>
  <div class="latency-calibration" :class="`phase-${phase}`">
    <div class="calibration-heading">
      <span class="calibration-icon"><TimerReset :size="18" /></span>
      <div><b>节拍自动校准</b><small>{{ statusLabel }}</small></div>
      <strong v-if="recommendation != null">{{ recommendation > 0 ? '+' : '' }}{{ recommendation }} ms</strong>
    </div>

    <div v-if="phase === 'idle'" class="calibration-idle">
      <p>听到鼓点时跟着按下 Tap。系统会用当前 Tap 音效反馈，并自动计算设备延迟。</p>
      <button class="secondary-button compact" @click="start"><AudioLines :size="15" />开始校准</button>
    </div>

    <template v-else>
      <div class="calibration-beats" aria-hidden="true">
        <i v-for="beat in TOTAL_BEATS" :key="beat" :class="{ active: beat - 1 === currentBeat, sampled: beat - 1 >= COUNT_IN_BEATS && usedBeats.has(beat - 1), countin: beat <= COUNT_IN_BEATS }" />
      </div>
      <button v-if="phase !== 'complete'" class="calibration-tap" @pointerdown.prevent="tap">
        <Hand :size="23" /><b>TAP</b><small>空格 / D F J K / 点击</small>
      </button>
      <div v-else class="calibration-result">
        <template v-if="recommendation != null">
          <p>当前 {{ props.currentLatency }} ms · 建议 {{ recommendation > 0 ? '+' : '' }}{{ recommendation }} ms</p>
          <button class="primary-button compact" @click="apply"><Check :size="15" />应用建议延迟</button>
        </template>
        <button class="ghost-button compact" @click="start"><RotateCcw :size="14" />重新校准</button>
      </div>
    </template>
  </div>
</template>
