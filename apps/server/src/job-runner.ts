import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChartSet } from "@beatforge/shared";
import type { Database } from "./database.js";
import { config } from "./config.js";

interface AnalyzerResult {
  chartSet: ChartSet;
  analysis: { bpm: number; confidence: number; durationMs: number; waveform: number[]; warnings: string[] };
}

export class JobRunner {
  private busy = false;
  private timer?: NodeJS.Timeout;

  constructor(private database: Database) {}

  start() {
    this.database.recoverJobs();
    this.timer = setInterval(() => void this.tick(), 600);
    this.timer.unref();
    void this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.busy) return;
    const job = this.database.getNextQueuedJob();
    if (!job) return;
    const song = this.database.getSongFile(job.songId);
    if (!song) {
      this.database.updateJob(job.id, { status: "failed", error: "歌曲不存在", stage: "失败" });
      return;
    }
    this.busy = true;
    this.database.updateJob(job.id, { status: "running", progress: 1, stage: "准备音频", error: null });
    this.database.updateSongStatus(job.songId, "analyzing");
    const taskDir = await mkdtemp(path.join(tmpdir(), "beatforge-"));
    const outputPath = path.join(taskDir, "result.json");
    try {
      const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
      const script = path.join(repoRoot, "services", "analyzer", "analyze.py");
      await this.runProcess(script, song.audioPath, outputPath, job.id, job.songId);
      const result = JSON.parse(await readFile(outputPath, "utf8")) as AnalyzerResult;
      this.database.saveGeneratedResult(job.songId, result.chartSet, result.analysis);
      this.database.updateJob(job.id, { status: "complete", progress: 100, stage: "谱面已生成", error: null });
      this.database.updateSongStatus(job.songId, "ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知分析错误";
      this.database.updateJob(job.id, { status: "failed", stage: "分析失败", error: message });
      this.database.updateSongStatus(job.songId, "failed", message);
    } finally {
      await rm(taskDir, { recursive: true, force: true });
      this.busy = false;
    }
  }

  private runProcess(script: string, input: string, output: string, jobId: string, songId: string) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(config.pythonBin, [script, "--input", input, "--output", output, "--song-id", songId,
        "--ffmpeg", config.ffmpegBin, "--max-duration-seconds", String(config.maxDurationSeconds)]);
      let stdoutBuffer = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as { progress?: number; stage?: string };
            this.database.updateJob(jobId, { progress: event.progress, stage: event.stage });
          } catch { /* ignore non-protocol output */ }
        }
      });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `分析进程退出码 ${code}`)));
    });
  }
}
