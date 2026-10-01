// T-M5-42 스크린리더 — 브라우저가 스크린리더에 넘기는 정보(접근성 트리)를 CDP 로 읽어 본다.
//
// 실제 스크린리더(NVDA·센스리더·VoiceOver)로 듣는 검사는 사람이 한다(T-M5-48). 여기서는 스크린리더가 읽을 **재료**가
// 빠짐없이 있는지를 매번 같은 방식으로 본다 — 재료가 없으면 어떤 스크린리더도 읽지 못한다.
//   Label  — 입력칸·버튼·링크·체크·선택 목록마다 이름이 있다. 필수 칸은 "필수" 로 알린다
//   Error  — 오류가 있는 칸은 "올바르지 않음" 이고, 그 칸의 설명으로 오류 문장을 읽는다
//   Step   — 단계 표시에 "현재 단계" 가 하나, 화면 제목(탭 제목)이 있다, 큰 제목(h1)이 하나
//   Status — 알림 영역(role=status·alert·aria-live) 안에 매초 바뀌는 글(남은 시간 카운트다운)이 없다
//            — 있으면 스크린리더가 매초 끼어들어 읽는다

const CONTROL_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'checkbox', 'radio', 'button', 'link', 'switch', 'slider']);

const prop = (n, name) => n.properties?.find((p) => p.name === name)?.value?.value;

/** 화면 하나의 접근성 트리 점검. 문제 목록을 돌려준다. */
export async function axAudit(b) {
  await b.send('Accessibility.enable');
  const { nodes } = await b.send('Accessibility.getFullAXTree');
  const live = nodes.filter((n) => !n.ignored);
  const problems = [];

  for (const n of live) {
    const role = n.role?.value;
    const name = (n.name?.value ?? '').trim();
    if (CONTROL_ROLES.has(role) && !name && prop(n, 'focusable')) problems.push(`이름 없는 ${role}`);
    if (prop(n, 'invalid') === 'true' && !(n.description?.value ?? '').trim()) {
      problems.push(`오류 칸 "${name}" 이 오류 문장을 설명으로 갖지 않는다`);
    }
  }

  const h1 = live.filter((n) => n.role?.value === 'heading' && prop(n, 'level') === 1);
  if (h1.length !== 1) problems.push(`큰 제목(h1)이 ${h1.length}개`);

  const dom = await b.evaluate(`(() => {
    const steps = document.querySelector('nav[aria-label="원서접수 진행 단계"]');
    const regions = [...document.querySelectorAll('[role=status], [role=alert], [aria-live]')]
      .filter((e) => e.getAttribute('aria-live') !== 'off')
      .map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim());
    return {
      title: document.title,
      steps: steps ? steps.querySelectorAll('[aria-current=step]').length : null,
      regions,
    };
  })()`);
  if (!dom.title.trim()) problems.push('화면 제목(title)이 없다');
  if (dom.steps !== null && dom.steps !== 1) problems.push(`단계 표시의 현재 단계가 ${dom.steps}개`);
  for (const t of dom.regions) {
    if (/\d+\s*(초|분|시간|일)(\s*\d+\s*(초|분|시간))?\s*남음/.test(t)) {
      problems.push(`알림 영역 안에 남은 시간 카운트다운이 있다 — "${t.slice(0, 40)}"`);
    }
  }
  return { problems, title: dom.title, liveRegions: dom.regions.filter(Boolean) };
}

/** 지금 포커스 자리를 스크린리더가 읽을 재료 — 역할·이름·상태·설명. 사람이 듣는 검사(T-M5-48)의 대본으로 쓴다. */
export async function axFocused(b) {
  const r = await b.send('Runtime.evaluate', { expression: 'document.activeElement' });
  if (!r.result?.objectId) return null;
  const { nodes } = await b.send('Accessibility.getPartialAXTree', { objectId: r.result.objectId, fetchRelatives: false });
  const n = nodes.find((x) => !x.ignored) ?? nodes[0];
  if (!n) return null;
  const states = [];
  if (prop(n, 'required')) states.push('필수');
  if (prop(n, 'invalid') === 'true') states.push('올바르지 않음');
  const checked = prop(n, 'checked');
  if (checked !== undefined) states.push(checked === 'true' ? '선택됨' : '선택 안 됨');
  if (prop(n, 'disabled')) states.push('사용 불가');
  const desc = (n.description?.value ?? '').trim();
  return {
    role: n.role?.value ?? '',
    name: (n.name?.value ?? '').trim(),
    states,
    description: desc,
    text: `${n.role?.value ?? ''} "${(n.name?.value ?? '').trim()}"${states.length ? ` ${states.join(' ')}` : ''}${desc ? ` — ${desc}` : ''}`,
  };
}
