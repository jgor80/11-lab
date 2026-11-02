// Writes normalized card records into the database with full provenance.
// Idempotent: re-running the same input updates rows in place instead of duplicating them.
import { createHash } from "node:crypto";
import type { Db } from "../db/sqlite.js";
import { CardRecord, type AdapterOutput } from "./record.js";

export interface ImportOptions {
  sourceId: string;
  inputRef?: string;
  inputBytes?: Uint8Array | string;
  /** Required for a pending_review source: who decided its terms are acceptable for this run. */
  termsAcceptedBy?: string;
}

export interface ImportSummary {
  runId: number;
  seen: number;
  written: number;
  rejected: number;
}

export class TermsError extends Error {}

type Row = Record<string, unknown>;

export function importRecords(db: Db, output: AdapterOutput, opts: ImportOptions): ImportSummary {
  const source = db.prepare("SELECT id, terms_status FROM data_sources WHERE id = ?").get(opts.sourceId) as
    | { id: string; terms_status: string }
    | undefined;
  if (!source) throw new TermsError(`Unknown data source '${opts.sourceId}'. Add it to data_sources first.`);
  if (source.terms_status === "blocked") {
    throw new TermsError(`Source '${opts.sourceId}' is blocked by its terms. See data_sources.terms_notes.`);
  }
  if (source.terms_status === "pending_review" && !opts.termsAcceptedBy) {
    throw new TermsError(
      `Source '${opts.sourceId}' has terms pending review. Pass --accept-terms "<your name>" once you've decided its terms are OK.`,
    );
  }

  const sha = opts.inputBytes ? createHash("sha256").update(opts.inputBytes).digest("hex") : null;
  const run = db
    .prepare(
      `INSERT INTO import_runs (source_id, input_ref, input_sha256, source_snapshot_at, terms_accepted_by)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(opts.sourceId, opts.inputRef ?? null, sha, output.snapshotAt ?? null, opts.termsAcceptedBy ?? null) as { id: number };

  const reject = db.prepare("INSERT INTO import_rejections (import_run_id, record_ref, reason) VALUES (?, ?, ?)");
  const known = {
    attrs: new Set((db.prepare("SELECT key FROM attribute_defs").all() as Row[]).map((r) => r.key as string)),
    positions: new Set((db.prepare("SELECT code FROM positions").all() as Row[]).map((r) => r.code as string)),
  };

  let written = 0;
  let rejected = 0;
  for (const r of output.rejected) {
    reject.run(run.id, r.ref, r.reason);
    rejected++;
  }

  db.exec("BEGIN");
  try {
    for (const raw of output.records) {
      const parsed = CardRecord.safeParse(raw);
      const ref = String((raw as { card_key?: unknown }).card_key ?? "?");
      if (!parsed.success) {
        reject.run(run.id, ref, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        rejected++;
        continue;
      }
      const rec = parsed.data;
      const unknownAttr = Object.keys(rec.attributes).filter((k) => !known.attrs.has(k));
      const unknownPos = [...rec.positions, ...rec.roles.map((x) => x.position)].filter((p) => !known.positions.has(p));
      if (unknownAttr.length || unknownPos.length) {
        const parts = [];
        if (unknownAttr.length) parts.push(`unknown attributes: ${unknownAttr.join(", ")}`);
        if (unknownPos.length) parts.push(`unknown positions: ${[...new Set(unknownPos)].join(", ")}`);
        reject.run(run.id, rec.card_key, parts.join("; "));
        rejected++;
        continue;
      }
      writeCard(db, rec, opts.sourceId, run.id);
      written++;
    }
    db.prepare(
      `UPDATE import_runs SET status = 'succeeded', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       records_seen = ?, records_written = ?, records_rejected = ? WHERE id = ?`,
    ).run(output.records.length + output.rejected.length, written, rejected, run.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.prepare(
      `UPDATE import_runs SET status = 'failed', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), notes = ? WHERE id = ?`,
    ).run((e as Error).message, run.id);
    throw e;
  }
  return { runId: run.id, seen: output.records.length + output.rejected.length, written, rejected };
}

function upsertNamed(db: Db, table: "nations" | "leagues", v: { name: string; ea_id?: number; gender?: string }): number {
  if (v.ea_id !== undefined) {
    const hit = db.prepare(`SELECT id FROM ${table} WHERE ea_id = ?`).get(v.ea_id) as Row | undefined;
    if (hit) return hit.id as number;
  }
  const extraCol = table === "leagues" ? ", gender" : "";
  const extraVal = table === "leagues" ? ", ?" : "";
  const params: (string | number | null)[] = [v.name, v.ea_id ?? null];
  if (table === "leagues") params.push(v.gender ?? null);
  const row = db
    .prepare(
      `INSERT INTO ${table} (name, ea_id${extraCol}) VALUES (?, ?${extraVal})
       ON CONFLICT(name) DO UPDATE SET ea_id = COALESCE(${table}.ea_id, excluded.ea_id) RETURNING id`,
    )
    .get(...params) as Row;
  return row.id as number;
}

function upsertClub(db: Db, v: { name: string; ea_id?: number }, leagueId: number | null): number {
  if (v.ea_id !== undefined) {
    const hit = db.prepare("SELECT id FROM clubs WHERE ea_id = ?").get(v.ea_id) as Row | undefined;
    if (hit) return hit.id as number;
  }
  const hit = db
    .prepare("SELECT id FROM clubs WHERE name = ? AND league_id IS ?")
    .get(v.name, leagueId) as Row | undefined;
  if (hit) return hit.id as number;
  const row = db
    .prepare("INSERT INTO clubs (name, league_id, ea_id) VALUES (?, ?, ?) RETURNING id")
    .get(v.name, leagueId, v.ea_id ?? null) as Row;
  return row.id as number;
}

function upsertPlayer(db: Db, rec: CardRecord, sourceId: string, nationId: number): number {
  const p = rec.person;
  const values = [p.common_name, p.first_name ?? null, p.last_name ?? null, p.birth_date ?? null, p.gender ?? null,
    nationId, p.height_cm ?? null, p.weight_kg ?? null, p.preferred_foot ?? null];
  // The same footballer from two sources merges on the EA person id when both have it.
  if (p.ea_person_id !== undefined) {
    const hit = db.prepare("SELECT id FROM players WHERE ea_person_id = ?").get(p.ea_person_id) as Row | undefined;
    if (hit) {
      db.prepare(
        `UPDATE players SET common_name=?, first_name=?, last_name=?, birth_date=?, gender=?, nation_id=?,
         height_cm=?, weight_kg=?, preferred_foot=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      ).run(...values, hit.id as number);
      return hit.id as number;
    }
  }
  const row = db
    .prepare(
      `INSERT INTO players (common_name, first_name, last_name, birth_date, gender, nation_id, height_cm, weight_kg,
         preferred_foot, ea_person_id, source_id, source_person_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, source_person_key) DO UPDATE SET
         common_name=excluded.common_name, first_name=excluded.first_name, last_name=excluded.last_name,
         birth_date=excluded.birth_date, gender=excluded.gender, nation_id=excluded.nation_id,
         height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, preferred_foot=excluded.preferred_foot,
         ea_person_id=COALESCE(players.ea_person_id, excluded.ea_person_id),
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       RETURNING id`,
    )
    .get(...values, p.ea_person_id ?? null, sourceId, p.key) as Row;
  return row.id as number;
}

