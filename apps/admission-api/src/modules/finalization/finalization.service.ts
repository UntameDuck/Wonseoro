import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { EVENT_TYPE, ApplicationFinalizedData } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { purposeRef } from '@wonseoro/server-kit';
import { CENTRAL_ID_SALT, CENTRAL_SUBJECT_KEY, CENTRAL_SUBJECT_KEY_ID } from '../../config';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';
import { DeadlineService } from '../deadline/deadline.service';
import { FormSchemaService } from '../config/form-schema.service';
import { PaymentRow, PaymentService } from '../payment/payment.service';

export interface SubmissionRow {
  submissionId: string;
  applicationId: string;
  applicationNumber: string;
  requestedAt: string;
  paymentVerifiedAt: string;
  finalizedAt: string;
  deadlinePolicyVersion: string;
  configVersion: string;
}

export interface FinalizeInput {
  applicationId: string;
  applicantId: string;
  /** 제출 요청이 서버에 도달한 시각. 마감 정책이 이 값을 쓸 수 있다. */
  requestedAt: Date;
  /**
   * 누가 접수를 일으켰는가. 결제 확인이 곧 제출이면(D-42) 서버가 부른다 —
   * 감사에는 SYSTEM 으로 남기고, 제출 의사는 결제 의도를 만든 지원자의 것임을 함께 적는다.
   */
  trigger?: 'APPLICANT' | 'PAYMENT_CONFIRMED';
  traceId?: string;
  sourceIp?: string;
}

/**
 * 접수로 갈 수 있는 원서 상태. CANCELLED·EXPIRED 는 안 된다 —
 * 결제가 늦게 확인되는 동안 지원자가 취소했을 수 있다. 그 결제는 환불 대상이지 접수가 아니다.
 */
const FINALIZABLE_FROM = new Set(['DRAFT', 'READY', 'PAYMENT_PENDING', 'PAID', 'FINALIZING']);

/**
 * 최종 접수 — 기술설계서 v1.0 §5.6, v1.1 §02
 *
 * 사용자에게는 "전형료 결제 및 원서접수" 한 번의 행위로 보이지만
 * 내부에서는 Payment 와 Submission 을 별도로 관리한다.
 *
 * ## 트랜잭션 순서 (§02 — 바꾸지 않는다)
 * ```
 * 1. Idempotency record 확인/잠금   ← 인터셉터가 선점, 여기서 Application 행 잠금
 * 2. Application 상태·버전·마감정책 확인
 * 3. 사전 검증된 Payment snapshot 확인   ← PG 재조회는 이 트랜잭션 이전에 끝나 있다
 * 4. Submission INSERT
 * 5. Application → FINALIZED 조건부 전이
 * 6. Outbox Event INSERT
 * 7. Audit Event INSERT
 * 8. Commit
 * ```
 *
 * ## 트랜잭션 밖에서 하는 것
 * PG 조회 · PDF 생성 · SMS · 메일 · **중앙 전송**
 *
 * 중앙 전송 실패는 접수 실패가 아니다. Outbox 에 남기고 사용자에게는 접수완료를 준다.
 * event-relay 가 나중에 보낸다. (v1.1 §10 §12)
 */
@Injectable()
export class FinalizationService implements OnModuleInit {
  private readonly logger = new Logger(FinalizationService.name);

