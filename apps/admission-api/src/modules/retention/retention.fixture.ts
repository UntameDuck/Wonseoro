/** 기준을 모두 만족하는 정책. 숫자는 시험용이지 권고값이 아니다. */
export const VALID_RETENTION = {
  APPLICATION_UNSUBMITTED: { days: 90 },
  APPLICATION_SUBMITTED: { days: 3650 },
  APPLICANT_PII_UNSUBMITTED: { days: 180 },
  APPLICANT_PII_SUBMITTED: { days: 3650 },
  DOCUMENT_FILE_UNSUBMITTED: { days: 365 },
  DOCUMENT_FILE_SUBMITTED: { days: 365 },
  PAYMENT_RECORD: { days: 3650 },
  CONSENT_RECORD: { days: 3650 },
  ADMIN_ACCESS_LOG: { days: 730 },
  ACCESS_GRANT_LOG: { days: 1095 },
};
