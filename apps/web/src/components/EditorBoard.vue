<script setup lang="ts">
import { Application, Container, Graphics, Text } from "pixi.js";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { ChartNote, TimingAnchor } from "@beatforge/shared";
import { snapBeat } from "@beatforge/shared";

const props = defineProps<{
  notes: ChartNote[];
  anchors: TimingAnchor[];
  currentBeat: number;
  snap: number;
  selectedIds: string[];
  tool: "tap" | "hold" | "select";
  visibleBeats: number;
}>();
const emit = defineEmits<{
  add: [lane: 0 | 1 | 2 | 3, beat: number, type: "tap" | "hold"];
  select: [id: string, additive: boolean];
  clearSelection: [];
  move: [id: string, lane: 0 | 1 | 2 | 3, beat: number];
}>();

const host = ref<HTMLDivElement>();
let pixi: Application | undefined;
let layer: Container | undefined;
let observer: ResizeObserver | undefined;
let dragging: { id: string; pointerId: number } | null = null;

function geometry() {
  const width = host.value?.clientWidth ?? 800;
  const height = host.value?.clientHeight ?? 600;
  const gutter = 58;
  const laneWidth = (width - gutter) / 4;
  const startBeat = props.currentBeat - 3;
  return { width, height, gutter, laneWidth, startBeat };
}

function beatToY(beat: number) {
  const { height, startBeat } = geometry();
  return height - ((beat - startBeat) / props.visibleBeats) * height;
}

function pointToPosition(clientX: number, clientY: number) {
  const rect = pixi!.canvas.getBoundingClientRect();
  const { height, gutter, laneWidth, startBeat } = geometry();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const lane = Math.max(0, Math.min(3, Math.floor((x - gutter) / laneWidth))) as 0 | 1 | 2 | 3;
  const rawBeat = startBeat + ((height - y) / height) * props.visibleBeats;
  return { lane, beat: Math.max(0, snapBeat(rawBeat, props.snap)), x, y };
}

function noteAt(lane: number, beat: number) {
  const tolerance = Math.max(0.18, props.snap * 0.55);
  return props.notes.filter((note) => note.lane === lane && Math.abs(note.beat - beat) <= tolerance)
    .sort((a, b) => Math.abs(a.beat - beat) - Math.abs(b.beat - beat))[0];
}

function onPointerDown(event: PointerEvent) {
  const position = pointToPosition(event.clientX, event.clientY);
  if (position.x < geometry().gutter) { emit("clearSelection"); return; }
  const hit = noteAt(position.lane, position.beat);
  if (hit) {
    emit("select", hit.id, event.ctrlKey || event.metaKey || event.shiftKey);
    dragging = { id: hit.id, pointerId: event.pointerId };
    pixi!.canvas.setPointerCapture(event.pointerId);
  } else if (props.tool !== "select") {
    emit("add", position.lane, position.beat, props.tool);
  } else emit("clearSelection");
}

function onPointerUp(event: PointerEvent) {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  const position = pointToPosition(event.clientX, event.clientY);
  emit("move", dragging.id, position.lane, position.beat);
  dragging = null;
}

function render() {
  if (!pixi || !layer) return;
  for (const child of layer.removeChildren()) child.destroy();
  const { width, height, gutter, laneWidth, startBeat } = geometry();
  const background = new Graphics().rect(0, 0, width, height).fill({ color: 0x0d0f14 });
  layer.addChild(background);
  for (let lane = 0; lane < 4; lane += 1) {
    const fill = lane % 2 ? 0x12151c : 0x0f1218;
    layer.addChild(new Graphics().rect(gutter + lane * laneWidth, 0, laneWidth, height).fill({ color: fill }));
    layer.addChild(new Graphics().moveTo(gutter + lane * laneWidth, 0).lineTo(gutter + lane * laneWidth, height).stroke({ color: 0x2b303a, width: 1 }));
  }
  layer.addChild(new Graphics().moveTo(width - 1, 0).lineTo(width - 1, height).stroke({ color: 0x2b303a, width: 1 }));

  const firstGrid = Math.floor(startBeat / props.snap) * props.snap;
  for (let beat = firstGrid; beat <= startBeat + props.visibleBeats + props.snap; beat += props.snap) {
    if (beat < 0) continue;
    const y = beatToY(beat);
    const major = Math.abs(beat - Math.round(beat)) < 0.001;
    layer.addChild(new Graphics().moveTo(gutter, y).lineTo(width, y).stroke({ color: major ? 0x4b5361 : 0x282d36, width: major ? 1.4 : 0.7, alpha: major ? 0.9 : 0.55 }));
    if (major) {
      const label = new Text({ text: String(Math.round(beat) + 1), style: { fill: 0x7d8591, fontFamily: "Inter, sans-serif", fontSize: 11 } });
      label.x = 16; label.y = y - 7; layer.addChild(label);
      if (Math.round(beat) % 4 === 0) layer.addChild(new Graphics().rect(gutter - 5, y - 2, 5, 4).fill({ color: 0xc6ff4f }));
    }
  }

  const playheadY = beatToY(props.currentBeat);
  layer.addChild(new Graphics().rect(gutter, playheadY - 1, width - gutter, 2).fill({ color: 0xffffff, alpha: 0.82 }));

  for (const note of props.notes) {
    if (note.beat < startBeat - 1 || note.beat > startBeat + props.visibleBeats + 1) continue;
    const x = gutter + note.lane * laneWidth + 8;
    const y = beatToY(note.beat);
    const selected = props.selectedIds.includes(note.id);
    const color = selected ? 0xffffff : [0xc6ff4f, 0x72e6ff, 0xff7a9e, 0xc89bff][note.lane];
    if (note.type === "hold" && note.endBeat != null) {
      const endY = beatToY(note.endBeat);
      layer.addChild(new Graphics().roundRect(x + laneWidth * 0.34, endY, laneWidth * 0.16, y - endY, 5).fill({ color, alpha: 0.48 }));
      layer.addChild(new Graphics().roundRect(x, endY - 5, laneWidth - 16, 10, 4).fill({ color, alpha: 0.85 }));
    }
    layer.addChild(new Graphics().roundRect(x, y - 8, laneWidth - 16, 16, 5).fill({ color }).stroke({ color: selected ? 0xc6ff4f : color, width: selected ? 3 : 1 }));
  }
}

onMounted(async () => {
  pixi = new Application();
  await pixi.init({ resizeTo: host.value, backgroundAlpha: 0, antialias: true, preference: "webgl" });
  pixi.canvas.className = "pixi-canvas";
  host.value!.appendChild(pixi.canvas);
  layer = new Container();
  pixi.stage.addChild(layer);
  pixi.canvas.addEventListener("pointerdown", onPointerDown);
  pixi.canvas.addEventListener("pointerup", onPointerUp);
  observer = new ResizeObserver(() => render());
  observer.observe(host.value!);
  render();
});
watch(props, render, { deep: true });
onUnmounted(() => {
  observer?.disconnect();
  if (pixi) {
    pixi.canvas.removeEventListener("pointerdown", onPointerDown);
    pixi.canvas.removeEventListener("pointerup", onPointerUp);
    pixi.destroy(true, { children: true });
  }
});
</script>

<template><div ref="host" class="editor-board" /></template>
