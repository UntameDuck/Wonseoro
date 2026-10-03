import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { UNIVERSITY_ID } from '../../config';
import { AuditService } from '../audit/audit.service';

export type IncidentSeverity = 'NOTICE' | 'DEGRADED' | 'OUTAGE';
export type IncidentStatus = 'ACTIVE' | 'RESOLVED';

export interface IncidentView {
  id: string;
  severity: IncidentSeverity;
  title: string;
  message: string;
  startsAt: string;
  expectedResolvedAt: string | null;
  status: IncidentStatus;
  createdAt: string;
  createdBy?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
}

interface IncidentRow extends Record<string, unknown> {
  id: string;
  severity: IncidentSeverity;
  title: string;
  message: string;
  starts_at: Date;
  expected_resolved_at: Date | null;
  status: IncidentStatus;
  created_by: string;
  created_at: Date;
  resolved_by: string | null;
  resolved_at: Date | null;
}

const ORDER: Record<IncidentSeverity, number> = { NOTICE: 1, DEGRADED: 2, OUTAGE: 3 };

@Injectable()
export class IncidentService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  async publicStatus() {
    const [{ rows: universityRows }, incidents] = await Promise.all([
      this.db.query<{ id: string; name: string }>(
        `SELECT id, name FROM university WHERE id = $1`,
        [UNIVERSITY_ID],
      ),
      this.list('ACTIVE'),
    ]);
    const university = universityRows[0];
    const highest = incidents.reduce<IncidentSeverity | null>(
      (value, item) => (!value || ORDER[item.severity] > ORDER[value] ? item.severity : value),
      null,
    );
    return {
      universityId: university?.id ?? '',
      universityName: university?.name ?? '대학 원서접수',
      status: highest ?? 'OPERATIONAL',
      incidents: incidents.map(({ createdBy: _createdBy, resolvedBy: _resolvedBy, ...item }) => item),
      checkedAt: new Date().toISOString(),
    };
  }

  async list(status: IncidentStatus | 'ALL' = 'ALL'): Promise<IncidentView[]> {
    const { rows } = await this.db.query<IncidentRow>(
      `SELECT id, severity, title, message, starts_at, expected_resolved_at, status,
              created_by, created_at, resolved_by, resolved_at
         FROM service_incident
        WHERE ($1 = 'ALL' OR status = $1)
        ORDER BY CASE severity WHEN 'OUTAGE' THEN 3 WHEN 'DEGRADED' THEN 2 ELSE 1 END DESC,
                 starts_at DESC, id DESC`,
      [status],
    );
    return rows.map((row) => this.view(row));
  }

  async publish(input: {
    severity: IncidentSeverity;
    title: string;
    message: string;
    expectedResolvedAt?: string | null;
    operator: string;
  }): Promise<IncidentView> {
    const severity = input.severity;
    if (!['NOTICE', 'DEGRADED', 'OUTAGE'].includes(severity)) {
      throw ProblemException.validationFailed('영향 수준을 선택해 주십시오.');
    }
    const title = input.title.trim();
    const message = input.message.trim();
    if (!title || title.length > 120) {
      throw ProblemException.validationFailed('제목은 1자 이상 120자 이하로 적어 주십시오.');
    }
    if (!message || message.length > 1000) {
      throw ProblemException.validationFailed('지원자 안내는 1자 이상 1000자 이하로 적어 주십시오.');
    }
    let expected: Date | null = null;
    if (input.expectedResolvedAt) {
      expected = new Date(input.expectedResolvedAt);
      if (Number.isNaN(expected.getTime()) || expected.getTime() <= Date.now()) {
        throw ProblemException.validationFailed('예상 정상화 시각은 지금보다 뒤여야 합니다.');
      }
    }
    const id = randomUUID();
    return this.db.tx(async (client) => {
      const { rows } = await client.query<IncidentRow>(
        `INSERT INTO service_incident
           (id, severity, title, message, expected_resolved_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, severity, title, message, starts_at, expected_resolved_at, status,
                   created_by, created_at, resolved_by, resolved_at`,
        [id, severity, title, message, expected, input.operator],
      );
      await this.audit.record(client, {
        actorType: 'ADMIN',
        actorId: input.operator,
        action: 'INCIDENT_PUBLISHED',
        result: 'ACCEPTED',
        details: { incidentId: id, severity },
      });
      return this.view(rows[0]!);
    });
  }

  async resolve(id: string, operator: string): Promise<IncidentView> {
    return this.db.tx(async (client) => {
      const { rows } = await client.query<IncidentRow>(
        `UPDATE service_incident
            SET status = 'RESOLVED', resolved_by = $2, resolved_at = now()
          WHERE id = $1 AND status = 'ACTIVE'
          RETURNING id, severity, title, message, starts_at, expected_resolved_at, status,
                    created_by, created_at, resolved_by, resolved_at`,
        [id, operator],
      );
      const row = rows[0];
      if (!row) throw ProblemException.notFound('활성 장애 공지를 찾을 수 없습니다.');
      await this.audit.record(client, {
        actorType: 'ADMIN',
        actorId: operator,
        action: 'INCIDENT_RESOLVED',
        result: 'ACCEPTED',
        details: { incidentId: id, severity: row.severity },
      });
      return this.view(row);
    });
  }

  private view(row: IncidentRow): IncidentView {
    return {
      id: row.id,
      severity: row.severity,
      title: row.title,
      message: row.message,
      startsAt: row.starts_at.toISOString(),
      expectedResolvedAt: row.expected_resolved_at?.toISOString() ?? null,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolvedBy: row.resolved_by,
    };
  }
}
