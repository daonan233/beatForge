<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ChartNote, ChartSet, Difficulty, ScoreSummary, SongDetail } from "@beatforge/shared";
import { beatToTimeMs } from "@beatforge/shared";
import { api } from "../api";
import { useSettings } from "../composables/settings";
import GameBoard, { type GameRenderNote } from "../components/GameBoard.vue";
import { ArrowLeft, Bot, Pause, Play, RotateCcw, Settings2, Trophy } from "lucide-vue-next";
import { classifyTiming, judgementWeights, judgementWindowsForDifficulty, normalizedScore, type Grade } from "../game/scoring";
import { countdownNumber, countdownRenderTimeMs, GAME_COUNTDOWN_SECONDS } from "../game/countdown";
import { HitSoundPlayer, type HitSoundKind } from "../game/hit-sound";
import { approachDurationMs, clampScrollSpeed } from "../game/scroll";

interface RuntimeNote extends GameRenderNote {
  source: ChartNote;
  head: "pending" | Grade;
  tail?: "pending" | Grade;
}

const route = useRoute();
const router = useRouter();
const songId = String(route.params.songId);
const difficulty = (["easy", "normal", "hard", "ultra"].includes(String(route.params.difficulty)) ? String(route.params.difficulty) : "normal") as Difficulty;
const { settings } = useSettings();
const song = ref<SongDetail>();
const chart = ref<ChartSet>();
const notes = ref<RuntimeNote[]>([]);
const loading = ref(true);
const loadingMessage = ref("正在读取谱面");
const error = ref("");
const ready = ref(false);
const running = ref(false);
const paused = ref(false);
const finished = ref(false);
const autoplay = ref(false);
const autoplayUsed = ref(false);
const countdown = ref<number | null>(null);
const currentTimeMs = ref(-1000);
const pressed = ref([false, false, false, false]);
const judgement = ref("");
const combo = ref(0);
const maxCombo = ref(0);
const counts = ref<Record<Grade, number>>({ perfect: 0, great: 0, good: 0, miss: 0 });
const weightedScore = ref(0);
const savedBest = ref<ScoreSummary>();
let context: AudioContext | undefined;
let buffer: AudioBuffer | undefined;
let source: AudioBufferSourceNode | undefined;
let gain: GainNode | undefined;
let contextStart = 0;
let playbackOffsetMs = 0;
let firstNoteTimeMs = 0;
let animationFrame = 0;
let judgementTimer: number | undefined;
let hitSounds: HitSoundPlayer | undefined;
let completing = false;
let playheadTimeMs = -1000;
let lastHudUpdate = 0;
const heldCodes = new Set<string>();
const autoLaneTimers: Array<number | undefined> = [undefined, undefined, undefined, undefined];

const keyLabels = computed(() => settings.keys.map((key) => key.replace("Key", "")));
const totalEvents = computed(() => notes.value.reduce((sum, note) => sum + (note.type === "hold" ? 2 : 1), 0));
const judgedEvents = computed(() => counts.value.perfect + counts.value.great + counts.value.good + counts.value.miss);
const score = computed(() => normalizedScore(weightedScore.value, totalEvents.value));
const accuracy = computed(() => judgedEvents.value ? weightedScore.value / judgedEvents.value * 100 : 100);
const difficultyLabel = { easy: "EASY", normal: "NORMAL", hard: "HARD", ultra: "ULTRA" }[difficulty];
const timingWindows = judgementWindowsForDifficulty(difficulty);
const progress = computed(() => buffer ? Math.max(0, Math.min(1, currentTimeMs.value / (buffer.duration * 1000))) : 0);

function adjustSpeed(delta: number) {
  settings.scrollSpeed = clampScrollSpeed(settings.scrollSpeed + delta);
}

function toggleAutoplay() {
  if (running.value) return;
  autoplay.value = !autoplay.value;
}

function clearAutoLaneTimers() {
  for (let lane = 0; lane < autoLaneTimers.length; lane += 1) {
    if (autoLaneTimers[lane]) clearTimeout(autoLaneTimers[lane]);
    autoLaneTimers[lane] = undefined;
  }
}

function flashAutoLane(lane: number) {
  pressed.value[lane] = true;
  if (autoLaneTimers[lane]) clearTimeout(autoLaneTimers[lane]);
  autoLaneTimers[lane] = window.setTimeout(() => {
    const holding = notes.value.some((note) => note.lane === lane && note.status === "holding");
    if (!holding) pressed.value[lane] = false;
    autoLaneTimers[lane] = undefined;
  }, 85);
}

