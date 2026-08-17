<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { approachDurationMs, perspectiveProgress } from "../game/scroll";

const props = defineProps<{ speed: number }>();
const durationMs = computed(() => approachDurationMs(props.speed));
const durationLabel = computed(() => (durationMs.value / 1000).toFixed(2));
const frameTime = ref(0);
let animationFrame = 0;

// These proportions mirror GameBoard's perspective geometry.
const width = 600;
const topY = 16;
const targetY = 278;
const centerX = width / 2;
const topHalf = width * .17;
const bottomHalf = width * .5;
const gridDepths = [.14, .28, .42, .56, .7, .84];
const laneColors = ["#c6ff4f", "#72e6ff", "#ff7a9e", "#c89bff"];
const previewNotes = [
  { lane: 1, phase: .18 },
  { lane: 3, phase: .68 },
];

function yAt(depth: number) {
  return topY + perspectiveProgress(depth) * (targetY - topY);
}

function halfWidthAt(depth: number) {
  return topHalf + perspectiveProgress(depth) * (bottomHalf - topHalf);
}

function laneEdge(edge: number, depth: number) {
  const halfWidth = halfWidthAt(depth);
  return centerX - halfWidth + halfWidth * 2 * edge / 4;
}

function laneQuad(lane: number, farDepth: number, nearDepth: number, inset = 0) {
  const points = [
    laneEdge(lane, farDepth) + inset * Math.max(.25, farDepth), yAt(farDepth),
    laneEdge(lane + 1, farDepth) - inset * Math.max(.25, farDepth), yAt(farDepth),
    laneEdge(lane + 1, nearDepth) - inset * Math.max(.25, nearDepth), yAt(nearDepth),
    laneEdge(lane, nearDepth) + inset * Math.max(.25, nearDepth), yAt(nearDepth),
  ];
  return points.map((value) => value.toFixed(2)).join(" ");
}

function notePolygon(note: { lane: number; phase: number }) {
  const elapsed = frameTime.value / Math.max(1, durationMs.value);
  const depth = (elapsed + note.phase) % 1;
  const thickness = .018 + depth * .035;
  const farDepth = Math.max(0, depth - thickness);
  return laneQuad(note.lane, farDepth, depth, 5);
}

function tick(time: number) {
  frameTime.value = time;
  animationFrame = requestAnimationFrame(tick);
}

onMounted(() => { animationFrame = requestAnimationFrame(tick); });
onBeforeUnmount(() => cancelAnimationFrame(animationFrame));
</script>

<template>
  <div class="speed-preview" aria-label="当前下落速度预览">
    <div class="speed-preview-copy">
      <span>LIVE PREVIEW</span>
      <b>{{ durationLabel }} 秒</b>
      <small>音符从出现到判定线的时间</small>
    </div>
    <div class="speed-preview-stage">
      <svg class="speed-preview-road" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id="preview-note-glow" x="-30%" y="-80%" width="160%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <polygon :points="`${laneEdge(0, 0)},${yAt(0)} ${laneEdge(4, 0)},${yAt(0)} ${laneEdge(4, 1)},${yAt(1)} ${laneEdge(0, 1)},${yAt(1)}`" fill="#0c1019" stroke="#8893a1" stroke-opacity=".45" />
        <polygon v-for="lane in 4" :key="`lane-${lane}`" :points="laneQuad(lane - 1, 0, 1)" :fill="lane % 2 ? '#111725' : '#0b111c'" fill-opacity=".94" />
        <line v-for="edge in 5" :key="`edge-${edge}`" :x1="laneEdge(edge - 1, 0)" :y1="yAt(0)" :x2="laneEdge(edge - 1, 1)" :y2="yAt(1)" stroke="#68778a" :stroke-width="edge === 1 || edge === 5 ? 2 : 1" stroke-opacity=".55" />
        <line v-for="depth in gridDepths" :key="depth" :x1="laneEdge(0, depth)" :y1="yAt(depth)" :x2="laneEdge(4, depth)" :y2="yAt(depth)" stroke="#6f7f96" stroke-opacity=".23" />

        <polygon
          v-for="note in previewNotes"
          :key="note.lane"
          class="speed-preview-svg-note"
          :points="notePolygon(note)"
          :fill="laneColors[note.lane]"
          stroke="#fff"
          stroke-opacity=".72"
          stroke-width="1.5"
          filter="url(#preview-note-glow)"
        />

        <line x1="0" :y1="targetY" x2="600" :y2="targetY" stroke="#fff" stroke-width="5" />
        <line x1="0" :y1="targetY + 7" x2="600" :y2="targetY + 7" stroke="#72e6ff" stroke-width="2" stroke-opacity=".25" />
        <text x="582" :y="targetY - 10" text-anchor="end" fill="#89939e" font-size="10" letter-spacing="2">TAP</text>
      </svg>
    </div>
  </div>
</template>