  constructor(
    private readonly db: Db,
    private readonly payments: PaymentService,
    private readonly deadline: DeadlineService,
    private readonly forms: FormSchemaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 결제가 곧 제출이다 (D-42). 현행 원서접수와 같다 — 전형료 결제를 마치면 접수가 끝난다.
   *   - 결제창을 열기 전에 접수할 수 있는 원서인지 본다 (상태·입력·서류·마감)
   *   - 결제가 처음 확인되면(화면 확인·PG 콜백·재확인 워커 어느 쪽이든) 서버가 접수한다
   */
  onModuleInit(): void {
    this.payments.guardIntent(async (applicationId) => {
      await this.assertReady(applicationId, new Date());
    });
    this.payments.onConfirmed((payment) => this.autoFinalize(payment));
  }

  /**
   * 결제 확인 직후의 자동 접수. 실패해도 결제 확인은 되돌리지 않는다 —
   * 사유를 감사에 남기고, 대조(PAYMENT_CONFIRMED_WITHOUT_SUBMISSION)와 Self-check 가 드러낸다.
   * 지원자는 화면에서 다시 제출할 수 있다(같은 finalize 경로).
   */
  async autoFinalize(payment: PaymentRow): Promise<void> {
    const { rows } = await this.db.query<{ applicant_id: string; created_at: Date }>(
      `SELECT a.applicant_id, p.created_at
         FROM payment p JOIN application a ON a.id = p.application_id
        WHERE p.id = $1`,
      [payment.id],
    );
    const found = rows[0];
    if (!found) return;
    try {
      const { submission, created } = await this.finalize({
        applicationId: payment.applicationId,
        applicantId: found.applicant_id,
        // 제출 의사를 밝힌 시각 = "결제하기" 로 결제 의도를 만든 시각.
        requestedAt: found.created_at,
        trigger: 'PAYMENT_CONFIRMED',
      });
      if (created) {
        this.logger.log(`auto-finalized ${submission.applicationNumber} on payment ${payment.id}`);
      }
    } catch (err) {
      const problem = err instanceof ProblemException ? err.problem : null;
      this.logger.warn(
        `auto-finalize failed for application ${payment.applicationId}: ${problem?.code ?? String(err)}`,
      );
      await this.db.tx((client) =>
        this.audit.record(client, {
          applicationId: payment.applicationId,
          actorType: 'SYSTEM',
          actorId: 'auto-finalize',
          action: 'FINALIZE_REQUESTED',
          result: 'REJECTED',
          details: {
            trigger: 'PAYMENT_CONFIRMED',
            paymentId: payment.id,
            code: problem?.code ?? 'INTERNAL',
          },
        }),
      );
    }
  }

  /**
   * 접수할 수 있는 원서인가 — 결제 전 확인과 접수 직전 확인이 같은 규칙을 쓴다.
   * 결제 여부와 마감은 보지 않는다. 결제는 finalize 가, 마감은 부르는 쪽이 제 시각으로 본다.
   */
  private async assertReady(applicationId: string, deadlineCheckAt: Date | null) {
    const app = await this.loadApplication(applicationId);
    if (app.status === 'FINALIZED') throw ProblemException.alreadyFinalized();
    if (!FINALIZABLE_FROM.has(app.status)) {
      throw ProblemException.illegalTransition(app.status, 'FINALIZED');
    }

    // 필수 입력 검증. 접수 직전에 다시 본다 — 저장 이후 Config 가 바뀌었을 수 있다.
    const fields = await this.loadFields(applicationId);
    const validation = await this.forms.validate(app.cycleId, app.admissionTypeCode, fields);
    if (!validation.valid) {
      throw ProblemException.unprocessable(
        `원서에 누락되거나 잘못된 항목이 있습니다: ${validation.issues
          .map((i) => i.path)
          .join(', ')}`,
      );
    }

    // 필수 서류는 AVAILABLE 상태만 인정한다. (v1.1 §10 §6)
    await this.assertRequiredDocuments(applicationId, app.cycleId, app.admissionTypeCode);

    // 결제 전: 이미 마감이 지났으면 결제창도 열지 않는다. 어느 판정 방식이든 "지금" 은 이후 시각이다.
    if (deadlineCheckAt) {
      await this.deadline.assertWithinDeadline(app.cycleId, {
        requestReceivedAt: deadlineCheckAt,
        paymentApprovedAt: deadlineCheckAt,
        commitAt: deadlineCheckAt,
      });
    }
    return app;
  }

  async finalize(input: FinalizeInput): Promise<{ submission: SubmissionRow; created: boolean }> {
    // ── 트랜잭션 이전: 외부 호출과 무거운 검증을 모두 끝낸다 ──────────────

    const existing = await this.findSubmission(input.applicationId);
    if (existing) {
      // 이미 접수되었다. 재시도는 오류가 아니다. 같은 결과를 돌려준다.
      return { submission: existing, created: false };
    }

    // 결제 확인. CONFIRMED 가 아니면 여기서 멈춘다.
    const payment = await this.payments.confirmedFor(input.applicationId);

    const app = await this.assertReady(input.applicationId, null);

    const commitAt = new Date();
    const policy = await this.deadline.assertWithinDeadline(app.cycleId, {
      requestReceivedAt: input.requestedAt,
      ...(payment.providerApprovedAt
        ? { paymentApprovedAt: new Date(payment.providerApprovedAt) }
        : {}),
      commitAt,
    });
    const configVersion = await this.activeConfigVersion(app.cycleId);

    // ── 트랜잭션: 여기부터 외부 호출 금지 ──────────────────────────────
    const submission = await this.db.tx(async (client) => {
      // 2. Application 행 잠금 + 상태·버전 재확인
      const locked = await client.query<{ status: string; version: string }>(
        `SELECT status, version FROM application WHERE id = $1 FOR UPDATE`,
        [input.applicationId],
      );
      const current = locked.rows[0];
      if (!current) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
      // 잠금을 기다리는 사이 다른 경로(자동 접수·화면 제출)가 먼저 접수했다. 재시도와 같다.
      if (current.status === 'FINALIZED') return null;
      if (!FINALIZABLE_FROM.has(current.status)) {
        throw ProblemException.illegalTransition(current.status, 'FINALIZED');
      }

      const applicationNumber = this.issueApplicationNumber(app.admissionYear, app.universityId);
      const submissionId = randomUUID();
      const evidenceHash = this.evidenceHash({
        applicationId: input.applicationId,
        applicationNumber,
        paymentId: payment.id,
        policyVersion: policy.version,
        configVersion,
        finalizedAt: commitAt.toISOString(),
      });

      // 4. Submission INSERT — application_id UNIQUE 가 중복 접수를 막는 최후의 방어선
      await client.query(
        `INSERT INTO submission
           (id, application_id, application_number, requested_at, payment_verified_at,
            finalized_at, deadline_policy_version, config_version,
            server_clock_offset_ms, evidence_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          submissionId,
          input.applicationId,
          applicationNumber,
          input.requestedAt,
          payment.verifiedAt ?? commitAt,
          commitAt,
          policy.version,
          configVersion,
          0,
          evidenceHash,
        ],
      );

      // 5. 조건부 전이. 다른 요청이 먼저 바꿨으면 0건이 나온다.
      const moved = await client.query(
        `UPDATE application
            SET status = 'FINALIZED', version = version + 1, updated_at = now()
          WHERE id = $1 AND status = $2 AND version = $3`,
        [input.applicationId, current.status, current.version],
      );
      if (moved.rowCount === 0) {
        throw ProblemException.versionConflict(
          '원서 상태가 처리 중에 변경되었습니다. 다시 확인해 주십시오.',
        );
      }

      // 6. Outbox INSERT — 같은 트랜잭션 안이다. 커밋되면 이벤트도 반드시 남는다.
      await this.enqueueFinalizedEvent(client, {
        applicationId: input.applicationId,
        universityId: app.universityId,
        subjectToken: app.subjectToken,
        admissionYear: app.admissionYear,
        admissionTypeCode: app.admissionTypeCode,
        departmentCode: app.departmentCode,
        applicationNumber,
        requestedAt: input.requestedAt.toISOString(),
        paymentApprovedAt: payment.providerApprovedAt,
        finalizedAt: commitAt.toISOString(),
        policyVersion: policy.version,
        configVersion,
      });

      // 7. Audit INSERT
      const auto = input.trigger === 'PAYMENT_CONFIRMED';
      await this.audit.record(client, {
        applicationId: input.applicationId,
        actorType: auto ? 'SYSTEM' : 'APPLICANT',
        actorId: auto ? 'auto-finalize' : input.applicantId,
        action: 'APPLICATION_FINALIZED',
        result: 'ACCEPTED',
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
        configVersion,
        policyVersion: policy.version,
        details: {
          submissionId,
          paymentId: payment.id,
          trigger: input.trigger ?? 'APPLICANT',
        },
      });

      return {
        submissionId,
        applicationId: input.applicationId,
        applicationNumber,
        requestedAt: input.requestedAt.toISOString(),
        paymentVerifiedAt: (payment.verifiedAt ?? commitAt.toISOString()) as string,
        finalizedAt: commitAt.toISOString(),
        deadlinePolicyVersion: policy.version,
        configVersion,
      };
    });
    // 8. Commit 완료. 이 시점부터 사용자에게 접수완료다.
    if (!submission) {
      const raced = await this.findSubmission(input.applicationId);
      if (!raced) throw ProblemException.alreadyFinalized();
      return { submission: raced, created: false };
    }

    this.logger.log(
      `finalized ${submission.applicationNumber} (application=${input.applicationId})`,
    );
    return { submission, created: true };
  }

  async findSubmission(applicationId: string): Promise<SubmissionRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_id, application_number, requested_at, payment_verified_at,
              finalized_at, deadline_policy_version, config_version
         FROM submission WHERE application_id = $1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      submissionId: String(r.id),
      applicationId: String(r.application_id),
      applicationNumber: String(r.application_number),
      requestedAt: (r.requested_at as Date).toISOString(),
      paymentVerifiedAt: (r.payment_verified_at as Date).toISOString(),
      finalizedAt: (r.finalized_at as Date).toISOString(),
      deadlinePolicyVersion: String(r.deadline_policy_version),
      configVersion: String(r.config_version),
    };
  }

  async findBySubmissionId(submissionId: string): Promise<SubmissionRow | null> {
    const { rows } = await this.db.query<{ application_id: string }>(
      `SELECT application_id FROM submission WHERE id = $1`,
      [submissionId],
    );
    if (!rows[0]) return null;
    return this.findSubmission(rows[0].application_id);
  }

  /**
   * Outbox 적재. aggregate_sequence 는 Application 별 단조 증가여야 한다. (v1.1 §A3)
   * 중앙이 sequence gap 으로 유실을 탐지하기 때문이다.
   */
  private async enqueueFinalizedEvent(
    client: PoolClient,
    src: {
      applicationId: string;
      universityId: string;
      subjectToken: string;
      admissionYear: number;
      admissionTypeCode: string;
      departmentCode: string;
      applicationNumber: string;
      requestedAt: string;
      paymentApprovedAt: string | null;
      finalizedAt: string;
      policyVersion: string;
      configVersion: string;
    },
  ): Promise<void> {
    const { rows } = await client.query<{ next: string }>(
      `SELECT COALESCE(MAX(aggregate_sequence), 0) + 1 AS next
         FROM outbox_event WHERE aggregate_id = $1`,
      [src.applicationId],
    );
    const sequence = Number(rows[0]?.next ?? 1);

    // 중앙에는 최소 정보만 보낸다.
    // 이름·주민등록번호·연락처·주소·원서본문·첨부파일은 넣지 않는다. (v1.1 §04)
    const data: ApplicationFinalizedData & {
      requestedAt: string;
      paymentApprovedAt: string | null;
      finalizedAt: string;
      applicationNumber: string;
    } = {
      universityId: src.universityId,
      applicationId: this.opaqueId(src.applicationId),
      // 중앙이 "내 원서"를 추려주려면 어느 지원자의 것인지 알아야 한다. (D-27)
      // 대학마다 값이 같아야 하므로 대학별 소금은 쓰지 않고, 목적 키로 HMAC 한다.
      // 키 없는 해시는 Vault 의 토큰으로 다시 만들 수 있어 분리가 아니었다. (D-39)
      subjectRef: subjectRefOf(src.subjectToken),
      admissionYear: src.admissionYear,
      admissionTypeCode: src.admissionTypeCode,
      departmentCode: src.departmentCode,
      status: 'FINALIZED',
      submittedAt: src.finalizedAt,
      requestedAt: src.requestedAt,
      paymentApprovedAt: src.paymentApprovedAt,
      finalizedAt: src.finalizedAt,
      applicationNumber: src.applicationNumber,
      integrityHash: `sha256:${createHash('sha256')
        .update(`${src.applicationId}|${src.applicationNumber}|${src.finalizedAt}`)
        .digest('hex')}`,
    };

    await client.query(
      `INSERT INTO outbox_event
         (id, aggregate_type, aggregate_id, aggregate_sequence, event_type,
          schema_version, payload, payload_hash, status)
       VALUES ($1,'APPLICATION',$2,$3,$4,'v1',$5,$6,'PENDING')`,
      [
        randomUUID(),
        src.applicationId,
        sequence,
        EVENT_TYPE.APPLICATION_FINALIZED,
        JSON.stringify(data),
        createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      ],
    );
  }

  /**
   * 접수번호. 추측 가능하면 남의 접수 상태를 훑을 수 있다. (§09 BOLA)
   * 연도·대학 접두사 + 무작위. 순번을 쓰지 않는다.
   */
  private issueApplicationNumber(admissionYear: number, universityId: string): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동되는 0/O/1/I 제외
    const bytes = randomBytes(10);
    let suffix = '';
    for (let i = 0; i < 10; i += 1) {
      suffix += alphabet[bytes[i]! % alphabet.length];
    }
    return `${admissionYear}-${universityId}-${suffix}`;
  }

  /** 분쟁 시 이 값으로 접수 내용의 동일성을 확인한다. (v1.1 §A11) */
  private evidenceHash(parts: Record<string, string>): string {
    const canonical = Object.keys(parts)
      .sort()
      .map((k) => `${k}=${parts[k]}`)
      .join('&');
    return createHash('sha256').update(canonical).digest('hex');
  }

  /** 중앙에 대학 원본 식별자를 그대로 노출하지 않는다. (v1.1 §A12) */
  /**
   * 중앙에는 원서 UUID 를 그대로 주지 않는다. (v1.1 §A3 최소 정보)
   * 소금이 고정값이면 중앙이 대학 내부 식별자를 역산할 수 있어
   * 가명처리의 의미가 사라진다. 운영에서는 필수다.
   */
  private opaqueId(applicationId: string): string {
    return createHash('sha256').update(`${CENTRAL_ID_SALT}|${applicationId}`).digest('hex');
  }

  private async assertRequiredDocuments(
    applicationId: string,
    cycleId: string,
    admissionTypeCode: string,
  ): Promise<void> {
    const { rows } = await this.db.query<{ config_json: { requiredDocuments?: Record<string, string[]> } }>(
      `SELECT config_json FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [cycleId],
    );
    const required = rows[0]?.config_json?.requiredDocuments?.[admissionTypeCode] ?? [];
    if (required.length === 0) return;

    const docs = await this.db.query<{ document_type: string }>(
      `SELECT document_type FROM document
        WHERE application_id = $1 AND status = 'AVAILABLE'`,
      [applicationId],
    );
    const available = new Set(docs.rows.map((d) => d.document_type));
    const missing = required.filter((t) => !available.has(t));

    if (missing.length > 0) {
      throw ProblemException.documentNotAvailable(
        `검사가 완료된 필수 서류가 없습니다: ${missing.join(', ')}`,
      );
    }
  }

  private async activeConfigVersion(cycleId: string): Promise<string> {
    const { rows } = await this.db.query<{ version: string }>(
      `SELECT version FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [cycleId],
    );
    return rows[0]?.version ?? 'none';
  }

  private async loadApplication(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT a.id, a.cycle_id, a.status, a.version,
              c.admission_year, c.university_id,
              t.code AS admission_type_code, d.code AS department_code,
              p.subject_token
         FROM application a
         JOIN applicant p ON p.id = a.applicant_id
         JOIN admission_cycle c ON c.id = a.cycle_id
         JOIN admission_type t ON t.id = a.admission_type_id
         JOIN department d ON d.id = a.department_id
        WHERE a.id = $1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
    return {
      id: String(r.id),
      cycleId: String(r.cycle_id),
      status: String(r.status),
      version: String(r.version),
      admissionYear: Number(r.admission_year),
      universityId: String(r.university_id),
      admissionTypeCode: String(r.admission_type_code),
      departmentCode: String(r.department_code),
      subjectToken: String(r.subject_token),
    };
  }

  private async loadFields(applicationId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<{ field_code: string; value_json: unknown }>(
      `SELECT field_code, value_json FROM application_field_value WHERE application_id = $1`,
      [applicationId],
    );
    return Object.fromEntries(rows.map((r) => [r.field_code, r.value_json]));
  }
}

/**
 * 중앙에 보내는 지원자 참조. (불일치 대장 D-27 · D-39, v1.1 §A12)
 *
 * `subject_token` 은 중앙이 발급한 가명 식별자다. 그대로 보내면 요약 테이블이
 * Vault 와 바로 조인된다. 키 없는 해시도 마찬가지다 — Vault 는 토큰을 갖고 있으니
 * 해시를 다시 계산하면 된다. 그래서 **"내 원서" 조회 목적의 키로 HMAC** 한다.
 * Vault 를 읽을 수 있어도 이 키가 없으면 조인되지 않는다.
 *
 * 대학별 소금을 섞지 않는다. 섞으면 같은 사람이 대학마다 다른 값이 되어
 * "내 원서" 를 한 화면에 모을 수 없다 — 그게 중앙이 존재하는 이유다.
 */
function subjectRefOf(subjectToken: string): string {
  return purposeRef(
    'DASHBOARD',
    { id: CENTRAL_SUBJECT_KEY_ID, secret: CENTRAL_SUBJECT_KEY },
    subjectToken,
  );
}
