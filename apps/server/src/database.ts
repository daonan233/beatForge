import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureUltraChart, type AnalysisJob, type ChartSet, type Difficulty, type ScoreSummary, type SongDetail, type SongSummary } from "@beatforge/shared";

type Row = Record<string, unknown>;

export class Database {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(path.join(dataDir, "beatforge.db"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chart_sets (
        song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        generator_version TEXT NOT NULL,
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chart_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(song_id, revision)
      );
      CREATE TABLE IF NOT EXISTS analyses (
        song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        bpm REAL NOT NULL,
        confidence REAL NOT NULL,
        waveform_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        difficulty TEXT NOT NULL,
        chart_revision INTEGER NOT NULL,
        score INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        max_combo INTEGER NOT NULL,
        perfect INTEGER NOT NULL,
        great INTEGER NOT NULL,
        good INTEGER NOT NULL,
        miss INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(song_id, difficulty, chart_revision)
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_scores_song_revision ON scores(song_id, chart_revision);
      CREATE INDEX IF NOT EXISTS idx_revisions_song_revision ON chart_revisions(song_id, revision);
      PRAGMA optimize;
    `);
  }

  createSong(song: { id: string; title: string; artist: string; originalName: string; mimeType: string; audioPath: string; durationMs: number }) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO songs
      (id, title, artist, original_name, mime_type, audio_path, duration_ms, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`)
      .run(song.id, song.title, song.artist, song.originalName, song.mimeType, song.audioPath, song.durationMs, now, now);
  }

  createJob(id: string, songId: string) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO jobs (id, song_id, status, progress, stage, created_at, updated_at)
      VALUES (?, ?, 'queued', 0, '等待分析', ?, ?)`)
      .run(id, songId, now, now);
  }

  recoverJobs() {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE jobs SET status='queued', stage='服务重启，重新排队', updated_at=? WHERE status='running'").run(now);
    this.db.prepare("UPDATE songs SET status='queued', updated_at=? WHERE status='analyzing'").run(now);
  }

  getNextQueuedJob(): AnalysisJob | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as Row | undefined;
    return row ? this.mapJob(row) : null;
  }

  getJob(id: string): AnalysisJob | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    return row ? this.mapJob(row) : null;
  }

  updateJob(id: string, patch: { status?: string; progress?: number; stage?: string; error?: string | null }) {
    const current = this.getJob(id);
    if (!current) return;
    this.db.prepare("UPDATE jobs SET status=?, progress=?, stage=?, error=?, updated_at=? WHERE id=?").run(
      patch.status ?? current.status,
      patch.progress ?? current.progress,
      patch.stage ?? current.stage,
      patch.error === undefined ? current.error ?? null : patch.error,
      new Date().toISOString(),
      id,
    );
  }

  updateSongStatus(id: string, status: string, error: string | null = null) {
    this.db.prepare("UPDATE songs SET status=?, error=?, updated_at=? WHERE id=?")
      .run(status, error, new Date().toISOString(), id);
  }

  getSongFile(id: string): { audioPath: string; mimeType: string; originalName: string } | null {
    const row = this.db.prepare("SELECT audio_path, mime_type, original_name FROM songs WHERE id=?").get(id) as Row | undefined;
    return row ? { audioPath: String(row.audio_path), mimeType: String(row.mime_type), originalName: String(row.original_name) } : null;
  }

  listSongs(): SongSummary[] {
    const rows = this.db.prepare(`SELECT s.*, c.revision FROM songs s
      LEFT JOIN chart_sets c ON c.song_id=s.id ORDER BY s.created_at DESC`).all() as Row[];
    return rows.map((row) => this.mapSong(row));
  }

  getSong(id: string): SongDetail | null {
    const row = this.db.prepare(`SELECT s.*, c.revision FROM songs s
      LEFT JOIN chart_sets c ON c.song_id=s.id WHERE s.id=?`).get(id) as Row | undefined;
    if (!row) return null;
    const analysis = this.db.prepare("SELECT * FROM analyses WHERE song_id=?").get(id) as Row | undefined;
    return {
      ...this.mapSong(row),
      analysis: analysis ? {
        bpm: Number(analysis.bpm),
        confidence: Number(analysis.confidence),
        waveform: JSON.parse(String(analysis.waveform_json)) as number[],
        warnings: JSON.parse(String(analysis.warnings_json)) as string[],
      } : null,
    };
  }

  private mapSong(row: Row): SongSummary {
    const revision = row.revision == null ? null : Number(row.revision);
    const scoreRows = revision == null ? [] : this.db.prepare(
      "SELECT * FROM scores WHERE song_id=? AND chart_revision=?",
    ).all(String(row.id), revision) as Row[];
    const bestScores: SongSummary["bestScores"] = {};
    for (const score of scoreRows) bestScores[String(score.difficulty) as Difficulty] = this.mapScore(score);
    return {
      id: String(row.id), title: String(row.title), artist: String(row.artist),
      originalName: String(row.original_name), mimeType: String(row.mime_type), durationMs: Number(row.duration_ms),
      status: String(row.status) as SongSummary["status"], error: row.error == null ? null : String(row.error),
      revision, createdAt: String(row.created_at), bestScores,
    };
  }

  private mapJob(row: Row): AnalysisJob {
    return {
      id: String(row.id), songId: String(row.song_id), status: String(row.status) as AnalysisJob["status"],
      progress: Number(row.progress), stage: String(row.stage), error: row.error == null ? null : String(row.error),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private mapScore(row: Row): ScoreSummary {
    return {
      score: Number(row.score), accuracy: Number(row.accuracy), maxCombo: Number(row.max_combo),
      perfect: Number(row.perfect), great: Number(row.great), good: Number(row.good), miss: Number(row.miss),
      createdAt: String(row.created_at),
    };
  }

  saveGeneratedResult(songId: string, chartSet: ChartSet, analysis: { bpm: number; confidence: number; durationMs: number; waveform: number[]; warnings: string[] }) {
    const now = new Date().toISOString();
    const existing = this.getChartSet(songId);
    const nextRevision = existing ? existing.revision + 1 : 1;
    if (existing) this.saveRevision(songId, existing);
    chartSet.songId = songId;
    chartSet.revision = nextRevision;
    const json = JSON.stringify(chartSet);
    this.db.prepare(`INSERT INTO chart_sets(song_id, revision, generator_version, document_json, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET revision=excluded.revision,
      generator_version=excluded.generator_version, document_json=excluded.document_json, updated_at=excluded.updated_at`)
      .run(songId, nextRevision, chartSet.generatorVersion, json, now);
    this.db.prepare(`INSERT INTO analyses(song_id, bpm, confidence, waveform_json, warnings_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET bpm=excluded.bpm, confidence=excluded.confidence,
      waveform_json=excluded.waveform_json, warnings_json=excluded.warnings_json, updated_at=excluded.updated_at`)
      .run(songId, analysis.bpm, analysis.confidence, JSON.stringify(analysis.waveform), JSON.stringify(analysis.warnings), now);
    this.db.prepare("UPDATE songs SET duration_ms=?, updated_at=? WHERE id=?").run(Math.round(analysis.durationMs), now, songId);
    this.trimRevisions(songId);
  }

  getChartSet(songId: string): ChartSet | null {
    const row = this.db.prepare("SELECT document_json FROM chart_sets WHERE song_id=?").get(songId) as Row | undefined;
    return row ? ensureUltraChart(JSON.parse(String(row.document_json)) as ChartSet) : null;
  }

  updateChartSet(songId: string, baseRevision: number, document: ChartSet): ChartSet | "conflict" | null {
    const current = this.getChartSet(songId);
    if (!current) return null;
    if (current.revision !== baseRevision) return "conflict";
    this.saveRevision(songId, current);
    document.songId = songId;
    document.revision = baseRevision + 1;
    this.db.prepare("UPDATE chart_sets SET revision=?, generator_version=?, document_json=?, updated_at=? WHERE song_id=?")
      .run(document.revision, document.generatorVersion, JSON.stringify(document), new Date().toISOString(), songId);
    this.trimRevisions(songId);
    return document;
  }

  private saveRevision(songId: string, document: ChartSet) {
    this.db.prepare(`INSERT OR IGNORE INTO chart_revisions(song_id, revision, document_json, created_at)
      VALUES (?, ?, ?, ?)`)
      .run(songId, document.revision, JSON.stringify(document), new Date().toISOString());
  }

  private trimRevisions(songId: string) {
    this.db.prepare(`DELETE FROM chart_revisions WHERE song_id=? AND id NOT IN (
      SELECT id FROM chart_revisions WHERE song_id=? ORDER BY revision DESC LIMIT 20
    )`).run(songId, songId);
  }

  upsertBestScore(songId: string, difficulty: Difficulty, revision: number, score: ScoreSummary): ScoreSummary {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO scores
      (song_id, difficulty, chart_revision, score, accuracy, max_combo, perfect, great, good, miss, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(song_id, difficulty, chart_revision) DO UPDATE SET
      score=excluded.score, accuracy=excluded.accuracy, max_combo=excluded.max_combo,
      perfect=excluded.perfect, great=excluded.great, good=excluded.good, miss=excluded.miss, created_at=excluded.created_at
      WHERE excluded.score > scores.score`)
      .run(songId, difficulty, revision, score.score, score.accuracy, score.maxCombo,
        score.perfect, score.great, score.good, score.miss, now);
    const row = this.db.prepare("SELECT * FROM scores WHERE song_id=? AND difficulty=? AND chart_revision=?")
      .get(songId, difficulty, revision) as Row;
    return this.mapScore(row);
  }

  getScores(songId: string, revision: number): Partial<Record<Difficulty, ScoreSummary>> {
    const rows = this.db.prepare("SELECT * FROM scores WHERE song_id=? AND chart_revision=?").all(songId, revision) as Row[];
    return Object.fromEntries(rows.map((row) => [String(row.difficulty), this.mapScore(row)]));
  }

  deleteSong(id: string) {
    this.db.prepare("DELETE FROM songs WHERE id=?").run(id);
  }

  close() { this.db.close(); }
}