function writeCard(db: Db, rec: CardRecord, sourceId: string, runId: number): void {
  const nationId = upsertNamed(db, "nations", rec.nation);
  const leagueId = rec.league ? upsertNamed(db, "leagues", rec.league) : null;
  const clubId = rec.club ? upsertClub(db, rec.club, leagueId) : null;
  const playerId = upsertPlayer(db, rec, sourceId, nationId);

  const card = db
    .prepare(
      `INSERT INTO player_cards (player_id, ea_item_id, season, version, rarity, overall, nation_id, league_id, club_id,
         is_icon, is_hero, skill_moves, weak_foot, attacking_work_rate, defensive_work_rate, height_cm, image_url,
         availability, evidence, source_id, source_card_key, source_updated_at, import_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, source_card_key) DO UPDATE SET
         player_id=excluded.player_id, ea_item_id=excluded.ea_item_id, season=excluded.season, version=excluded.version,
         rarity=excluded.rarity, overall=excluded.overall, nation_id=excluded.nation_id, league_id=excluded.league_id,
         club_id=excluded.club_id, is_icon=excluded.is_icon, is_hero=excluded.is_hero, skill_moves=excluded.skill_moves,
         weak_foot=excluded.weak_foot, attacking_work_rate=excluded.attacking_work_rate,
         defensive_work_rate=excluded.defensive_work_rate, height_cm=excluded.height_cm, image_url=excluded.image_url,
         availability=excluded.availability, evidence=excluded.evidence, source_updated_at=excluded.source_updated_at,
         import_run_id=excluded.import_run_id, imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       RETURNING id`,
    )
    .get(
      playerId, rec.ea_item_id ?? null, rec.season, rec.version, rec.rarity ?? null, rec.overall, nationId, leagueId,
      clubId, rec.is_icon ? 1 : 0, rec.is_hero ? 1 : 0, rec.skill_moves ?? null, rec.weak_foot ?? null,
      rec.attacking_work_rate ?? null, rec.defensive_work_rate ?? null, rec.person.height_cm ?? null,
      rec.image_url ?? null, rec.availability ?? null, rec.evidence, sourceId, rec.card_key,
      rec.source_updated_at ?? null, runId,
    ) as Row;
  const cardId = card.id as number;

  // Child rows are replaced wholesale so a re-import reflects removals too.
  for (const t of ["card_positions", "card_attributes", "card_playstyles", "card_role_familiarity"]) {
    db.prepare(`DELETE FROM ${t} WHERE card_id = ?`).run(cardId);
  }
  const insPos = db.prepare("INSERT OR IGNORE INTO card_positions (card_id, position_code, is_primary) VALUES (?, ?, ?)");
  rec.positions.forEach((p, i) => insPos.run(cardId, p, i === 0 ? 1 : 0));

  const insAttr = db.prepare("INSERT INTO card_attributes (card_id, attribute_key, value) VALUES (?, ?, ?)");
  for (const [k, v] of Object.entries(rec.attributes)) insAttr.run(cardId, k, v);

  const upPs = db.prepare("INSERT INTO playstyles (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=playstyles.name RETURNING id");
  const insPs = db.prepare(
    `INSERT INTO card_playstyles (card_id, playstyle_id, is_plus) VALUES (?, ?, ?)
     ON CONFLICT(card_id, playstyle_id) DO UPDATE SET is_plus = MAX(is_plus, excluded.is_plus)`,
  );
  for (const ps of rec.playstyles) {
    const id = (upPs.get(ps.name) as Row).id as number;
    insPs.run(cardId, id, ps.plus ? 1 : 0);
  }

  const upRole = db.prepare(
    `INSERT INTO roles (position_code, name) VALUES (?, ?)
     ON CONFLICT(position_code, name) DO UPDATE SET name=roles.name RETURNING id`,
  );
  const insRole = db.prepare("INSERT OR REPLACE INTO card_role_familiarity (card_id, role_id, level) VALUES (?, ?, ?)");
  for (const r of rec.roles) {
    const id = (upRole.get(r.position, r.role) as Row).id as number;
    insRole.run(cardId, id, r.level);
  }
}
