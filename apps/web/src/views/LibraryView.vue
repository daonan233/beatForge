<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import type { AnalysisJob, Difficulty, SongSummary } from "@beatforge/shared";
import { ArrowRight, BarChart3, FileAudio, Music2, PencilLine, Play, Plus, RefreshCw, Sparkles, Trash2, UploadCloud, X } from "lucide-vue-next";

const router = useRouter();
const songs = ref<SongSummary[]>([]);
const loading = ref(true);
const error = ref("");
const uploadOpen = ref(false);
const uploading = ref(false);
const dragActive = ref(false);
const file = ref<File | null>(null);
const title = ref("");
const artist = ref("");
const activeJob = ref<AnalysisJob | null>(null);
let pollTimer: number | undefined;
let eventSource: EventSource | undefined;

const readyCount = computed(() => songs.value.filter((song) => song.status === "ready").length);
const totalCharts = computed(() => readyCount.value * 4);

async function loadSongs(silent = false) {
  if (!silent) loading.value = true;
  try {
    songs.value = (await api.listSongs()).songs;
    error.value = "";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "曲库加载失败"; }
  finally { loading.value = false; }
}

function chooseFile(chosen?: File) {
  if (!chosen) return;
  file.value = chosen;
  title.value = chosen.name.replace(/\.[^.]+$/, "");
}

function watchJob(job: AnalysisJob) {
  eventSource?.close();
  activeJob.value = job;
  eventSource = new EventSource(`/api/jobs/${job.id}/events`);
  eventSource.addEventListener("progress", (event) => {
    activeJob.value = JSON.parse((event as MessageEvent).data) as AnalysisJob;
    if (["complete", "failed"].includes(activeJob.value.status)) {
      eventSource?.close();
      void loadSongs(true);
    }
  });
}

async function submitUpload() {
  if (!file.value || uploading.value) return;
  uploading.value = true;
  error.value = "";
  try {
    const result = await api.uploadSong(file.value, title.value, artist.value);
    uploadOpen.value = false;
    file.value = null;
    title.value = "";
    artist.value = "";
    watchJob(result.job);
    await loadSongs(true);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "上传失败"; }
  finally { uploading.value = false; }
}

async function regenerate(song: SongSummary) {
  try { watchJob((await api.regenerate(song.id)).job); await loadSongs(true); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "无法重新生成"; }
}

async function removeSong(song: SongSummary) {
  if (!window.confirm(`确定删除《${song.title}》及其全部谱面和成绩吗？此操作无法撤销。`)) return;
  try { await api.deleteSong(song.id); await loadSongs(true); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "删除失败"; }
}

function formatDuration(ms: number) {
  if (!ms) return "--:--";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const difficulties: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "EASY" }, { id: "normal", label: "NORMAL" },
  { id: "hard", label: "HARD" }, { id: "ultra", label: "ULTRA" },
];

onMounted(() => {
  void loadSongs();
  pollTimer = window.setInterval(() => {
    if (songs.value.some((song) => song.status === "queued" || song.status === "analyzing")) void loadSongs(true);
  }, 2500);
});
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer); eventSource?.close(); });
</script>

