import { Injectable } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../problem/problem.exception';

/**
 * 소유권 확인 — 기술설계서 v1.0 §8.3, v1.1 §09 (Information Disclosure)
 *
 * 원서 식별자는 URL 에 그대로 드러난다. 그것만으로 남의 원서를 읽거나 고칠 수 있으면
 * 접수 시스템으로 성립하지 않는다. **조회도 예외가 아니다** — 원서 본문에는
 * 자기소개서와 지원 동기가 들어 있다.
 *
 * 없는 자원과 남의 자원을 **같은 오류로 돌려준다.**
 * 403 과 404 를 구분해 주면 "이 식별자는 존재한다"를 알려주는 셈이라
 * 식별자를 훑어 유효한 원서를 찾아낼 수 있다.
 */
@Injectable()
export class Ownership {
  constructor(private readonly db: Db) {}

  async assertApplication(applicationId: string, applicantId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM application WHERE id = $1 AND applicant_id = $2`,
      [applicationId, applicantId],
    );
    if (!rowCount) throw notFound('원서');
  }

  async assertPayment(paymentId: string, applicantId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM payment p
         JOIN application a ON a.id = p.application_id
        WHERE p.id = $1 AND a.applicant_id = $2`,
      [paymentId, applicantId],
    );
    if (!rowCount) throw notFound('결제');
  }

  async assertDocument(documentId: string, applicantId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM document d
         JOIN application a ON a.id = d.application_id
        WHERE d.id = $1 AND a.applicant_id = $2`,
      [documentId, applicantId],
    );
    if (!rowCount) throw notFound('서류');
  }

  async assertSubmission(submissionId: string, applicantId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM submission s
         JOIN application a ON a.id = s.application_id
        WHERE s.id = $1 AND a.applicant_id = $2`,
      [submissionId, applicantId],
    );
    if (!rowCount) throw notFound('접수');
  }
}

/** 없는 것과 남의 것을 구분해서 알려주지 않는다. */
function notFound(what: string): ProblemException {
  return ProblemException.validationFailed(`존재하지 않는 ${what}입니다.`);
}