function showJudgement(grade: Grade) {
  judgement.value = grade.toUpperCase();
  if (judgementTimer) clearTimeout(judgementTimer);
  judgementTimer = window.setTimeout(() => { judgement.value = ""; }, 320);
}

function record(grade: Grade) {
  counts.value[grade] += 1;
  weightedScore.value += judgementWeights[grade];
  if (grade === "miss") combo.value = 0;
  else { combo.value += 1; maxCombo.value = Math.max(maxCombo.value, combo.value); }
  showJudgement(grade);
}

function playNoteHit(note: RuntimeNote, grade: Grade, kind: HitSoundKind) {
  if (grade === "miss") return;
  hitSounds?.play({ kind, lane: note.lane, grade, volume: settings.hitVolume });
}

function resetState() {
  for (const note of notes.value) {
    note.head = "pending"; note.tail = note.type === "hold" ? "pending" : undefined; note.status = "pending";
  }
  counts.value = { perfect: 0, great: 0, good: 0, miss: 0 };
  weightedScore.value = 0; combo.value = 0; maxCombo.value = 0; currentTimeMs.value = -1000;
  playheadTimeMs = -1000; lastHudUpdate = 0;
  autoplayUsed.value = false; countdown.value = null; clearAutoLaneTimers();
  finished.value = false; completing = false; playbackOffsetMs = 0; heldCodes.clear(); pressed.value = [false, false, false, false];
}

function createSource(offsetMs: number, delaySeconds = 0.08) {
  if (!context || !buffer) return;
  source?.stop();
  source = context.createBufferSource();
  gain = context.createGain();
  gain.gain.value = settings.volume;
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  contextStart = context.currentTime + delaySeconds;
  playbackOffsetMs = offsetMs;
  source.start(contextStart, Math.max(0, offsetMs / 1000));
  running.value = true; paused.value = false;
}

async function startGame() {
  if (!context || !buffer) return;
  await context.resume();
  await hitSounds?.prepare();
  if (finished.value) resetState();
  if (autoplay.value) autoplayUsed.value = true;
  countdown.value = GAME_COUNTDOWN_SECONDS;
  createSource(playbackOffsetMs, GAME_COUNTDOWN_SECONDS);
}

function pauseGame() {
  if (!context || !running.value) return;
  if (countdown.value != null) {
    source?.stop(); source = undefined; running.value = false; countdown.value = null;
    clearAutoLaneTimers(); pressed.value = [false, false, false, false];
    return;
  }
  playbackOffsetMs = Math.max(0, (context.currentTime - contextStart) * 1000 + playbackOffsetMs);
  playheadTimeMs = playbackOffsetMs + settings.latencyMs;
  currentTimeMs.value = playheadTimeMs;
  source?.stop(); source = undefined; running.value = false; paused.value = true;
  heldCodes.clear(); clearAutoLaneTimers(); pressed.value = [false, false, false, false];
}

function resumeGame() { if (context && buffer) void context.resume().then(() => createSource(playbackOffsetMs)); }

function restartGame() {
  source?.stop(); source = undefined; running.value = false; paused.value = false;
  resetState(); void startGame();
}

function hitLane(lane: number) {
  const candidates = notes.value.filter((note) => note.lane === lane && note.head === "pending");
  const note = candidates.sort((a, b) => Math.abs(a.startMs - playheadTimeMs) - Math.abs(b.startMs - playheadTimeMs))[0];
  if (!note) return;
  const grade = classifyTiming(playheadTimeMs - note.startMs, timingWindows);
  if (grade === "miss") return;
  note.head = grade;
  playNoteHit(note, grade, note.type === "hold" ? "holdHead" : "tap");
  record(grade);
  if (note.type === "tap") note.status = "done";
  else note.status = "holding";
}

function releaseLane(lane: number) {
  const note = notes.value.find((item) => item.lane === lane && item.status === "holding" && item.tail === "pending");
  if (!note || note.endMs == null) return;
  const grade = classifyTiming(playheadTimeMs - note.endMs, timingWindows);
  note.tail = grade; note.status = grade === "miss" ? "missed" : "done";
  playNoteHit(note, grade, "holdTail");
  record(grade);
}