<template>
  <div class="library-view">
    <section class="hero-panel">
      <div class="hero-copy">
        <span class="eyebrow"><Sparkles :size="14" /> AUDIO TO PLAYABLE</span>
        <h1>把每一首歌，<br /><em>铸成一场节奏。</em></h1>
        <p>上传你拥有使用权的音频。BeatForge 会分析节拍、生成四档四轨谱面，并把最后的决定权交给你的编辑器。</p>
        <button class="primary-button large" @click="uploadOpen = true"><Plus :size="19" />上传一首歌<ArrowRight :size="18" /></button>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="orb" />
        <div class="lane-preview">
          <div v-for="lane in 4" :key="lane" class="preview-lane">
            <i v-for="note in lane + 1" :key="note" :style="{ '--delay': `${(note + lane) * -0.7}s` }" />
          </div>
          <span class="hit-line" />
        </div>
        <div class="bpm-chip"><small>ANALYSIS ENGINE</small><strong>VARIABLE BPM</strong><span>READY</span></div>
      </div>
    </section>

    <section class="library-section">
      <header class="section-header">
        <div><span class="eyebrow">YOUR LIBRARY</span><h2>本地曲库</h2></div>
        <div class="library-stats"><span><b>{{ songs.length }}</b> 首歌曲</span><span><b>{{ totalCharts }}</b> 张谱面</span></div>
      </header>

      <div v-if="error" class="alert error"><span>{{ error }}</span><button @click="error = ''"><X :size="16" /></button></div>

      <div v-if="activeJob && !['complete'].includes(activeJob.status)" class="job-banner" :class="activeJob.status">
        <div class="job-icon"><RefreshCw :size="20" :class="{ spin: activeJob.status !== 'failed' }" /></div>
        <div><strong>{{ activeJob.stage }}</strong><span>{{ activeJob.error || '分析器正在把音频转换为可编辑的节拍数据' }}</span></div>
        <div class="progress-track"><i :style="{ width: `${activeJob.progress}%` }" /></div><b>{{ activeJob.progress }}%</b>
      </div>

      <div v-if="loading" class="song-grid skeleton-grid"><div v-for="item in 3" :key="item" class="song-card skeleton" /></div>
      <div v-else-if="!songs.length" class="empty-state">
        <div class="empty-icon"><Music2 :size="34" /></div><h3>曲库还是安静的</h3><p>从一首你熟悉的歌开始，几分钟后就能进入第一局。</p>
        <button class="secondary-button" @click="uploadOpen = true"><UploadCloud :size="17" />选择音频</button>
      </div>
      <div v-else class="song-grid">
        <article v-for="(song, index) in songs" :key="song.id" class="song-card">
          <div class="cover" :class="`cover-${(index % 4) + 1}`"><FileAudio :size="26" /><span>{{ formatDuration(song.durationMs) }}</span></div>
          <div class="song-main">
            <div class="song-title-row"><div><h3>{{ song.title }}</h3><p>{{ song.artist || '未知艺术家' }} · {{ song.originalName }}</p></div><span class="state" :class="song.status">{{ song.status === 'ready' ? '已就绪' : song.status === 'failed' ? '失败' : '分析中' }}</span></div>
            <div v-if="song.status === 'ready'" class="difficulty-row">
              <button v-for="difficulty in difficulties" :key="difficulty.id" :class="{ ultra: difficulty.id === 'ultra' }" @click="router.push(`/play/${song.id}/${difficulty.id}`)">
                <span>{{ difficulty.label }}</span><b>{{ song.bestScores[difficulty.id]?.score.toLocaleString() ?? '—' }}</b><Play :size="14" />
              </button>
            </div>
            <div v-else class="processing-copy"><BarChart3 :size="17" /><span>{{ song.error || '正在寻找节拍与起音…' }}</span></div>
          </div>
          <div class="song-actions">
            <button :disabled="song.status !== 'ready'" title="编辑谱面" @click="router.push(`/editor/${song.id}`)"><PencilLine :size="17" /></button>
            <button title="重新生成" @click="regenerate(song)"><RefreshCw :size="17" /></button>
            <button class="danger" title="删除歌曲" @click="removeSong(song)"><Trash2 :size="17" /></button>
          </div>
        </article>
      </div>
    </section>

    <Transition name="fade">
      <div v-if="uploadOpen" class="modal-backdrop" @mousedown.self="uploadOpen = false">
        <section class="modal-card upload-card" role="dialog" aria-modal="true" aria-label="上传歌曲">
          <header><div><span class="eyebrow">NEW TRACK</span><h2>上传歌曲</h2></div><button class="icon-button" @click="uploadOpen = false"><X /></button></header>
          <label class="drop-zone" :class="{ active: dragActive, chosen: file }" @dragover.prevent="dragActive = true" @dragleave.prevent="dragActive = false" @drop.prevent="dragActive = false; chooseFile($event.dataTransfer?.files[0])">
            <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a" @change="chooseFile(($event.target as HTMLInputElement).files?.[0])" />
            <div class="upload-icon"><UploadCloud :size="27" /></div>
            <strong>{{ file ? file.name : '拖入音频，或点击选择' }}</strong><span>MP3 / WAV / FLAC / OGG / M4A · 最大 200 MB</span>
          </label>
          <div class="form-grid"><label>歌曲名<input v-model="title" placeholder="自动读取文件名" maxlength="120" /></label><label>艺术家<input v-model="artist" placeholder="可选" maxlength="120" /></label></div>
          <div class="upload-note"><Sparkles :size="16" /><p><b>上传后会自动生成四档谱面，包含观赏级 Ultra。</b><br />分析结果只是初稿，你可以随时校准节拍并编辑音符。</p></div>
          <footer><button class="ghost-button" @click="uploadOpen = false">取消</button><button class="primary-button" :disabled="!file || uploading" @click="submitUpload">{{ uploading ? '正在上传…' : '上传并开始分析' }}</button></footer>
        </section>
      </div>
    </Transition>
  </div>
</template>
