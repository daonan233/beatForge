import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DIFFICULTIES, validateChartSet, type ChartSet, type Difficulty, type ScoreSummary } from "@beatforge/shared";
import { config } from "./config.js";
import { Database } from "./database.js";
import { JobRunner } from "./job-runner.js";
import { probeDuration } from "./media.js";

await mkdir(path.join(config.dataDir, "audio"), { recursive: true });
const database = new Database(config.dataDir);
const runner = new JobRunner(database);
const app = Fastify({ logger: true, bodyLimit: config.maxUploadBytes });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 8 } });

app.get("/api/health", async () => ({ ok: true, service: "beatforge", analyzer: "python" }));

app.get("/api/songs", async () => ({ songs: database.listSongs() }));

app.get<{ Params: { id: string } }>("/api/songs/:id", async (request, reply) => {
  const song = database.getSong(request.params.id);
  if (!song) return reply.code(404).send({ error: "歌曲不存在" });
  return { song };
});

app.post("/api/songs", async (request, reply) => {
  const upload = await request.file();
  if (!upload) return reply.code(400).send({ error: "请选择音频文件" });
  const extension = path.extname(upload.filename).toLowerCase();
  const allowedExtensions = new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a"]);
  const allowedMime = upload.mimetype.startsWith("audio/") || ["application/ogg", "application/octet-stream"].includes(upload.mimetype);
  if (!allowedExtensions.has(extension) || !allowedMime) {
    upload.file.resume();
    return reply.code(415).send({ error: "仅支持 MP3、WAV、FLAC、OGG、M4A 音频" });
  }
  const songId = randomUUID();
  const finalPath = path.join(config.dataDir, "audio", `${songId}${extension}`);
  const partPath = `${finalPath}.part`;
  try {
    await pipeline(upload.file, (await import("node:fs")).createWriteStream(partPath, { flags: "wx" }));
    if (upload.file.truncated) throw new Error("文件超过上传大小限制");
    await rename(partPath, finalPath);
    const duration = await probeDuration(finalPath, config.ffprobeBin);
    if (duration != null && duration > config.maxDurationSeconds) throw new Error("歌曲时长超过 20 分钟");
    const fields = upload.fields as Record<string, { value?: unknown }>;
    const fallbackTitle = path.basename(upload.filename, extension);
    const title = String(fields.title?.value ?? fallbackTitle).trim().slice(0, 120) || fallbackTitle;
    const artist = String(fields.artist?.value ?? "").trim().slice(0, 120);
    database.createSong({
      id: songId, title, artist, originalName: upload.filename, mimeType: upload.mimetype,
      audioPath: finalPath, durationMs: Math.round((duration ?? 0) * 1000),
    });
    const jobId = randomUUID();
    database.createJob(jobId, songId);
    return reply.code(201).send({ song: database.getSong(songId), job: database.getJob(jobId) });
  } catch (error) {
    await rm(partPath, { force: true });
    await rm(finalPath, { force: true });
    const message = error instanceof Error ? error.message : "上传失败";
    return reply.code(422).send({ error: message });
  }
});

app.get<{ Params: { id: string }; Headers: { range?: string } }>("/api/songs/:id/audio", async (request, reply) => {
  const song = database.getSongFile(request.params.id);
  if (!song || !existsSync(song.audioPath)) return reply.code(404).send({ error: "音频不存在" });
  const info = await stat(song.audioPath);
  const range = request.headers.range;
  reply.header("Accept-Ranges", "bytes").header("Content-Type", song.mimeType);
  if (!range) {
    reply.header("Content-Length", info.size);
    return reply.send(createReadStream(song.audioPath));
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return reply.code(416).send();
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
  if (start > end || start >= info.size) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
  reply.code(206).headers({ "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": end - start + 1 });
  return reply.send(createReadStream(song.audioPath, { start, end }));
});

app.post<{ Params: { id: string } }>("/api/songs/:id/generations", async (request, reply) => {
  if (!database.getSongFile(request.params.id)) return reply.code(404).send({ error: "歌曲不存在" });
  const jobId = randomUUID();
  database.createJob(jobId, request.params.id);
  database.updateSongStatus(request.params.id, "queued");
  return reply.code(202).send({ job: database.getJob(jobId) });
});

app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
  const job = database.getJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "任务不存在" });
  return { job };
});

