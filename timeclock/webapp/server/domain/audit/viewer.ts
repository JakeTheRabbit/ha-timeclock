import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { nzDateOf } from "@/server/domain/holidays/stat-pay";

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  employeeId?: string; // actor OR subject
  from?: Date;
  to?: Date;
  q?: string;
  before?: number; // cursor: rows with id < before
  limit: number;
}

/**
 * Audit viewer page: newest first, with the actor's name and the person the
 * row is about (resolved through the entity it points at) plus the facility
 * day it concerns, so the UI can show names and link to that day.
 * Cursor-paged by id.
 */
export async function auditPage(q: AuditQuery) {
  const conds: SQL[] = [];
  if (q.entityType) conds.push(sql`a.entity_type = ${q.entityType}`);
  if (q.entityId) conds.push(sql`a.entity_id = ${q.entityId}`);
  if (q.employeeId) conds.push(sql`(a.subject_id = ${q.employeeId}::uuid OR a.actor_id = ${q.employeeId}::uuid)`);
  if (q.from) conds.push(sql`a.created_at >= ${q.from.toISOString()}::timestamptz`);
  if (q.to) conds.push(sql`a.created_at < ${q.to.toISOString()}::timestamptz`);
  if (q.before) conds.push(sql`a.id < ${q.before}`);
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(
      sql`(a.action ILIKE ${like} OR a.entity_type ILIKE ${like} OR a.reason ILIKE ${like} OR act.display_name ILIKE ${like} OR sub.display_name ILIKE ${like})`,
    );
  }

  const res = await getDb().execute(sql`
    WITH a AS (
      SELECT al.id, al.created_at, al.entity_type, al.entity_id, al.action, al.actor_id, al.reason,
        al.old_value, al.new_value, al.hash,
        CASE al.entity_type
          WHEN 'time_entry' THEN te.employee_id
          WHEN 'break' THEN bte.employee_id
          WHEN 'correction' THEN co.employee_id
          WHEN 'modification' THEN mo.employee_id
          WHEN 'leave_request' THEN lr.employee_id
          WHEN 'roster' THEN ro.employee_id
          WHEN 'bonus' THEN bo.employee_id
          WHEN 'employee' THEN em.id
          WHEN 'leave_ledger' THEN em.id
          WHEN 'day' THEN dem.id
        END AS subject_id,
        CASE al.entity_type
          WHEN 'time_entry' THEN te.clock_in
          WHEN 'break' THEN bte.clock_in
          WHEN 'correction' THEN cte.clock_in
        END AS day_at,
        CASE al.entity_type
          WHEN 'modification' THEN mo.day::text
          WHEN 'roster' THEN ro.shift_date::text
          WHEN 'bonus' THEN bo.awarded_on::text
          WHEN 'day' THEN split_part(al.entity_id, ':', 2)
        END AS day_str
      FROM audit_log al
      LEFT JOIN time_entries te ON al.entity_type = 'time_entry' AND te.id::text = al.entity_id
      LEFT JOIN breaks b ON al.entity_type = 'break' AND b.id::text = al.entity_id
      LEFT JOIN time_entries bte ON bte.id = b.time_entry_id
      LEFT JOIN corrections co ON al.entity_type = 'correction' AND co.id::text = al.entity_id
      LEFT JOIN time_entries cte ON cte.id = co.time_entry_id
      LEFT JOIN modifications mo ON al.entity_type = 'modification' AND mo.id::text = al.entity_id
      LEFT JOIN leave_requests lr ON al.entity_type = 'leave_request' AND lr.id::text = al.entity_id
      LEFT JOIN rosters ro ON al.entity_type = 'roster' AND ro.id::text = al.entity_id
      LEFT JOIN bonuses bo ON al.entity_type = 'bonus' AND bo.id::text = al.entity_id
      LEFT JOIN employees em ON al.entity_type IN ('employee', 'leave_ledger') AND em.id::text = al.entity_id
      LEFT JOIN employees dem ON al.entity_type = 'day' AND dem.id::text = split_part(al.entity_id, ':', 1)
    )
    SELECT a.*, act.display_name AS actor_name, sub.display_name AS subject_name
    FROM a
    LEFT JOIN employees act ON act.id = a.actor_id
    LEFT JOIN employees sub ON sub.id = a.subject_id
    ${conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``}
    ORDER BY a.id DESC
    LIMIT ${q.limit + 1}
  `);

  const raw = res.rows as Record<string, unknown>[];
  const rows = raw.slice(0, q.limit).map((r) => ({
    id: Number(r.id),
    createdAt: new Date(r.created_at as string).toISOString(),
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    action: r.action as string,
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    subjectName: (r.subject_name as string | null) ?? null,
    day:
      (r.day_str as string | null) || (r.day_at ? nzDateOf(new Date(r.day_at as string)) : null),
    reason: (r.reason as string | null) ?? null,
    oldValue: (r.old_value as string | null) ?? null,
    newValue: (r.new_value as string | null) ?? null,
    hash: r.hash as string,
  }));
  return { rows, nextCursor: raw.length > q.limit ? rows[rows.length - 1].id : null };
}