function onKeydown(event: KeyboardEvent) {
  if (event.code === "Escape") { void router.push("/"); return; }
  if (event.code === "Space") {
    event.preventDefault();
    if (!ready.value) return;
    if (running.value) pauseGame(); else if (paused.value) resumeGame(); else void startGame();
    return;
  }
  if (event.code === "KeyA" && !running.value) { event.preventDefault(); toggleAutoplay(); return; }
  if (autoplay.value) return;
  if (event.repeat || !running.value || countdown.value != null || heldCodes.has(event.code)) return;
  const lane = settings.keys.indexOf(event.code);
  if (lane < 0) return;
  event.preventDefault(); heldCodes.add(event.code); pressed.value[lane] = true; hitLane(lane);
}

function onKeyup(event: KeyboardEvent) {
  const lane = settings.keys.indexOf(event.code);
  if (lane < 0) return;
  heldCodes.delete(event.code); pressed.value[lane] = false;
  if (running.value) releaseLane(lane);
}

function processMisses() {
  for (const note of notes.value) {
    if (note.head === "pending" && playheadTimeMs > note.startMs + timingWindows.good) {
      note.head = "miss"; note.status = note.type === "hold" ? "holding" : "missed"; record("miss");
      if (note.type === "hold") { note.tail = "miss"; note.status = "missed"; record("miss"); }
    }
    if (note.type === "hold" && note.status === "holding" && note.tail === "pending" && note.endMs != null && playheadTimeMs >= note.endMs) {
      const code = settings.keys[note.lane];
      const grade: Grade = heldCodes.has(code) ? "perfect" : "miss";
      note.tail = grade; note.status = grade === "miss" ? "missed" : "done";
      playNoteHit(note, grade, "holdTail");
      record(grade);
    }
  }
}

function processAutoplay() {
  for (const note of notes.value) {
    if (note.head === "pending" && playheadTimeMs >= note.startMs) {
      note.head = "perfect";
      playNoteHit(note, "perfect", note.type === "hold" ? "holdHead" : "tap");
      record("perfect");
      flashAutoLane(note.lane);
      if (note.type === "tap") note.status = "done";
      else {
        note.status = "holding";
        pressed.value[note.lane] = true;
      }
    }
    if (note.type === "hold" && note.status === "holding" && note.tail === "pending" &&
        note.endMs != null && playheadTimeMs >= note.endMs) {
      note.tail = "perfect";
      note.status = "done";
      playNoteHit(note, "perfect", "holdTail");
      record("perfect");
      const anotherHold = notes.value.some((item) => item !== note && item.lane === note.lane && item.status === "holding");
      if (!anotherHold) pressed.value[note.lane] = false;
    }
  }
}

async function completeGame() {
  if (completing || !chart.value) return;
  completing = true; running.value = false; finished.value = true;
  source?.stop();
  clearAutoLaneTimers(); pressed.value = [false, false, false, false];
  const result: ScoreSummary = {
    score: score.value, accuracy: Number(accuracy.value.toFixed(2)), maxCombo: maxCombo.value,
    perfect: counts.value.perfect, great: counts.value.great, good: counts.value.good, miss: counts.value.miss,
  };
  if (autoplayUsed.value) { savedBest.value = undefined; return; }
  try { savedBest.value = (await api.saveScore(songId, difficulty, chart.value.revision, result)).best; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "成绩保存失败"; }
}

function getRenderTimeMs() {
  if (running.value && context) {
    const rawTimeMs = (context.currentTime - contextStart) * 1000 + playbackOffsetMs + settings.latencyMs;
    if (countdown.value != null) {
      return countdownRenderTimeMs(rawTimeMs, approachDurationMs(settings.scrollSpeed), firstNoteTimeMs);
    }
    return rawTimeMs;
  }
  return playheadTimeMs;
}

function tick(frameTime: number) {
  if (countdown.value != null && context) {
    const remaining = countdownNumber(context.currentTime, contextStart);
    countdown.value = remaining > 0 ? remaining : null;
  }
  if (running.value && context) {
    playheadTimeMs = getRenderTimeMs();
    if (frameTime - lastHudUpdate >= 50) {
      currentTimeMs.value = playheadTimeMs;
      lastHudUpdate = frameTime;
    }
    if (autoplay.value) processAutoplay(); else processMisses();
    if (judgedEvents.value >= totalEvents.value || (buffer && playheadTimeMs > buffer.duration * 1000 + 300)) void completeGame();
  }
  animationFrame = requestAnimationFrame(tick);
}

