<script setup lang="ts">
import { Application, Container, Graphics, Text } from "pixi.js";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { approachDurationMs, perspectiveProgress } from "../game/scroll";

export interface GameRenderNote {
  id: string;
  lane: number;
  type: "tap" | "hold";
  startMs: number;
  endMs?: number;
  status: string;
}

const props = defineProps<{
  notes: GameRenderNote[];
  currentTimeMs: number;
  speed: number;
  pressed: boolean[];
  keyLabels: string[];
  judgement: string;
}>();

const host = ref<HTMLDivElement>();
let pixi: Application | undefined;
let layer: Container | undefined;
let observer: ResizeObserver | undefined;

function render() {
  if (!pixi || !layer || !host.value) return;
  for (const child of layer.removeChildren()) child.destroy();
  const width = host.value.clientWidth;
  const height = host.value.clientHeight;
  const targetY = height - 92;
  const topY = 62;
  const approachMs = approachDurationMs(props.speed);
  const laneColors = [0xc6ff4f, 0x72e6ff, 0xff7a9e, 0xc89bff];
  const centerX = width / 2;
  const topHalf = width * 0.17;
  const bottomHalf = width * 0.5;

  const depthForTime = (timeMs: number) => Math.max(0, Math.min(1.06, 1 - (timeMs - props.currentTimeMs) / approachMs));
  const yAt = (depth: number) => topY + perspectiveProgress(depth) * (targetY - topY);
  const halfWidthAt = (depth: number) => topHalf + perspectiveProgress(depth) * (bottomHalf - topHalf);
  const laneEdge = (laneEdgeIndex: number, depth: number) => centerX - halfWidthAt(depth) + halfWidthAt(depth) * 2 * laneEdgeIndex / 4;
  const laneQuad = (lane: number, farDepth: number, nearDepth: number, inset = 0) => [
    laneEdge(lane, farDepth) + inset * Math.max(.25, farDepth), yAt(farDepth),
    laneEdge(lane + 1, farDepth) - inset * Math.max(.25, farDepth), yAt(farDepth),
    laneEdge(lane + 1, nearDepth) - inset * Math.max(.25, nearDepth), yAt(nearDepth),
    laneEdge(lane, nearDepth) + inset * Math.max(.25, nearDepth), yAt(nearDepth),
  ];

  layer.addChild(new Graphics().rect(0, 0, width, height).fill({ color: 0x05060a }));
  layer.addChild(new Graphics().circle(centerX, topY - 7, width * .38).fill({ color: 0x593b83, alpha: .08 }));
  layer.addChild(new Graphics().rect(0, topY - 2, width, 4).fill({ color: 0x72e6ff, alpha: .22 }));
  layer.addChild(new Graphics().poly([
    centerX - topHalf, topY, centerX + topHalf, topY,
    centerX + bottomHalf, targetY, centerX - bottomHalf, targetY,
  ]).fill({ color: 0x0c1019 }).stroke({ color: 0x8893a1, width: 1, alpha: .38 }));

  for (let lane = 0; lane < 4; lane += 1) {
    layer.addChild(new Graphics().poly(laneQuad(lane, 0, 1)).fill({ color: lane % 2 ? 0x111725 : 0x0b111c, alpha: .94 }));
    if (props.pressed[lane]) {
      layer.addChild(new Graphics().poly(laneQuad(lane, .76, 1, 2)).fill({ color: laneColors[lane], alpha: .22 }));
    }
  }

  const gridInterval = 400;
  const gridPhase = ((props.currentTimeMs % gridInterval) + gridInterval) % gridInterval;
  for (let futureMs = gridInterval - gridPhase; futureMs < approachMs; futureMs += gridInterval) {
    const depth = 1 - futureMs / approachMs;
    const y = yAt(depth);
    layer.addChild(new Graphics().moveTo(laneEdge(0, depth), y).lineTo(laneEdge(4, depth), y)
      .stroke({ color: 0x6f7f96, width: .7 + depth, alpha: .11 + depth * .16 }));
  }
  for (let edge = 0; edge <= 4; edge += 1) {
    layer.addChild(new Graphics().moveTo(laneEdge(edge, 0), topY).lineTo(laneEdge(edge, 1), targetY)
      .stroke({ color: edge === 0 || edge === 4 ? 0xa4b4c9 : 0x596778, width: edge === 0 || edge === 4 ? 2 : 1, alpha: .42 }));
  }

  for (const note of props.notes) {
    if (note.status === "done" || note.status === "missed") continue;
    const until = note.startMs - props.currentTimeMs;
    if (until > approachMs + 400 || until < -250) continue;
    const color = laneColors[note.lane];
    if (note.type === "hold" && note.endMs != null) {
      const headDepth = note.status === "holding" ? 1 : depthForTime(note.startMs);
      const tailDepth = depthForTime(note.endMs);
      if (tailDepth >= 0 && headDepth >= 0) {
        const farDepth = Math.min(headDepth, tailDepth);
        const nearDepth = Math.max(headDepth, tailDepth);
        const ribbon = laneQuad(note.lane, farDepth, nearDepth, 11);
        layer.addChild(new Graphics().poly(ribbon).fill({ color, alpha: .20 }).stroke({ color, width: 1.4, alpha: .62 }));
        const tailThickness = .015 + tailDepth * .025;
        layer.addChild(new Graphics().poly(laneQuad(note.lane, Math.max(0, tailDepth - tailThickness), tailDepth, 5))
          .fill({ color, alpha: .82 }));
      }
    }
    const depth = note.status === "holding" ? 1 : depthForTime(note.startMs);
    if (depth < 0 || depth > 1.08) continue;
    const thickness = .018 + Math.min(1, depth) * .035;
    const farDepth = Math.max(0, depth - thickness);
    const noteShape = laneQuad(note.lane, farDepth, Math.min(1.04, depth), 5);
    layer.addChild(new Graphics().poly(laneQuad(note.lane, Math.max(0, farDepth - .012), Math.min(1.05, depth + .012), 1))
      .fill({ color, alpha: .13 }));
    layer.addChild(new Graphics().poly(noteShape).fill({ color }).stroke({ color: 0xffffff, alpha: .64, width: 1.2 + depth * 1.3 }));
  }

  layer.addChild(new Graphics().moveTo(0, targetY).lineTo(width, targetY).stroke({ color: 0xffffff, width: 4, alpha: .95 }));
  layer.addChild(new Graphics().moveTo(0, targetY + 6).lineTo(width, targetY + 6).stroke({ color: 0x72e6ff, width: 2, alpha: .22 }));
  for (let lane = 0; lane < 4; lane += 1) {
    const key = new Text({ text: props.keyLabels[lane] ?? "?", style: { fill: props.pressed[lane] ? laneColors[lane] : 0x9ba3af, fontFamily: "Inter, sans-serif", fontWeight: "700", fontSize: 17 } });
    key.anchor.set(0.5); key.x = (laneEdge(lane, 1) + laneEdge(lane + 1, 1)) / 2; key.y = height - 39; layer.addChild(key);
  }
  if (props.judgement) {
    const colors: Record<string, number> = { PERFECT: 0xc6ff4f, GREAT: 0x72e6ff, GOOD: 0xffc061, MISS: 0xff5e73 };
    const label = new Text({ text: props.judgement, style: { fill: colors[props.judgement] ?? 0xffffff, fontFamily: "Inter, sans-serif", fontWeight: "900", fontSize: 30, letterSpacing: 3 } });
    label.anchor.set(0.5); label.x = width / 2; label.y = targetY - 72; layer.addChild(label);
  }
}

onMounted(async () => {
  pixi = new Application();
  await pixi.init({ resizeTo: host.value, backgroundAlpha: 0, antialias: true, preference: "webgl" });
  pixi.canvas.className = "pixi-canvas";
  host.value!.appendChild(pixi.canvas);
  layer = new Container(); pixi.stage.addChild(layer);
  observer = new ResizeObserver(render); observer.observe(host.value!); render();
});
watch(props, render, { deep: true });
onUnmounted(() => { observer?.disconnect(); pixi?.destroy(true, { children: true }); });
</script>

<template><div ref="host" class="game-board" /></template>
