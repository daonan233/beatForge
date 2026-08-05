import type { AnalysisJob, ChartSet, Difficulty, ScoreSummary, SongDetail, SongSummary } from "@beatforge/shared";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: string[]) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as { error?: string; details?: string[] } & T;
  if (!response.ok) throw new ApiError(data.error ?? "请求失败", response.status, data.details);
  return data;
}

export const api = {
  listSongs: () => request<{ songs: SongSummary[] }>("/api/songs"),
  getSong: (id: string) => request<{ song: SongDetail }>(`/api/songs/${id}`),
  getChart: (id: string) => request<{ chartSet: ChartSet }>(`/api/songs/${id}/chart-set`),
  uploadSong: (file: File, title: string, artist: string) => {
    const body = new FormData();
    body.append("title", title);
    body.append("artist", artist);
    body.append("file", file);
    return request<{ song: SongDetail; job: AnalysisJob }>("/api/songs", { method: "POST", body });
  },
  regenerate: (id: string) => request<{ job: AnalysisJob }>(`/api/songs/${id}/generations`, { method: "POST" }),
  saveChart: (id: string, baseRevision: number, document: ChartSet) => request<{ chartSet: ChartSet }>(
    `/api/songs/${id}/chart-set`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision, document }),
    },
  ),
  getScores: (id: string) => request<{ scores: Partial<Record<Difficulty, ScoreSummary>>; revision: number }>(`/api/songs/${id}/scores`),
  saveScore: (id: string, difficulty: Difficulty, revision: number, result: ScoreSummary) => request<{ best: ScoreSummary }>(
    `/api/songs/${id}/scores`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ difficulty, revision, result }),
    },
  ),
  deleteSong: (id: string) => request<void>(`/api/songs/${id}`, { method: "DELETE" }),
  audioUrl: (id: string) => `/api/songs/${id}/audio`,
};
