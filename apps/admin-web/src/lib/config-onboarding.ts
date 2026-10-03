import type { AdmissionType } from './api';

export type FieldKind = 'text' | 'longText' | 'integer' | 'decimal' | 'email';

export interface FormFieldDraft {
  code: string;
  title: string;
  kind: FieldKind;
  required: boolean;
  profile: boolean;
  min: string;
  max: string;
  source: Record<string, unknown>;
}

export interface DocumentDraft {
  code: string;
  title: string;
  required: boolean;
}

export interface FormDraft {
  typeCode: string;
  fields: FormFieldDraft[];
  documents: DocumentDraft[];
}

type ObjectMap = Record<string, unknown>;

export function isObject(value: unknown): value is ObjectMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emptyConfig(types: readonly AdmissionType[]): ObjectMap {
  return {
    forms: Object.fromEntries(
      types.map((type) => [
        type.code,
        { type: 'object', additionalProperties: false, required: [], properties: {} },
      ]),
    ),
    requiredDocuments: {},
    optionalDocuments: {},
    documentLabels: {},
  };
}

export function readForm(config: ObjectMap, typeCode: string): FormDraft {
  const forms = isObject(config.forms) ? config.forms : {};
  const form = isObject(forms[typeCode]) ? forms[typeCode] : {};
  const properties = isObject(form.properties) ? form.properties : {};
  const required = new Set(
    Array.isArray(form.required) ? form.required.filter((v): v is string => typeof v === 'string') : [],
  );
  const fields = Object.entries(properties).map(([code, raw]): FormFieldDraft => {
    const source = isObject(raw) ? raw : {};
    const type = source.type;
    const kind: FieldKind = source.format === 'email'
      ? 'email'
      : type === 'integer'
        ? 'integer'
        : type === 'number'
          ? 'decimal'
          : source['x-multiline'] === true
            ? 'longText'
            : 'text';
    const lengthKind = kind === 'text' || kind === 'longText' || kind === 'email';
    return {
      code,
      title: typeof source.title === 'string' ? source.title : '',
      kind,
      required: required.has(code),
      profile: source['x-profile'] === true,
      min: numberText(lengthKind ? source.minLength : source.minimum),
      max: numberText(lengthKind ? source.maxLength : source.maximum),
      source,
    };
  });

  const requiredDocuments = stringArrayFrom(config.requiredDocuments, typeCode);
  const optionalDocuments = stringArrayFrom(config.optionalDocuments, typeCode)
    .filter((code) => !requiredDocuments.includes(code));
  const labels = isObject(config.documentLabels) ? config.documentLabels : {};
  const documents = [...requiredDocuments, ...optionalDocuments].map((code) => ({
    code,
    title: typeof labels[code] === 'string' ? labels[code] as string : '',
    required: requiredDocuments.includes(code),
  }));
  return { typeCode, fields, documents };
}

export function writeForm(config: ObjectMap, draft: FormDraft): ObjectMap {
  const forms = isObject(config.forms) ? config.forms : {};
  const previous = objectClone(forms[draft.typeCode]);
  const properties = Object.fromEntries(draft.fields.map((field) => [field.code.trim(), writeField(field)]));
  const required = draft.fields.filter((field) => field.required).map((field) => field.code.trim());

  const requiredDocuments = objectClone(config.requiredDocuments);
  const optionalDocuments = objectClone(config.optionalDocuments);
  const labels = objectClone(config.documentLabels);
  requiredDocuments[draft.typeCode] = draft.documents.filter((d) => d.required).map((d) => d.code.trim());
  optionalDocuments[draft.typeCode] = draft.documents.filter((d) => !d.required).map((d) => d.code.trim());
  for (const document of draft.documents) labels[document.code.trim()] = document.title.trim();

  return {
    ...config,
    forms: {
      ...forms,
      [draft.typeCode]: {
        ...previous,
        type: 'object',
        additionalProperties: false,
        required,
        properties,
      },
    },
    requiredDocuments,
    optionalDocuments,
    documentLabels: labels,
  };
}

/** 화면에서 바로 고칠 수 있는 오류만 빠르게 알려준다. 최종 판정은 서버 Config Linter가 한다. */
export function draftProblems(draft: FormDraft): string[] {
  const problems: string[] = [];
  const fieldCodes = new Set<string>();
  const documentCodes = new Set<string>();
  for (const field of draft.fields) {
    const code = field.code.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(code)) {
      problems.push('항목 코드는 영문으로 시작하고 영문·숫자·밑줄만 써야 합니다.');
    } else if (fieldCodes.has(code)) {
      problems.push(`항목 코드 ${code}가 두 번 있습니다.`);
    }
    fieldCodes.add(code);
    if (!field.title.trim()) problems.push(`${code || '이름 없는 항목'}의 화면 이름을 입력해 주십시오.`);
    if (!validBound(field.min) || !validBound(field.max)) problems.push(`${code || '이름 없는 항목'}의 범위는 숫자로 입력해 주십시오.`);
    if (validBound(field.min) && validBound(field.max) && field.min !== '' && field.max !== '' && Number(field.min) > Number(field.max)) {
      problems.push(`${field.title || code || '항목'}의 최솟값이 최댓값보다 큽니다.`);
    }
  }
  for (const document of draft.documents) {
    const code = document.code.trim();
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
      problems.push('서류 코드는 대문자로 시작하고 대문자·숫자·밑줄만 써야 합니다.');
    } else if (documentCodes.has(code)) {
      problems.push(`서류 코드 ${code}가 두 번 있습니다.`);
    }
    documentCodes.add(code);
    if (!document.title.trim()) problems.push(`${code || '이름 없는 서류'}의 화면 이름을 입력해 주십시오.`);
  }
  return [...new Set(problems)];
}

function writeField(field: FormFieldDraft): ObjectMap {
  const next = { ...field.source };
  delete next.type;
  delete next.format;
  delete next.minLength;
  delete next.maxLength;
  delete next.minimum;
  delete next.maximum;
  delete next['x-profile'];
  delete next['x-multiline'];

  next.type = field.kind === 'integer' ? 'integer' : field.kind === 'decimal' ? 'number' : 'string';
  next.title = field.title.trim();
  if (field.kind === 'email') next.format = 'email';
  if (field.kind === 'longText') next['x-multiline'] = true;
  if (field.profile) next['x-profile'] = true;
  const lengthKind = field.kind === 'text' || field.kind === 'longText' || field.kind === 'email';
  if (field.min !== '') next[lengthKind ? 'minLength' : 'minimum'] = Number(field.min);
  if (field.max !== '') next[lengthKind ? 'maxLength' : 'maximum'] = Number(field.max);
  return next;
}

function objectClone(value: unknown): ObjectMap {
  return isObject(value) ? { ...value } : {};
}

function stringArrayFrom(value: unknown, typeCode: string): string[] {
  const map = isObject(value) ? value : {};
  return Array.isArray(map[typeCode]) ? map[typeCode].filter((v): v is string => typeof v === 'string') : [];
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function validBound(value: string): boolean {
  return value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0);
}
