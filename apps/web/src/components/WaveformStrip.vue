<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{ peaks: number[]; progress: number; loopStart?: number; loopEnd?: number }>();
const emit = defineEmits<{ seek: [ratio: number] }>();
const canvas = ref<HTMLCanvasElement>();
let observer: ResizeObserver | undefined;

function draw() {
  const element = canvas.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  element.width = Math.max(1, Math.round(rect.width * ratio));
  element.height = Math.max(1, Math.round(rect.height * ratio));
  const context = element.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = "#15181f";
  context.fillRect(0, 0, rect.width, rect.height);
  if (props.loopStart != null && props.loopEnd != null) {
    context.fillStyle = "rgba(198, 255, 79, .08)";
    context.fillRect(props.loopStart * rect.width, 0, (props.loopEnd - props.loopStart) * rect.width, rect.height);
  }
  const width = rect.width / Math.max(1, props.peaks.length);
  props.peaks.forEach((peak, index) => {
    const height = Math.max(1, peak * rect.height * 0.78);
    const x = index * width;
    context.fillStyle = index / props.peaks.length <= props.progress ? "#c6ff4f" : "#4b5361";
    context.fillRect(x, (rect.height - height) / 2, Math.max(1, width - 0.5), height);
  });
  context.fillStyle = "#fff";
  context.fillRect(props.progress * rect.width - 1, 0, 2, rect.height);
}

function seek(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  emit("seek", Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
}

watch(() => [props.peaks, props.progress, props.loopStart, props.loopEnd], draw, { deep: true });
onMounted(() => { observer = new ResizeObserver(draw); observer.observe(canvas.value!); draw(); });
onUnmounted(() => observer?.disconnect());
</script>

<template><canvas ref="canvas" class="waveform-strip" @pointerdown="seek" /></template>
