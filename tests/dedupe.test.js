// 중복 기사 판별 회귀 테스트 (실행: npm test)
// 네트워크를 쓰지 않고, 고정된 제목만으로 createDedupe()의 판정을 확인한다

const test = require('node:test');
const assert = require('node:assert');
const { createDedupe } = require('../backend/newsService');
const realPairs = require('./fixtures/real-pairs.json').pairs;

// a를 먼저 고른 뒤 b가 중복으로 걸러지는지
function isDuplicate(a, b) {
  const isNew = createDedupe();
  isNew(a);
  return !isNew(b);
}

// ── 기본 테스트 10건 (예시 제목 포함) ──
const BASIC = [
  ['신정훈 의원/국회의원', '신정훈 의원, 폴리텍대학의 광주 반도체 미니팹 구축 구상 확인…연내 방침 확정·예산 반영 촉구', '신정훈 국회의원, 폴리텍대학의 광주 반도체 미니팹 구축 구상 확인… 연내 방침 확정·예산 반영 촉구 - 뉴스핌', true],
  ['롯데 기프티엘 해킹', '롯데 기프티엘 해킹…고객 이름·환불 계좌번호 유출', "롯데 계열 '기프티엘' 해킹…이름·연락처·환불계좌 유출", true],
  ['말머리·언론사만 다름', '[2026 국감] 배경훈 "지하철 5G 와이파이 전국 확산 위해 이통 3사 설득"', '배경훈 "지하철 5G 와이파이 전국 확산 위해 이통 3사 설득" - 연합뉴스', true],
  ['KT UAM 변형', 'KT, 인천 도서지역 UAM 실증 완료...5G·위성 통신 성공률 100%', 'KT, 인천 앞바다서 UAM 실증...5G·위성 통신 성공률 100%', true],
  ['다른 AI 데이터센터 기사', '"복잡한 인허가 한 번에"…과기정통부, AI 데이터센터 규제 풀고 2천억 투입', '신성이엔지, AI 데이터센터시장 정조준', false],
  ['부처만 다른 같은 문구', '과기정통부, AI 데이터센터 규제 완화 방안 발표', '산업부, AI 데이터센터 규제 완화 방안 발표', false],
  ['회사만 다른 같은 문구', '삼성전자, 3분기 영업이익 10조 돌파…메모리 회복', 'SK하이닉스, 3분기 영업이익 10조 돌파…메모리 회복', false],
  ['KT / SKT', 'KT, 5G 요금제 개편…데이터 무제한 확대', 'SKT, 5G 요금제 개편…데이터 무제한 확대', false],
  ['호선 숫자 다름', '인천 지하철 1호선 5G 와이파이 개통', '인천 지하철 2호선 5G 와이파이 개통', false],
  ['분기 숫자 다름', '네이버, 2분기 매출 역대 최대…커머스 성장', '네이버, 3분기 매출 역대 최대…커머스 성장', false],
];

// ── 별칭 테스트 10건 (data/aliases.json 연동) ──
const ALIAS = [
  ['北 / 북한', '北해킹조직 라자루스, PHP 악용 공격 준비 정황', '북한 해킹조직 라자루스, PHP 취약점 악용해 공격 준비 정황', true],
  ['Google / 구글', 'Google, 핀란드 데이터센터 건설 위해 나무 25만 그루 불법 벌목', '구글, 핀란드 AI 데이터센터 건설에 나무 25만 그루 불법 벌채', true],
  ['KERI / 전기연', "KERI, SiC 전력반도체 '불량 판별' 글로벌 기준 15년만에 바로잡았다", '전기연, ‘SiC 전력반도체 결함 발광 기준’ 15년만에 수정', true],
  ['KERI / 한국전기연구원', 'KERI, SiC 전력반도체 결함 판별 국제기준 오류 15년 만에 규명', '한국전기연구원, SiC 전력반도체 결함 판별 국제기준 오류 15년 만에 규명', true],
  ['같은 별칭·다른 사건', '구글, 핀란드 데이터센터 건설 착수', 'Google, 차세대 AI 모델 제미나이4 공개', false],
  ['같은 별칭·숫자 다름', 'Google, 3분기 클라우드 매출 역대 최대', '구글, 2분기 클라우드 매출 역대 최대', false],
  ['같은 부처·다른 발표', '과기정통부, AI 데이터센터 규제 완화 방안 발표', '과학기술정보통신부, 6G 주파수 경매 계획 발표', false],
  ['北美는 북한 아님', '北美 해킹조직, 국내 기업 공격 정황', '북한 해킹조직, 국내 기업 공격 정황', false],
  ['MS 문맥 없음', 'MS, 3분기 실적 호조', '마이크로소프트, 3분기 실적 호조', false],
  ['MS 문맥 있음', 'MS, 애저 클라우드 3분기 매출 급증', '마이크로소프트, 애저 클라우드 3분기 매출 급증', true],
];

