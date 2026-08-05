import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const localPython = path.join(repoRoot, ".venv", "Scripts", "python.exe");

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, "data")),
  pythonBin: process.env.PYTHON_BIN || (existsSync(localPython) ? localPython : "python"),
  ffmpegBin: process.env.FFMPEG_BIN ?? "",
  ffprobeBin: process.env.FFPROBE_BIN ?? "ffprobe",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
  maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 1200),
};
