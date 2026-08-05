import { spawn } from "node:child_process";

export async function probeDuration(filePath: string, ffprobeBin: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobeBin, ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolve(null);
      else reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || "无法读取音频信息"));
      try {
        const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
        const seconds = Number(parsed.format?.duration);
        if (!Number.isFinite(seconds) || seconds <= 0) reject(new Error("音频时长无效"));
        else resolve(seconds);
      } catch {
        reject(new Error("音频信息格式无效"));
      }
    });
  });
}
