<script setup lang="ts">
import { Application, Container, Graphics, Text } from "pixi.js";
import { onMounted, onUnmounted, ref } from "vue";
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
  timeSource: () => number;
  speed: number;
  pressed: boolean[];
  keyLabels: string[];
  judgement: string;
}>();

const host = ref<HTMLDivElement>();
let pixi: Application | undefined;
let layer: Container | undefined;
let staticGraphics: Graphics | undefined;
let dynamicGraphics: Graphics | undefined;
let keyTexts: Text[] = [];
let judgementText: Text | undefined;
let observer: ResizeObserver | undefined;
let lastMetricsUpdate = 0;
let width = 0;
let height = 0;
let targetY = 0;
let topY = 62;
let centerX = 0;
let topHalf = 0;
let bottomHalf = 0;
const laneColors = [0xc6ff4f, 0x72e6ff, 0xff7a9e, 0xc89bff];
const judgementColors: Record<string, number> = {
  PERFECT: 0xc6ff4f, GREAT: 0x72e6ff, GOOD: 0xffc061, MISS: 0xff5e73,
};

function yAt(depth: number) {
  return topY + perspectiveProgress(depth) * (targetY - topY);
}

function halfWidthAt(depth: number) {
  return topHalf + perspectiveProgress(depth) * (bottomHalf - topHalf);
}

function laneEdge(laneEdgeIndex: number, depth: number) {
  const halfWidth = halfWidthAt(depth);
  return centerX - halfWidth + halfWidth * 2 * laneEdgeIndex / 4;
}

function laneQuad(lane: number, farDepth: number, nearDepth: number, inset = 0) {
  return [
    laneEdge(lane, farDepth) + inset * Math.max(.25, farDepth), yAt(farDepth),
    laneEdge(lane + 1, farDepth) - inset * Math.max(.25, farDepth), yAt(farDepth),
    laneEdge(lane + 1, nearDepth) - inset * Math.max(.25, nearDepth), yAt(nearDepth),
    laneEdge(lane, nearDepth) + inset * Math.max(.25, nearDepth), yAt(nearDepth),
  ];
}

function drawStaticScene() {
  if (!staticGraphics || !width || !height) return;
  const graphics = staticGraphics.clear();
  graphics.rect(0, 0, width, height).fill({ color: 0x05060a });
  graphics.circle(centerX, topY - 7, width * .38).fill({ color: 0x593b83, alpha: .08 });
  graphics.rect(0, topY - 2, width, 4).fill({ color: 0x72e6ff, alpha: .22 });
  graphics.poly([
    centerX - topHalf, topY, centerX + topHalf, topY,
    centerX + bottomHalf, targetY, centerX - bottomHalf, targetY,
  ]).fill({ color: 0x0c1019 }).stroke({ color: 0x8893a1, width: 1, alpha: .38 });

  for (let lane = 0; lane < 4; lane += 1) {
    graphics.poly(laneQuad(lane, 0, 1)).fill({
      color: lane % 2 ? 0x111725 : 0x0b111c, alpha: .94,
    });
  }
  for (let edge = 0; edge <= 4; edge += 1) {
    graphics.moveTo(laneEdge(edge, 0), topY).lineTo(laneEdge(edge, 1), targetY).stroke({
      color: edge === 0 || edge === 4 ? 0xa4b4c9 : 0x596778,
      width: edge === 0 || edge === 4 ? 2 : 1, alpha: .42,
    });
  }
  graphics.moveTo(0, targetY).lineTo(width, targetY).stroke({ color: 0xffffff, width: 4, alpha: .95 });
  graphics.moveTo(0, targetY + 6).lineTo(width, targetY + 6).stroke({ color: 0x72e6ff, width: 2, alpha: .22 });

  for (let lane = 0; lane < keyTexts.length; lane += 1) {
    const key = keyTexts[lane];
    key.x = (laneEdge(lane, 1) + laneEdge(lane + 1, 1)) / 2;
    key.y = height - 39;
  }
  if (judgementText) {
    judgementText.x = width / 2;
    judgementText.y = targetY - 72;
  }
}

function layout() {
  if (!host.value) return;
  width = host.value.clientWidth;
  height = host.value.clientHeight;
  targetY = height - 92;
  centerX = width / 2;
  topHalf = width * .17;
  bottomHalf = width * .5;
  drawStaticScene();
}

