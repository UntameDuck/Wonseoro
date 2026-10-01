/**
 * 서류로 받는 파일 형식과 크기 상한 — 서버 검사(file-inspector)와 화면 안내가 같은 값을 쓴다. (T-M5-56, U-57)
 *
 * 전에는 화면이 "PDF · JPG · PNG 만" 을 문구로 박아 두고 크기 상한은 말하지 않았다. 와이어프레임은
 * "PDF, 최대 10MB, 1개" 처럼 올리기 전에 알려 준다. 서명(magic-byte) 검사는 서버에만 있다.
 * 대학이 다른 형식을 요구하면 설정으로 넓히지 않고 여기를 검토한다(허용 목록 방식).
 */
const MB = 1024 * 1024;

export interface UploadFormat {
  /** 화면에 보일 이름 */
  label: string;
  mediaType: string;
  extensions: readonly string[];
  maxBytes: number;
}

export const UPLOAD_FORMATS: readonly UploadFormat[] = [
  { label: 'PDF', mediaType: 'application/pdf', extensions: ['.pdf'], maxBytes: 10 * MB },
  { label: 'JPG', mediaType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], maxBytes: 5 * MB },
  { label: 'PNG', mediaType: 'image/png', extensions: ['.png'], maxBytes: 5 * MB },
];

/** "PDF 최대 10MB · JPG·PNG 최대 5MB" — 같은 상한끼리 묶는다 */
export function uploadLimitText(formats: readonly UploadFormat[] = UPLOAD_FORMATS): string {
  const groups = new Map<number, string[]>();
  for (const f of formats) groups.set(f.maxBytes, [...(groups.get(f.maxBytes) ?? []), f.label]);
  return [...groups.entries()].map(([bytes, labels]) => `${labels.join('·')} 최대 ${Math.round(bytes / MB)}MB`).join(' · ');
}