async function load() {
  try {
    const [songResult, chartResult] = await Promise.all([api.getSong(songId), api.getChart(songId)]);
    song.value = songResult.song; chart.value = chartResult.chartSet;
    notes.value = chart.value.charts[difficulty].notes.map((note) => ({
      id: note.id, source: note, lane: note.lane, type: note.type,
      startMs: beatToTimeMs(note.beat, chart.value!.timing.anchors) + (note.offsetMs ?? 0),
      endMs: note.endBeat == null ? undefined : beatToTimeMs(note.endBeat, chart.value!.timing.anchors),
      head: "pending", tail: note.type === "hold" ? "pending" : undefined, status: "pending",
    }));
    firstNoteTimeMs = notes.value.reduce((earliest, note) => Math.min(earliest, note.startMs), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(firstNoteTimeMs)) firstNoteTimeMs = 0;
    loadingMessage.value = "正在解码音频";
    context = new AudioContext();
    hitSounds = new HitSoundPlayer(context);
    const response = await fetch(api.audioUrl(songId));
    if (!response.ok) throw new Error("音频加载失败");
    buffer = await context.decodeAudioData(await response.arrayBuffer());
    await hitSounds.prepare();
    ready.value = true;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "无法开始游戏"; }
  finally { loading.value = false; }
}

onMounted(() => { window.addEventListener("keydown", onKeydown); window.addEventListener("keyup", onKeyup); animationFrame = requestAnimationFrame(tick); void load(); });
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown); window.removeEventListener("keyup", onKeyup);
  cancelAnimationFrame(animationFrame); if (judgementTimer) clearTimeout(judgementTimer);
  clearAutoLaneTimers();
  hitSounds?.dispose();
  source?.stop(); void context?.close();
});
</script>