for (const [group, cases] of [['기본', BASIC], ['별칭', ALIAS]]) {
  for (const [name, a, b, expected] of cases) {
    test(`${group}: ${name}`, () => assert.strictEqual(isDuplicate(a, b), expected));
  }
}

// ── 실제 기사 회귀 테스트 5쌍 (real-pairs.json의 id) ──
// todo: 아직 해결하지 못한 사례. 결과가 틀려도 실패로 세지 않지만 매번 결과를 보여 준다
const REGRESSION = [
  { id: 6, note: 'HD현대사이트솔루션 / HD현대: 같은 주어 → 기준 0.45로 해결' },
  { id: 17, note: '조용호 오산시장: 같은 주어 → 기준 0.45로 해결' },
  { id: 8, note: '국감 상투 문구("우려 확산", "범부처 대응책 마련")만 겹친 다른 사건 → 사건 단서가 없어 별개로 해결' },
  { id: 12, todo: "'삼전닉스'(두 회사 합성어)와 '삼성·하이닉스'는 별칭으로 묶을 수 없고 유사도 0.46" },
  { id: 13, todo: '같은 PHP 관련 조치인지 제목만으로 확인할 수 없음 (수량·요약 없음, 유사도 0.43)' },
];
for (const { id, note, todo } of REGRESSION) {
  const p = realPairs.find((x) => x.id === id);
  test(`실제 #${id}: ${note || todo}`, { todo }, () => assert.strictEqual(isDuplicate(p.a, p.b), p.same));
}

// ── 실제 화면·수집 기사에서 발견한 사례 (23쌍 평가에는 넣지 않는다) ──
const FOUND = [
  // 2026-10-25 실제 카드에 함께 노출됐던 같은 사건: 유사도 0.26이지만 이름(‘기프티엘’)·사건 낱말(해킹·유출)·피해 규모(1만8천여명)가 같다
  ['기프티엘 해킹 (제목 표현이 크게 다름)', '기프티엘 개인정보 유출 1만8359명…해킹 인지 직후 서비스 중단', '롯데 계열 ‘기프티엘’ 해킹…1만8천여명 이름·휴대전화·계좌번호 등 유출', true],
  // PHP 사태의 서로 다른 후속 기사: 'PHP+해킹+취약점'은 같아도 확인할 수량·요약이 없어 묶지 않는다
  ['PHP 사태 후속 기사 (새 취약점 / 해킹 시도 흔적)', 'PHP2Shell 해킹 비상…보안 패치해도 남는 새 취약점 발견', '아마존 보안책임자 "PHP 취약점 발견 나흘 전부터 해킹 시도 흔적 나와"', false],
];
for (const [name, a, b, expected] of FOUND) {
  test(`실제 발견: ${name}`, () => assert.strictEqual(isDuplicate(a, b), expected));
}
// 같은 장관의 다른 자리 사진 설명 (기조연설 / 국정감사): 이번 수정 전후 모두 묶인다
test('실제 발견: 같은 장관·다른 자리 사진 설명', { todo: '인물 이름만 겹치는 사진 설명은 행사 차이를 제목 규칙으로 가르기 어려움' }, () => {
  assert.strictEqual(isDuplicate('기조연설하는 김정관 산업통상부 장관', '국정감사 답변하는 김정관 산업통상부 장관'), false);
});

// ── 실제 기사 23쌍 전체: 현재 수준보다 나빠지지 않는지 ──
test('실제 23쌍: 같은 사건 14쌍 이상 탐지, 오탐 0쌍', () => {
  let found = 0;
  let falsePositive = 0;
  for (const p of realPairs) {
    const dup = isDuplicate(p.a, p.b);
    if (dup && p.same) found++;
    if (dup && !p.same) falsePositive++;
  }
  const same = realPairs.filter((p) => p.same).length;
  console.log(`  실제 23쌍 → 탐지 ${found}/${same}, 오탐 ${falsePositive}/${realPairs.length - same}`);
  assert.ok(found >= 14, `탐지 ${found}/${same}`);
  assert.ok(falsePositive === 0, `오탐 ${falsePositive}`);
});