function drawFrame() {
  if (!dynamicGraphics || !width || !height) return;
  const graphics = dynamicGraphics.clear();
  const currentTimeMs = props.timeSource();
  const approachMs = approachDurationMs(props.speed);
  const depthForTime = (timeMs: number) => Math.max(0, Math.min(1.06, 1 - (timeMs - currentTimeMs) / approachMs));

  for (let lane = 0; lane < 4; lane += 1) {
    if (props.pressed[lane]) {
      graphics.poly(laneQuad(lane, .76, 1, 2)).fill({ color: laneColors[lane], alpha: .22 });
    }
    const key = keyTexts[lane];
    const label = props.keyLabels[lane] ?? "?";
    if (key.text !== label) key.text = label;
    const fill = props.pressed[lane] ? laneColors[lane] : 0x9ba3af;
    if (key.style.fill !== fill) key.style.fill = fill;
  }

  const gridInterval = 400;
  const gridPhase = ((currentTimeMs % gridInterval) + gridInterval) % gridInterval;
  for (let futureMs = gridInterval - gridPhase; futureMs < approachMs; futureMs += gridInterval) {
    const depth = 1 - futureMs / approachMs;
    const y = yAt(depth);
    graphics.moveTo(laneEdge(0, depth), y).lineTo(laneEdge(4, depth), y).stroke({
      color: 0x6f7f96, width: .7 + depth, alpha: .11 + depth * .16,
    });
  }

  for (const note of props.notes) {
    if (note.status === "done" || note.status === "missed") continue;
    const until = note.startMs - currentTimeMs;
    if (until > approachMs + 400 || (until < -250 && note.status !== "holding")) continue;
    const color = laneColors[note.lane];
    if (note.type === "hold" && note.endMs != null) {
      const headDepth = note.status === "holding" ? 1 : depthForTime(note.startMs);
      const tailDepth = depthForTime(note.endMs);
      if (tailDepth >= 0 && headDepth >= 0) {
        const farDepth = Math.min(headDepth, tailDepth);
        const nearDepth = Math.max(headDepth, tailDepth);
        graphics.poly(laneQuad(note.lane, farDepth, nearDepth, 11))
          .fill({ color, alpha: .20 }).stroke({ color, width: 1.4, alpha: .62 });
        const tailThickness = .015 + tailDepth * .025;
        graphics.poly(laneQuad(note.lane, Math.max(0, tailDepth - tailThickness), tailDepth, 5))
          .fill({ color, alpha: .82 });
      }
    }
    const depth = note.status === "holding" ? 1 : depthForTime(note.startMs);
    if (depth < 0 || depth > 1.08) continue;
    const thickness = .018 + Math.min(1, depth) * .035;
    const farDepth = Math.max(0, depth - thickness);
    graphics.poly(laneQuad(note.lane, Math.max(0, farDepth - .012), Math.min(1.05, depth + .012), 1))
      .fill({ color, alpha: .13 });
    graphics.poly(laneQuad(note.lane, farDepth, Math.min(1.04, depth), 5))
      .fill({ color }).stroke({ color: 0xffffff, alpha: .64, width: 1.2 + depth * 1.3 });
  }

  if (judgementText) {
    judgementText.visible = Boolean(props.judgement);
    if (props.judgement && judgementText.text !== props.judgement) {
      judgementText.text = props.judgement;
      judgementText.style.fill = judgementColors[props.judgement] ?? 0xffffff;
    }
  }
  if (pixi && host.value && pixi.ticker.lastTime - lastMetricsUpdate >= 500) {
    host.value.dataset.renderFps = pixi.ticker.FPS.toFixed(1);
    host.value.dataset.sceneObjects = String(layer?.children.length ?? 0);
    lastMetricsUpdate = pixi.ticker.lastTime;
  }
}

onMounted(async () => {
  pixi = new Application();
  await pixi.init({
    resizeTo: host.value, backgroundAlpha: 0, antialias: true,
    preference: "webgl", powerPreference: "high-performance",
  });
  pixi.canvas.className = "pixi-canvas";
  host.value!.appendChild(pixi.canvas);
  layer = new Container();
  staticGraphics = new Graphics();
  dynamicGraphics = new Graphics();
  layer.addChild(staticGraphics, dynamicGraphics);
  keyTexts = Array.from({ length: 4 }, (_, lane) => {
    const key = new Text({
      text: props.keyLabels[lane] ?? "?",
      style: { fill: 0x9ba3af, fontFamily: "Inter, sans-serif", fontWeight: "700", fontSize: 17 },
    });
    key.anchor.set(.5);
    layer!.addChild(key);
    return key;
  });
  judgementText = new Text({
    text: "", style: { fill: 0xffffff, fontFamily: "Inter, sans-serif", fontWeight: "900", fontSize: 30, letterSpacing: 3 },
  });
  judgementText.anchor.set(.5);
  judgementText.visible = false;
  layer.addChild(judgementText);
  pixi.stage.addChild(layer);
  pixi.ticker.maxFPS = 0;
  pixi.ticker.add(drawFrame);
  observer = new ResizeObserver(layout);
  observer.observe(host.value!);
  layout();
  drawFrame();
});

onUnmounted(() => {
  observer?.disconnect();
  pixi?.ticker.remove(drawFrame);
  pixi?.destroy(true, { children: true });
});
</script>

<template><div ref="host" class="game-board" /></template>