<template>
  <div class="game-view">
    <header class="game-topbar">
      <button class="game-back" @click="router.push('/')"><ArrowLeft :size="19" /><span>退出</span></button>
      <div class="game-track"><span>{{ difficultyLabel }} · 4K</span><h1>{{ song?.title ?? 'BeatForge' }}</h1><p>{{ song?.artist || '未知艺术家' }}</p></div>
      <div class="game-progress"><i :style="{ width: `${progress * 100}%` }" /></div>
      <div class="score-block"><small>SCORE</small><strong>{{ score.toString().padStart(7, '0') }}</strong></div>
      <button class="game-settings" @click="running ? pauseGame() : paused ? resumeGame() : undefined"><Pause v-if="running" :size="19" /><Play v-else :size="19" /></button>
    </header>

    <div class="game-stage-wrap">
      <aside class="game-metrics left"><div><small>ACCURACY</small><strong>{{ accuracy.toFixed(2) }}<i>%</i></strong></div><div><small>MAX COMBO</small><strong>{{ maxCombo }}</strong></div><div class="judgement-list"><span><i class="perfect" />PERFECT <b>{{ counts.perfect }}</b></span><span><i class="great" />GREAT <b>{{ counts.great }}</b></span><span><i class="good" />GOOD <b>{{ counts.good }}</b></span><span><i class="miss" />MISS <b>{{ counts.miss }}</b></span></div></aside>
      <main class="game-cabinet">
        <GameBoard :notes="notes" :time-source="getRenderTimeMs" :speed="settings.scrollSpeed" :pressed="pressed" :key-labels="keyLabels" :judgement="judgement" />
        <div v-if="combo > 1 && running" class="combo-display"><strong>{{ combo }}</strong><span>COMBO</span></div>
        <div v-if="loading" class="game-overlay"><div class="loader-ring" /><h2>{{ loadingMessage }}</h2><p>首次载入需要稍等片刻</p></div>
        <div v-else-if="error && !ready" class="game-overlay"><h2>无法开始</h2><p>{{ error }}</p><button class="secondary-button" @click="router.push('/')">返回曲库</button></div>
        <div v-else-if="countdown != null" class="game-overlay countdown-overlay"><span class="eyebrow">GET READY</span><Transition name="count-pop" mode="out-in"><strong :key="countdown">{{ countdown }}</strong></Transition><p>准备击打</p><small>空格键取消</small></div>
        <div v-else-if="ready && !running && !paused && !finished" class="game-overlay start-overlay"><span class="eyebrow">READY TO PLAY</span><h2>{{ difficultyLabel }}</h2><p>{{ autoplay ? 'Autoplay 将自动演示全部音符' : `使用 ${keyLabels.join(' · ')} 击打四条轨道` }}</p><button class="start-button" @click="startGame"><Play :size="24" />开始</button><small>{{ autoplay ? 'AUTO 成绩不会保存 · A 切换' : '空格键开始 · A 开关 Autoplay' }}</small></div>
        <div v-else-if="paused" class="game-overlay"><Pause :size="30" /><h2>已暂停</h2><p>保持节奏，准备好再继续。</p><div class="overlay-actions"><button class="start-button small" @click="resumeGame"><Play :size="19" />继续</button><button class="ghost-button" @click="restartGame"><RotateCcw :size="17" />重新开始</button></div></div>
      </main>
      <aside class="game-metrics right"><div><small>CHART</small><strong>v{{ chart?.revision ?? 0 }}</strong></div><div><small>NOTES</small><strong>{{ totalEvents }}</strong></div><div v-if="difficulty === 'ultra'" class="ultra-window"><small>STRICT WINDOWS</small><b>±25 / 55 / 85 ms</b></div><div class="key-reminder"><span v-for="key in keyLabels" :key="key">{{ key }}</span></div><button class="autoplay-toggle" :class="{ active: autoplay }" :disabled="running" @click="toggleAutoplay"><Bot :size="17" /><span><small>AUTOPLAY</small><b>{{ autoplay ? 'ON' : 'OFF' }}</b></span><i>A</i></button><div class="game-speed-control"><button aria-label="降低下落速度" :disabled="settings.scrollSpeed <= 1" @click="adjustSpeed(-1)">−</button><span><small>SPEED</small><b>{{ settings.scrollSpeed }}</b><i>/ 10</i></span><button aria-label="提高下落速度" :disabled="settings.scrollSpeed >= 10" @click="adjustSpeed(1)">＋</button></div><div class="game-hit-volume"><label for="game-hit-volume"><small>HIT VOLUME</small><b>{{ Math.round(settings.hitVolume * 100) }}%</b></label><input id="game-hit-volume" v-model.number="settings.hitVolume" aria-label="打击音量" type="range" min="0" max="1" step="0.01" /></div><p><Settings2 :size="15" />延迟 {{ settings.latencyMs }} ms<br />Autoplay 不记录最佳成绩</p></aside>
    </div>

    <Transition name="fade">
      <div v-if="finished" class="result-backdrop">
        <section class="result-card"><span class="eyebrow"><Bot v-if="autoplayUsed" :size="15" /><Trophy v-else :size="15" /> {{ autoplayUsed ? 'AUTOPLAY COMPLETE' : 'TRACK COMPLETE' }}</span><div class="rank" :class="{ auto: autoplayUsed }">{{ autoplayUsed ? 'AUTO' : accuracy >= 98 ? 'S' : accuracy >= 92 ? 'A' : accuracy >= 82 ? 'B' : accuracy >= 70 ? 'C' : 'D' }}</div><h2>{{ score.toLocaleString() }}</h2><p>{{ song?.title }} · {{ difficultyLabel }}</p><div class="result-stats"><div><span>准确率</span><b>{{ accuracy.toFixed(2) }}%</b></div><div><span>最高连击</span><b>{{ maxCombo }}</b></div><div><span>{{ autoplayUsed ? '成绩状态' : '最佳成绩' }}</span><b>{{ autoplayUsed ? '不保存' : savedBest?.score.toLocaleString() ?? score.toLocaleString() }}</b></div></div><div class="result-judgements"><span>PERFECT <b>{{ counts.perfect }}</b></span><span>GREAT <b>{{ counts.great }}</b></span><span>GOOD <b>{{ counts.good }}</b></span><span>MISS <b>{{ counts.miss }}</b></span></div><div class="result-actions"><button class="ghost-button" @click="router.push('/')">返回曲库</button><button class="primary-button" @click="restartGame"><RotateCcw :size="17" />再来一次</button></div><small v-if="error" class="result-error">{{ error }}</small></section>
      </div>
    </Transition>
  </div>
</template>
