// 로그인 화면 접근성 보완 — 기본 테마(keycloak.v2)의 빈칸을 화면이 그려진 뒤 채운다 (T-M5-02 단계 9)
//   1. 오류가 난 입력칸이 오류 문장을 설명(aria-describedby)으로 갖게 한다 — 스크린리더가 칸에서 바로 오류를 읽는다
//   2. 일회용 번호 화면의 사용자 이름 표시칸에 이름을 준다 — 기본 테마는 라벨이 없는 칸(#username)을 가리킨다
//   3. 언어 선택 목록의 영어 이름("languages")을 화면 언어로
(function () {
  function fix() {
    var korean = (document.documentElement.lang || '').indexOf('ko') === 0;

    var invalid = document.querySelectorAll('input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]');
    for (var i = 0; i < invalid.length; i++) {
      var input = invalid[i];
      if (input.getAttribute('aria-describedby')) continue;
      var error = document.getElementById('input-error-' + input.id) || document.getElementById('input-error-' + input.name)
        || document.getElementById('input-error');
      if (!error) {
        var group = input.closest('.pf-v5-c-form__group');
        error = group && group.querySelector('.kc-feedback-text');
        if (!error) error = document.querySelector('.kc-feedback-text');
      }
      if (!error) continue;
      if (!error.id) error.id = 'wonseoro-error-' + (input.id || i);
      input.setAttribute('aria-describedby', error.id);
    }

    var attempted = document.getElementById('kc-attempted-username');
    if (attempted && !document.getElementById('username')) {
      var label = document.querySelector('label[for="username"]');
      if (label) label.htmlFor = 'kc-attempted-username';
      else attempted.setAttribute('aria-label', korean ? '사용자 이름' : 'Username');
    }

    var languages = document.getElementById('login-select-toggle');
    if (languages && languages.getAttribute('aria-label') === 'languages') {
      languages.setAttribute('aria-label', korean ? '화면 언어' : 'Language');
    }
  }
  function run() {
    fix();
    // 시험이 보완이 끝났는지 알 수 있게 — 화면 동작에는 쓰지 않는다
    document.documentElement.setAttribute('data-wonseoro-a11y', 'ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
