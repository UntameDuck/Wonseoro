'use client';

import { useRef, useState } from 'react';
import { ApiError, NetworkError, api, newIdempotencyKey } from '../lib/api';
import { Alert, Button } from './components';

export interface UploadedDocument {
  documentType: string;
  status: string;
  guidance: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'verifying' }
  | { kind: 'done' }
  | { kind: 'failed'; reason: string };

/**
 * 서류 업로드 — 기술설계서 v1.0 §5.4, v1.1 §07·§B5
 *
 * **파일은 접수 API 를 지나지 않는다.** 브라우저가 Object Storage 로 직접 올린다.
 * 마감 피크에 서류 트래픽이 접수 API 의 CPU·메모리를 먹으면 안 된다.
 *
 * 화면 규칙 (§07)
 *   - 업로드 중 / 완료 / 검사 중 / 검사 실패를 **텍스트로** 제공한다
 *   - **Drag&Drop 만 제공하지 않는다.** 파일 선택 버튼이 항상 있어야 한다
 *   - 진행 상태를 색으로만 구분하지 않는다
 */
export function FileUpload({
  applicationId,
  applicantId,
  documentType,
  label,
  onUploaded,
}: {
  applicationId: string;
  applicantId: string;
  documentType: string;
  label: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [filename, setFilename] = useState<string | null>(null);

  async function upload(file: File) {
    setFilename(file.name);
    setPhase({ kind: 'preparing' });

    try {
      // 1. 업로드 의도. 형식·확장자·크기는 서버가 **URL 을 주기 전에** 거른다.
      const intent = await api.createUploadIntent(
        applicationId,
        {
          documentType,
          filename: file.name,
          mediaType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        },
        applicantId,
        newIdempotencyKey('upintent'),
      );

      // 2. 브라우저 → Object Storage 직접 PUT
      setPhase({ kind: 'uploading', percent: 0 });
      const put = await fetch(intent.data.uploadUrl, {
        method: 'PUT',
        headers: intent.data.requiredHeaders,
        body: file,
      });
      if (!put.ok) {
        setPhase({ kind: 'failed', reason: `업로드에 실패했습니다 (${put.status})` });
        return;
      }

      // 3. 해시를 브라우저에서 계산해 보낸다.
      //    서버는 이것을 믿지 않고 **다시 계산해 대조한다.** 위변조를 잡기 위함이다.
      setPhase({ kind: 'verifying' });
      const sha256 = await sha256Hex(file);

      await api.completeUpload(
        intent.data.documentId,
        { sha256, sizeBytes: file.size },
        applicantId,
        newIdempotencyKey('upcomplete'),
      );

      setPhase({ kind: 'done' });
      onUploaded();
    } catch (err) {
      if (err instanceof NetworkError) {
        setPhase({ kind: 'failed', reason: '서버에 연결할 수 없습니다.' });
        return;
      }
      if (err instanceof ApiError) {
        setPhase({ kind: 'failed', reason: err.problem.detail ?? err.problem.title });
        return;
      }
      setPhase({ kind: 'failed', reason: '업로드에 실패했습니다.' });
    }
  }

  return (
    <div
      style={{
        padding: 'var(--krds-space-4)',
        border: '1px solid var(--krds-border)',
        borderRadius: 'var(--krds-radius)',
        marginBottom: 'var(--krds-space-4)',
      }}
    >
      <p style={{ margin: '0 0 var(--krds-space-2)', fontWeight: 700 }}>{label}</p>
      <p
        style={{
          margin: '0 0 var(--krds-space-3)',
          fontSize: 'var(--krds-text-sm)',
          color: 'var(--krds-fg-muted)',
        }}
      >
        PDF · JPG · PNG 만 올릴 수 있습니다. 올린 뒤 악성코드 검사를 거칩니다.
      </p>

      {/* 파일 선택 버튼을 항상 제공한다. Drag&Drop 만 주지 않는다. (§07) */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <Button variant="secondary" onClick={() => inputRef.current?.click()}>
        파일 선택
      </Button>

      <div style={{ marginTop: 'var(--krds-space-3)' }}>
        <PhaseText phase={phase} filename={filename} />
      </div>
    </div>
  );
}

/** 진행 상태를 **텍스트로** 말한다. 진행바만 두지 않는다. */
function PhaseText({ phase, filename }: { phase: Phase; filename: string | null }) {
  const name = filename ? `${filename} — ` : '';

  if (phase.kind === 'idle') {
    return (
      <p style={{ margin: 0, fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
        선택된 파일이 없습니다.
      </p>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <p
        role="alert"
        style={{ margin: 0, color: 'var(--krds-danger)', fontWeight: 700, fontSize: 'var(--krds-text-sm)' }}
      >
        <span aria-hidden="true">✕ </span>
        {name}
        {phase.reason}
      </p>
    );
  }

  const text =
    phase.kind === 'preparing'
      ? '업로드를 준비하는 중…'
      : phase.kind === 'uploading'
        ? '업로드 중…'
        : phase.kind === 'verifying'
          ? '파일을 확인하는 중…'
          : '업로드 완료 — 악성코드 검사 중입니다';

  return (
    <p
      role="status"
      style={{
        margin: 0,
        fontSize: 'var(--krds-text-sm)',
        color: phase.kind === 'done' ? 'var(--krds-success)' : 'var(--krds-fg-muted)',
        fontWeight: phase.kind === 'done' ? 700 : 400,
      }}
    >
      <span aria-hidden="true">{phase.kind === 'done' ? '✓ ' : '⟳ '}</span>
      {name}
      {text}
    </p>
  );
}

/** 서류 상태 목록. self-check 가 주는 guidance 를 그대로 보여준다. */
export function DocumentStatusList({ documents }: { documents: UploadedDocument[] }) {
  if (documents.length === 0) {
    return (
      <Alert tone="info" title="아직 올린 서류가 없습니다">
        이 전형에 필요한 서류를 올려 주십시오.
      </Alert>
    );
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {documents.map((d) => {
        const tone =
          d.status === 'AVAILABLE'
            ? 'var(--krds-success)'
            : d.status === 'REJECTED'
              ? 'var(--krds-danger)'
              : 'var(--krds-fg-muted)';
        const icon = d.status === 'AVAILABLE' ? '✓' : d.status === 'REJECTED' ? '✕' : '⟳';
        return (
          <li
            key={`${d.documentType}-${d.status}`}
            style={{
              display: 'flex',
              gap: 'var(--krds-space-3)',
              padding: 'var(--krds-space-2) 0',
              borderBottom: '1px solid var(--krds-border)',
              fontSize: 'var(--krds-text-sm)',
            }}
          >
            <strong style={{ minWidth: 120 }}>{d.documentType}</strong>
            {/* 색만이 아니라 아이콘 + 안내문구를 함께 준다 */}
            <span style={{ color: tone, fontWeight: 700 }}>
              <span aria-hidden="true">{icon} </span>
              {d.guidance}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
