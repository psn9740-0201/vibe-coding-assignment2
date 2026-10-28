// 분야 분류 회귀 테스트 (실행: npm test)
// 네트워크를 쓰지 않고 analyzer.js의 classify()만 검사한다

const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../backend/analyzer');
const realArticles = require('./fixtures/classify-articles.json').articles;

const categoryOf = (title, description = '') => classify({ title, description }).category;

// ── 실제 기사 (tests/fixtures/classify-articles.json) ──
for (const a of realArticles) {
  test(`실제: ${a.note} — ${a.title.slice(0, 30)}`, () => assert.strictEqual(classify(a).category, a.expected));
}

// ── 예시 제목: 분야별 정상 기사 ──
const NORMAL = [
  ['AI', '네이버, 초거대 AI 신모델 공개…기업용 에이전트 강화', '네이버가 새 거대언어모델을 공개했다.', 'AI'],
  ['AI: 핀테크(금융+IT)', '증권가, AI 기반 투자자문 서비스 잇달아 출시', '생성형 AI를 활용한 로보어드바이저가 늘고 있다.', 'AI'],
  ['반도체: D램/DRAM 별칭', 'SK하이닉스, 차세대 D램 양산', 'SK하이닉스가 DRAM 신제품을 양산한다. HBM 공급도 늘린다.', '반도체'],
  ['반도체: HBM4 (숫자 붙은 약어)', '삼성전자, HBM4 12단 양산 돌입', '', '반도체'],
  ['반도체: 영문 표기만', 'SK hynix, DRAM 가격 인상 통보', '', '반도체'],
  ['반도체: 금융+IT (제목에 기업)', '코스피, SK하이닉스 HBM 기대에 3%대 상승', '외국인 매수세가 반도체 업종에 몰렸다.', '반도체'],
  ['반도체: 요약에만 여러 근거', '삼성전자, 3분기 신제품 발표회 개최', '삼성전자가 HBM4와 파운드리 2나노 공정 로드맵을 공개했다. 메모리 사업 회복세도 강조했다.', '반도체'],
  ['클라우드', 'KT클라우드, 데이터센터 증설', '공공 클라우드 수요 대응', '클라우드'],
  ['클라우드: Azure 별칭', 'MS, Azure 리전 국내 추가 개설', '', '클라우드'],
  ['클라우드: 띄어 쓴 데이터 센터', '지방 데이터 센터 유치 경쟁 본격화', '', '클라우드'],
  ['사이버보안', '통신사 해킹으로 개인정보 유출', '침해사고 조사 착수', '사이버보안'],
  ['사이버보안: 인터넷진흥원 = KISA', '인터넷진흥원, 중소기업 무료 점검 확대', '', '사이버보안'],
];

// ── 예시 제목: 오분류 방지 ──
const MISCLASSIFIED = [
  ['금융 요약에 AI 한 번', '정부, 내년 청년 일자리 예산 확대', '청년 일자리 사업에는 인공지능(AI) 교육 과정도 포함된다.', null],
  ['금융 요약에 AI 표현 여러 개', '코스피 2% 하락 마감', '인공지능(AI) 거품 우려와 생성형 AI 투자 둔화가 겹치며 외국인 매도가 이어졌다.', null],
  ['동의어만 겹침 (인공지능(AI))', '정부, 내년 연구개발 방향 공개', '인공지능(AI) 분야 비중을 늘린다.', null],
  ['IDC = 시장조사기관 (데이터센터 아님)', 'IDC, 3분기 태블릿 출하량 3% 감소', '', null],
  ['스포츠 5G', "'가브리엘 두 골' 용인, 충북청주 원정서 2-0 승리 '5G 무승 탈출'", '', null],
  ['OpenAI 안의 AI 중복 없음', 'OpenAI 이사회 개편', '', 'AI'],
];

for (const [group, cases] of [['정상', NORMAL], ['오분류 방지', MISCLASSIFIED]]) {
  for (const [name, title, description, expected] of cases) {
    test(`예시 ${group}: ${name}`, () => assert.strictEqual(categoryOf(title, description), expected));
  }
}

// ── 카카오(기업) ↔ 카카오(코코아 원료) 문맥 ──
const KAKAO = [
  ['코코아: 제목에 초콜릿', '카카오 가격 급등에 초콜릿값 줄인상', '', null],
  ['코코아: 요약에만 코코아', '카카오값 사상 최고…제과업계 비상', '국제 코코아 선물 가격이 급등했다.', null],
  ['코코아: 카카오 선물 가격', '카카오 선물 가격 50% 급등', '', null],
  ['기업: AI 모델', '카카오, 온디바이스 AI 모델 공개', '', 'AI'],
  ['기업: 카카오톡', '카카오톡 개편에 이용자 반발', '', '플랫폼'],
  ['다른 기업명 영향 없음: 네이버', '네이버, 초콜릿 브랜드 입점 확대', '', '플랫폼'],
];
for (const [name, title, description, expected] of KAKAO) {
  test(`카카오 문맥: ${name}`, () => assert.strictEqual(categoryOf(title, description), expected));
}

// ── 알려진 한계 (todo: 결과를 보여 주지만 실패로 세지 않는다) ──
test('예시 한계: 초콜릿과 함께 나온 기업 카카오', { todo: "'초콜릿'이 있으면 카카오를 기업으로 보지 않아, 기업 협업 기사도 놓친다" }, () => {
  assert.strictEqual(categoryOf('카카오, 초콜릿 브랜드와 이모티콘 협업', ''), '플랫폼');
});