app.get<{ Params: { id: string } }>("/api/jobs/:id/events", async (request, reply) => {
  if (!database.getJob(request.params.id)) return reply.code(404).send({ error: "任务不存在" });
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  let closed = false;
  request.raw.on("close", () => { closed = true; });
  let previous = "";
  while (!closed) {
    const job = database.getJob(request.params.id);
    if (!job) break;
    const serialized = JSON.stringify(job);
    if (serialized !== previous) {
      reply.raw.write(`event: progress\ndata: ${serialized}\n\n`);
      previous = serialized;
    }
    if (job.status === "complete" || job.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!closed) reply.raw.end();
});

app.get<{ Params: { id: string } }>("/api/songs/:id/chart-set", async (request, reply) => {
  const chartSet = database.getChartSet(request.params.id);
  if (!chartSet) return reply.code(404).send({ error: "谱面尚未生成" });
  return { chartSet };
});

app.put<{ Params: { id: string }; Body: { baseRevision?: number; document?: ChartSet } }>("/api/songs/:id/chart-set", async (request, reply) => {
  const { baseRevision, document } = request.body ?? {};
  if (!Number.isInteger(baseRevision) || !document) return reply.code(400).send({ error: "缺少谱面或基础版本" });
  const errors = validateChartSet(document);
  if (errors.length) return reply.code(422).send({ error: "谱面格式无效", details: errors });
  const result = database.updateChartSet(request.params.id, baseRevision!, structuredClone(document));
  if (result === "conflict") return reply.code(409).send({ error: "谱面已在其他页面更新，请刷新后重试" });
  if (!result) return reply.code(404).send({ error: "谱面不存在" });
  return { chartSet: result };
});

app.get<{ Params: { id: string } }>("/api/songs/:id/scores", async (request, reply) => {
  const chart = database.getChartSet(request.params.id);
  if (!chart) return reply.code(404).send({ error: "谱面不存在" });
  return { scores: database.getScores(request.params.id, chart.revision), revision: chart.revision };
});

app.post<{ Params: { id: string }; Body: { difficulty?: Difficulty; revision?: number; result?: ScoreSummary } }>("/api/songs/:id/scores", async (request, reply) => {
  const { difficulty, revision, result } = request.body ?? {};
  const chart = database.getChartSet(request.params.id);
  if (!chart) return reply.code(404).send({ error: "谱面不存在" });
  if (!difficulty || !DIFFICULTIES.includes(difficulty) || revision !== chart.revision || !result) {
    return reply.code(422).send({ error: "成绩与当前谱面版本不匹配" });
  }
  const sane = [result.score, result.accuracy, result.maxCombo, result.perfect, result.great, result.good, result.miss]
    .every((value) => Number.isFinite(value) && value >= 0);
  if (!sane || result.score > 1_000_000 || result.accuracy > 100) return reply.code(422).send({ error: "成绩数据无效" });
  return { best: database.upsertBestScore(request.params.id, difficulty, revision, result) };
});

app.delete<{ Params: { id: string } }>("/api/songs/:id", async (request, reply) => {
  const song = database.getSongFile(request.params.id);
  if (!song) return reply.code(404).send({ error: "歌曲不存在" });
  database.deleteSong(request.params.id);
  await rm(song.audioPath, { force: true });
  return reply.code(204).send();
});

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const webDist = path.join(repoRoot, "apps", "web", "dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")
    ? reply.code(404).send({ error: "接口不存在" })
    : reply.sendFile("index.html"));
}

runner.start();
const close = async () => { runner.stop(); database.close(); await app.close(); };
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ port: config.port, host: config.host });
