'use client';

import { Alert, Button } from '@wonseoro/krds';
import { useMemo, useState } from 'react';
import type { AdmissionType } from '../lib/api';
import {
  draftProblems,
  readForm,
  writeForm,
  type DocumentDraft,
  type FieldKind,
  type FormDraft,
  type FormFieldDraft,
} from '../lib/config-onboarding';

interface Props {
  config: Record<string, unknown>;
  types: AdmissionType[];
  onApply: (config: Record<string, unknown>) => void;
}

const KIND_LABEL: Record<FieldKind, string> = {
  text: '짧은 글',
  longText: '긴 글',
  integer: '정수',
  decimal: '숫자',
  email: '이메일',
};

/**
 * T-M6-01 — JSON Schema를 직접 쓰지 않아도 전형별 문항과 서류를 구성한다.
 * 고급 JSON 편집은 아래에 그대로 남겨 표준 범위 밖 키도 다룰 수 있게 한다.
 */
export function ConfigOnboarding({ config, types, onApply }: Props) {
  const initialDrafts = useMemo(
    () => Object.fromEntries(types.map((type) => [type.code, readForm(config, type.code)])),
    [config, types],
  );
  const [selected, setSelected] = useState(types[0]?.code ?? '');
  const [drafts, setDrafts] = useState<Record<string, FormDraft>>(initialDrafts);
  const [applied, setApplied] = useState(false);
  const current = drafts[selected];
  const problems = Object.values(drafts).flatMap(draftProblems);

  function update(mutator: (draft: FormDraft) => FormDraft) {
    setApplied(false);
    setDrafts((before) => ({ ...before, [selected]: mutator(before[selected]!) }));
  }

  function apply() {
    let next = config;
    for (const type of types) next = writeForm(next, drafts[type.code]!);
    onApply(next);
    setApplied(true);
  }

  if (types.length === 0 || !current) {
    return <Alert tone="warning" title="등록된 전형이 없습니다">먼저 모집의 전형을 등록한 뒤 양식을 구성해 주십시오.</Alert>;
  }

  return (
    <section aria-labelledby="onboarding-title" style={panel}>
      <div style={panelHead}>
        <div>
          <p style={eyebrow}>전형 양식 온보딩</p>
          <h3 id="onboarding-title" style={{ margin: 0, fontSize: 'var(--krds-text-xl)' }}>
            문항과 제출 서류 구성
          </h3>
        </div>
        <ol aria-label="구성 순서" style={steps}>
          {['전형 선택', '문항', '서류', '초안 반영'].map((label, index) => (
            <li key={label} style={step}><strong>{index + 1}</strong><span>{label}</span></li>
          ))}
        </ol>
      </div>

      <label htmlFor="onboarding-type" style={labelStyle}>구성할 전형</label>
      <select
        id="onboarding-type"
        value={selected}
        onChange={(event) => { setSelected(event.target.value); setApplied(false); }}
        style={control}
      >
        {types.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}
      </select>

      <fieldset style={fieldset}>
        <legend style={legend}>지원자가 입력할 문항</legend>
        <p style={help}>공통원서에서 가져올 항목은 지원자의 동의가 있을 때만 채워집니다.</p>
        {current.fields.length === 0 && <p style={empty}>아직 문항이 없습니다.</p>}
        <div style={stack}>
          {current.fields.map((field, index) => (
            <FieldEditor
              key={`${index}-${field.code}`}
              field={field}
              index={index}
              onChange={(next) => update((draft) => ({
                ...draft,
                fields: draft.fields.map((item, at) => at === index ? next : item),
              }))}
              onRemove={() => update((draft) => ({
                ...draft,
                fields: draft.fields.filter((_, at) => at !== index),
              }))}
            />
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() => update((draft) => ({
            ...draft,
            fields: [...draft.fields, blankField(draft.fields.length + 1)],
          }))}
        >
          문항 추가
        </Button>
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>지원자가 제출할 서류</legend>
        <p style={help}>필수 서류는 악성코드 검사가 끝나야 결제와 접수가 가능합니다.</p>
        {current.documents.length === 0 && <p style={empty}>제출 서류가 없습니다.</p>}
        <div style={stack}>
          {current.documents.map((document, index) => (
            <DocumentEditor
              key={`${index}-${document.code}`}
              document={document}
              index={index}
              onChange={(next) => update((draft) => ({
                ...draft,
                documents: draft.documents.map((item, at) => at === index ? next : item),
              }))}
              onRemove={() => update((draft) => ({
                ...draft,
                documents: draft.documents.filter((_, at) => at !== index),
              }))}
            />
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() => update((draft) => ({
            ...draft,
            documents: [...draft.documents, blankDocument(draft.documents.length + 1)],
          }))}
        >
          서류 추가
        </Button>
      </fieldset>

      {problems.length > 0 && (
        <Alert tone="warning" title={`고칠 내용 ${problems.length}건`}>
          <ul style={{ margin: 0, paddingLeft: '1.2em' }}>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </Alert>
      )}
      {applied && <Alert tone="success" title="구성 내용을 초안에 반영했습니다">아래 고급 편집에서 전체 내용을 확인한 뒤 초안을 만드십시오.</Alert>}
      <Button disabled={problems.length > 0} onClick={apply}>구성 내용을 초안에 반영</Button>
    </section>
  );
}

function FieldEditor({ field, index, onChange, onRemove }: {
  field: FormFieldDraft;
  index: number;
  onChange: (field: FormFieldDraft) => void;
  onRemove: () => void;
}) {
  const lengthKind = field.kind === 'text' || field.kind === 'longText' || field.kind === 'email';
  return (
    <section aria-labelledby={`field-${index}-title`} style={itemCard}>
      <div style={itemHead}>
        <h4 id={`field-${index}-title`} style={{ margin: 0 }}>{field.title || `새 문항 ${index + 1}`}</h4>
        <Button variant="danger" onClick={onRemove}>문항 삭제</Button>
      </div>
      <div style={grid}>
        <LabeledInput id={`field-${index}-title-input`} label="화면에 보일 이름" value={field.title} onChange={(title) => onChange({ ...field, title })} />
        <LabeledInput id={`field-${index}-code`} label="연동 코드" value={field.code} onChange={(code) => onChange({ ...field, code })} />
        <div>
          <label htmlFor={`field-${index}-kind`} style={labelStyle}>입력 방식</label>
          <select id={`field-${index}-kind`} value={field.kind} onChange={(event) => onChange({ ...field, kind: event.target.value as FieldKind })} style={control}>
            {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <LabeledInput id={`field-${index}-min`} label={lengthKind ? '최소 글자 수' : '최솟값'} value={field.min} inputMode="numeric" onChange={(min) => onChange({ ...field, min })} />
        <LabeledInput id={`field-${index}-max`} label={lengthKind ? '최대 글자 수' : '최댓값'} value={field.max} inputMode="numeric" onChange={(max) => onChange({ ...field, max })} />
      </div>
      <div style={checks}>
        <Check id={`field-${index}-required`} label="필수 문항" checked={field.required} onChange={(required) => onChange({ ...field, required })} />
        <Check id={`field-${index}-profile`} label="공통원서에서 가져오기" checked={field.profile} onChange={(profile) => onChange({ ...field, profile })} />
      </div>
    </section>
  );
}

function DocumentEditor({ document, index, onChange, onRemove }: {
  document: DocumentDraft;
  index: number;
  onChange: (document: DocumentDraft) => void;
  onRemove: () => void;
}) {
  return (
    <section aria-labelledby={`document-${index}-title`} style={itemCard}>
      <div style={itemHead}>
        <h4 id={`document-${index}-title`} style={{ margin: 0 }}>{document.title || `새 서류 ${index + 1}`}</h4>
        <Button variant="danger" onClick={onRemove}>서류 삭제</Button>
      </div>
      <div style={grid}>
        <LabeledInput id={`document-${index}-title-input`} label="화면에 보일 이름" value={document.title} onChange={(title) => onChange({ ...document, title })} />
        <LabeledInput id={`document-${index}-code`} label="연동 코드" value={document.code} onChange={(code) => onChange({ ...document, code: code.toUpperCase() })} />
      </div>
      <Check id={`document-${index}-required`} label="접수 전에 꼭 내야 하는 서류" checked={document.required} onChange={(required) => onChange({ ...document, required })} />
    </section>
  );
}

function LabeledInput({ id, label, value, onChange, inputMode }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: 'numeric';
}) {
  return <div><label htmlFor={id} style={labelStyle}>{label}</label><input id={id} value={value} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} style={control} /></div>;
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label htmlFor={id} style={checkLabel}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ width: 22, height: 22, flex: '0 0 auto' }} />
      <span>{label}</span>
    </label>
  );
}

function blankField(index: number): FormFieldDraft {
  return { code: `field${index}`, title: '', kind: 'text', required: false, profile: false, min: '', max: '', source: {} };
}

function blankDocument(index: number): DocumentDraft {
  return { code: `DOCUMENT_${index}`, title: '', required: false };
}

const panel = { border: '2px solid var(--krds-border)', borderLeft: '6px solid var(--krds-primary)', padding: 'var(--krds-space-5)', margin: 'var(--krds-space-5) 0', background: 'var(--krds-bg)' } as const;
const panelHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--krds-space-4)', flexWrap: 'wrap' } as const;
const eyebrow = { margin: '0 0 var(--krds-space-1)', color: 'var(--krds-primary)', fontWeight: 700, letterSpacing: '0.04em' } as const;
const steps = { listStyle: 'none', display: 'flex', gap: 'var(--krds-space-2)', flexWrap: 'wrap', margin: 0, padding: 0 } as const;
const step = { display: 'flex', alignItems: 'center', gap: 'var(--krds-space-1)', fontSize: 'var(--krds-text-sm)', padding: 'var(--krds-space-1) var(--krds-space-2)', background: 'var(--krds-bg-muted)', borderRadius: '999px' } as const;
const fieldset = { border: 0, borderTop: '1px solid var(--krds-border)', padding: 'var(--krds-space-5) 0 0', margin: 'var(--krds-space-5) 0' } as const;
const legend = { fontSize: 'var(--krds-text-lg)', fontWeight: 700, paddingRight: 'var(--krds-space-3)' } as const;
const help = { color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)', marginTop: 0 } as const;
const empty = { padding: 'var(--krds-space-4)', border: '1px dashed var(--krds-border)', color: 'var(--krds-fg-muted)' } as const;
const stack = { display: 'grid', gap: 'var(--krds-space-3)', marginBottom: 'var(--krds-space-3)' } as const;
const itemCard = { padding: 'var(--krds-space-4)', background: 'var(--krds-bg-muted)', border: '1px solid var(--krds-border)', borderRadius: 'var(--krds-radius)' } as const;
const itemHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--krds-space-3)', marginBottom: 'var(--krds-space-3)' } as const;
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--krds-space-3)' } as const;
const labelStyle = { display: 'block', fontWeight: 700, fontSize: 'var(--krds-text-sm)', margin: 'var(--krds-space-2) 0 var(--krds-space-1)' } as const;
const control = { width: '100%', minHeight: 44, padding: '0 var(--krds-space-2)', border: '1px solid var(--krds-border)', borderRadius: 'var(--krds-radius)', fontFamily: 'inherit', background: 'var(--krds-bg)' } as const;
const checks = { display: 'flex', gap: 'var(--krds-space-4)', flexWrap: 'wrap', marginTop: 'var(--krds-space-3)' } as const;
const checkLabel = { display: 'flex', alignItems: 'center', gap: 'var(--krds-space-2)', minHeight: 44 } as const;
