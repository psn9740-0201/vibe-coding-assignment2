// 기사 분류, 업계 영향 분석 (외부 AI 없이 키워드 규칙 기반)

const { variantsOf, getEntry, entries: ALIAS_ENTRIES } = require('./aliasStore');

// ── 1. 분야 분류 키워드 ─────────────────────────────
// 여기에는 '어떤 단어가 어느 분야의 근거인지'(분류 규칙)만 적는다. 단어마다 대표 표기 하나만 쓰고,
// 같은 대상의 다른 표기(예: 'D램' ↔ 'DRAM', 'AWS' ↔ '아마존웹서비스')는 data/aliases.json에서 관리한다.
// 배열로 묶은 키워드는 서로 다른 대상이지만 근거로는 하나로 센다
// (예: 'AI 데이터센터'·'AIDC'는 '데이터센터'와 같은 근거 → 'AI 데이터센터'가 데이터센터 근거를 두 번 얻지 않게)
const CATEGORY_KEYWORDS = {
  AI: ['인공지능', '생성형', '거대언어모델', '챗GPT', '오픈AI', '딥러닝', '머신러닝', '에이전트', '피지컬AI', '파운데이션 모델'],
  반도체: ['반도체', 'HBM', 'D램', '낸드', '파운드리', '메모리', '웨이퍼', 'TSMC', '엔비디아', 'GPU', 'NPU', 'AI 칩', 'SK하이닉스', '팹리스'],
  클라우드: ['클라우드', ['데이터센터', 'AI 데이터센터'], 'AWS', '애저', 'SaaS', 'IaaS', 'GPU 서버', 'CSP', '하이퍼스케일', '구글 클라우드'],
  사이버보안: ['보안', '해킹', '랜섬웨어', '개인정보', '유출', '사이버', '침해', '피싱', '악성코드', '취약점', 'KISA', '제로트러스트', '디도스'],
  통신: ['통신사', '이동통신', '5G', '6G', 'SK텔레콤', 'KT', 'LG유플러스', '주파수', '알뜰폰', '위성통신', '요금제', '통신망'],
  플랫폼: ['플랫폼', '네이버', '카카오', '쿠팡', '배달의민족', '앱마켓', '이커머스', '유튜브', '포털', '빅테크'],
};

// 키워드마다 별칭 DB의 표기를 펼쳐 '같은 뜻 묶음'을 만든다. 묶음 안의 표기는 함께 나와도 1개로 센다
// (예: '인공지능(AI)' → 1점). 같은 항목을 가리키는 키워드가 둘이면 하나로 합친다
const CATEGORIES = Object.fromEntries(Object.entries(CATEGORY_KEYWORDS).map(([cat, words]) => {
  const groups = new Map();
  for (const w of words) {
    const variants = [].concat(w).flatMap((x) => variantsOf(x));
    groups.set(variants[0].name, variants);
  }
  return [cat, [...groups.values()]];
}));

// 별칭 DB와 분류 규칙이 서로 어긋나면 서버 시작 시 알린다 (분류에는 영향 없음)
for (const e of ALIAS_ENTRIES) {
  for (const c of e.categories) if (!CATEGORY_KEYWORDS[c]) console.warn(`[별칭 DB] ${e.canonical}: 알 수 없는 분야 '${c}'`);
}
for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const w of words.flat()) {
    const e = getEntry(w);
    if (e && !e.categories.includes(cat)) console.warn(`[별칭 DB] ${e.canonical}: '${cat}' 분류 키워드인데 categories에 '${cat}'이 없습니다`);
  }
}

// IT와 관련성이 낮은 금융·증시 기사 신호 (보조 필터)
const FINANCE_WORDS = ['증시', '코스피', '코스닥', '주가수익', 'PER', '밸류에이션', '외국인 매도', '공매도', '증권가', '목표주가', '환율', '국채', '금리'];

// ── 2. 정부 부처 키워드 ─────────────────────────────
// 카드에 표시할 부처 이름 → 별칭 DB의 표준명. 부처의 여러 표기(예: '과기부', '산업통상자원부')는 data/aliases.json에서 관리한다
const MINISTRY_ENTRIES = { 과기정통부: '과학기술정보통신부', 산업부: '산업통상부', 행안부: '행정안전부' };
const MINISTRIES = Object.fromEntries(Object.entries(MINISTRY_ENTRIES).map(([label, canonical]) => {
  if (!getEntry(canonical)) console.warn(`[별칭 DB] 부처 '${canonical}' 항목이 없어 '${label}'만으로 찾습니다`);
  return [label, getEntry(canonical) ? variantsOf(canonical).map((v) => v.name) : [label]];
}));

// 정책 기사로 판단할 때 쓰는 단어
const POLICY_WORDS = ['정책', '발표', '추진', '시행', '개정', '지원', '계획', '전략', '예산', '법안', '고시', '규제', '제도', '사업', '공모', '착수', '확정', '방안', '가이드라인', '개편'];

// 단어가 text에 몇 번 나오는지 센다. w는 문자열 또는 별칭 DB의 표기 { name, context, notFollowedBy, notContext }
// ctx는 문맥을 판단할 글 (기본은 text, 분류할 때는 제목+요약 전체)
function countWord(text, w, ctx = text) {
  const { name, context = [], notFollowedBy = [], notContext = [] } = typeof w === 'string' ? { name: w } : w;
  // 뜻이 여러 개인 이름은 문맥이 맞을 때만 센다 (data/aliases.json의 조건)
  if (context.length && !context.some((c) => ctx.toLowerCase().includes(c.toLowerCase()))) return 0;
  if (notContext.some((c) => ctx.includes(c))) return 0;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 'AI', 'KT' 같은 짧은 영문 약어는 오탐을 줄이기 위해 대소문자 구분 + 앞뒤가 영문이 아닐 때만
  // '5G', '6G'처럼 숫자+대문자 약어는 대소문자만 구분한다 ('5g'(그램)와 구별, '6GHz'는 그대로 일치)
  const re = /^[A-Z]{2,4}$/.test(name) ? new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'g')
    : /^\d+[A-Z]+$/.test(name) ? new RegExp(escaped, 'g')
    : new RegExp(escaped, 'gi');
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (!notFollowedBy.some((x) => text.startsWith(x, m.index + m[0].length))) n++;
  }
  return n;
}

// 키워드(또는 동의어 묶음)별 등장 횟수. 동의어 묶음은 가장 많이 나온 표기의 횟수로 센다
const groupCounts = (text, words, ctx) => words.map((w) => Math.max(...[].concat(w).map((s) => countWord(text, s, ctx))));

// 일치한 키워드(동의어 묶음은 1개) 수
function countHits(text, words, ctx) {
  return groupCounts(text, words, ctx).filter((n) => n > 0).length;
}

// Google 뉴스 요약문은 '제목 + 언론사'뿐이라 제목과 겹치므로 요약이 아닌 것으로 본다
function summaryOf(article) {
  return article.description.startsWith(article.title.slice(0, 15)) ? '' : article.description;
}

const NOISE_WORDS = ['K리그', '프로야구', '축구', '야구', '골프', '우승', '바카라', '카지노', '슬롯', '토토', '무승', '무패', '연승', '연패', '경질'];
// 스포츠 기사의 '5G'(5경기), '두 골', '7골' 같은 표현 (통신 키워드 '5G'와 구별)
const NOISE_PATTERN = /\d+G\s*(연속|\d+골)|\d+골|[한두세] 골(?!목)/;
const isNoise = (title) => NOISE_WORDS.some((w) => title.includes(w)) || NOISE_PATTERN.test(title);

// 기사가 해당 분야를 실제로 다루는지 판단하고 점수를 매긴다 (Google 뉴스·언론사 RSS 공통 기준)
//  - 제목에 분야 키워드가 있으면 채택
//  - 제목엔 없고 요약문에만 있으면, 서로 다른 키워드가 2개 이상 나와야 채택 (지나가는 한 번 언급은 제외)
//  - 증시·금융 기사로 보이면 제목에 분야 키워드가 있을 때만 채택 (예: 'SK하이닉스 주가…'는 유지)
// ── IT가 기사의 핵심 주제인지 (경제·시장 기사 구분) ──
// 여러 소식을 묶은 기사: IT는 여러 이슈 중 하나일 뿐이다 (예: '[아주경제 오늘의 뉴스 종합] 반도체만 맑음… 外')
// 단, 말머리가 IT 업계 소식 모음이면 IT 기사다 (예: '[통신업계 소식] … 外')
const ROUNDUP_PATTERN = /뉴스 ?종합|오늘의 ?뉴스|주요 ?뉴스|헤드라인|경제 ?브리핑|모닝 ?브리핑|外\s*$/;
const IT_SECTOR_TAG = /^\s*\[[^\]]*(IT|ICT|테크|통신|반도체|AI|클라우드|보안|플랫폼|과학)[^\]]*\]/;
// 투자 상품·자금 흐름 기사: IT 기업·업종은 투자 대상으로만 등장한다 (예: '반도체 레버리지 ETF 순매수')
const INVESTMENT_WORDS = ['ETF', '레버리지', '순매수', '순매도', '서학개미', '동학개미', '펀드'];
// IT가 시장·경제에 미친 영향을 말하는 표현 (예: '반도체 수출 견인', '반도체 호황 효과', '반도체의 힘', '반도체 쏠림')
const IMPACT_WORDS = ['견인', '호황', '효과', '의 힘', '덕', '끌어올', '쏠림', '착시', '이후', '실적', '수출'];
// 시장·거시경제 기사 신호. 이런 제목은 IT가 원인·주체일 때만 IT 기사로 본다
const MARKET_WORDS = [...FINANCE_WORDS, '주가', '경상흑자', '경상수지', '무역수지', '경기 기대', '경기 전망', '내수', '물가', '성장률', 'GDP', '선행지수'];

// text에서 words 중 가장 먼저 나오는 위치 (없으면 -1)
function firstIndex(text, words, ctx) {
  let first = -1;
  for (const w of words.flat()) {
    const name = typeof w === 'string' ? w : w.name;
    if (countWord(text, w, ctx) === 0) continue;
    const i = text.toLowerCase().indexOf(name.toLowerCase());
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  return first;
}

// 제목 속 IT 키워드가 '·'로 다른 경제 요인과 나란히 놓였는지 (예: '美 FOMC·반도체 실적 앞두고')
function listedAmongFactors(title, words, ctx) {
  for (const w of words.flat()) {
    if (countWord(title, w, ctx) === 0) continue;
    const name = typeof w === 'string' ? w : w.name;
    const i = title.toLowerCase().indexOf(name.toLowerCase());
    const before = title.slice(0, i).match(/([^\s·‧,…]+)[·‧]$/);
    const after = title.slice(i + name.length).match(/^[·‧]([^\s·‧,…]+)/);
    const neighbor = (before && before[1]) || (after && after[1]);
    if (neighbor && !isItWord(neighbor)) return true;
  }
  return false;
}
// 어느 분야든 IT 키워드이거나 별칭 DB의 기업·기관이면 IT 낱말로 본다
const isItWord = (w) => Object.values(CATEGORIES).some((groups) => countHits(w, groups) > 0) || Boolean(getEntry(w));

// IT 키워드 바로 뒤(8자 안)에 영향 표현이 오는지 (예: '반도체 호황에', '반도체 수출 견인')
function hasImpactPhrase(title, words, ctx) {
  for (const w of words.flat()) {
    if (countWord(title, w, ctx) === 0) continue;
    const name = typeof w === 'string' ? w : w.name;
    const i = title.toLowerCase().indexOf(name.toLowerCase());
    const window = title.slice(i + name.length, i + name.length + 8);
    if (IMPACT_WORDS.some((x) => window.includes(x))) return true;
  }
  return false;
}

// 제목에 분야 키워드가 있을 때, 그 IT 주제가 기사의 핵심인지 판단한다
//  - 여러 소식 묶음(IT 업계 소식 모음 제외), 투자 상품·자금 흐름 기사 → 제외 (IT가 단순 언급됨)
//  - 시장·경제 기사는 IT 산업의 영향 자체가 주제일 때만 포함 (조건부):
//    IT가 시장 낱말보다 먼저 나오는 주체·원인이면 포함 (예: '반도체가 끌어올린 경상흑자')
//    IT가 다른 경제 요인과 '·'로 나열되면 제외 (예: '美 FOMC·반도체 실적 앞두고')
//    IT 바로 뒤에 영향 표현이 있거나(예: '반도체 수출 견인'), 제목에 IT 근거가 2개 이상이면 포함
//    그래도 판단이 어려우면 요약문에 IT 근거가 2개 이상일 때만 포함, 근거가 부족하면 제외
function itIsCoreTopic(article, words, titleHits, summaryHits, ctx) {
  const title = article.title;
  if (ROUNDUP_PATTERN.test(title) && !IT_SECTOR_TAG.test(title)) return false;
  if (countHits(title, INVESTMENT_WORDS) > 0) return false;
  const marketAt = firstIndex(title, MARKET_WORDS);
  if (marketAt < 0) return true;
  const itAt = firstIndex(title, words, ctx);
  if (itAt >= 0 && itAt < marketAt) return true;
  if (listedAmongFactors(title, words, ctx)) return summaryHits >= 2;
  if (titleHits >= 2 || hasImpactPhrase(title, words, ctx)) return true;
  return summaryHits >= 2;
}

function evaluate(article, category) {
  const words = CATEGORIES[category];
  const ctx = `${article.title} ${summaryOf(article)}`;
  const titleHits = countHits(article.title, words, ctx);
  const summaryHits = countHits(summaryOf(article), words, ctx);
  const score = titleHits * 2 + summaryHits;

  if (isNoise(article.title)) return { relevant: false, score };
  const isFinance = countHits(article.title, FINANCE_WORDS) > 0 || countHits(summaryOf(article), FINANCE_WORDS) >= 2;
  if (titleHits > 0) return { relevant: itIsCoreTopic(article, words, titleHits, summaryHits, ctx), score };
  if (isFinance) return { relevant: false, score };
  return { relevant: summaryHits >= 2, score };
}

const isRelevant = (article, category) => evaluate(article, category).relevant;

// 기준을 통과한 분야 중 점수가 가장 높은 분야를 반환한다 (제목 일치에 가중치 2배, 없으면 category: null)
function classify(article) {
  let best = null;
  let bestScore = 0;
  for (const cat of Object.keys(CATEGORIES)) {
    const { relevant, score } = evaluate(article, cat);
    if (relevant && score > bestScore) { best = cat; bestScore = score; }
  }
  return { category: best, score: bestScore };
}

function findMinistry(article) {
  const text = `${article.title} ${article.description}`;
  for (const [name, words] of Object.entries(MINISTRIES)) {
    // '산업부문'처럼 다른 단어의 일부인 경우는 제외한다
    if (words.some((w) => new RegExp(`${w}(?![문처서])`).test(text))) return name;
  }
  return null;
}

function isPolicyLike(article) {
  return countHits(`${article.title} ${article.description}`, POLICY_WORDS) > 0;
}

// ── 3. 업계 영향 ───────────────────────────────────
// 기사에 등장한 키워드에 따라 영향 문장을 고른다 (위에서부터 먼저 일치한 규칙 사용)
const IMPACT_RULES = [
  { words: ['정보 유출', '정보유출', '해킹', '랜섬웨어', '침해사고', '피싱', '악성코드', '사이버 공격', '사이버공격'], text: '보안 사고 대응 비용과 규제 리스크가 커져, 기업들의 보안 투자·점검 수요가 늘어날 전망입니다.' },
  { words: ['규제', '법안', '개정', '고시', '의무화', '가이드라인'], text: '제도 변화에 맞춘 컴플라이언스 대응이 필요하며, 관련 사업 모델과 일정에 영향을 줄 수 있습니다.' },
  { words: ['예산', '지원', '공모', '보조금', '펀드', '세액공제'], text: '정부 재원이 투입되는 분야로, 스타트업·중소기업의 사업 기회와 연구개발 수요가 확대될 수 있습니다.' },
  { words: ['수출', '관세', '통상', '무역', '공급망'], text: '수출 실적과 공급망 전략에 직접 영향을 주어, 관련 기업의 실적 전망이 달라질 수 있습니다.' },
  { words: ['투자', '증설', '착공', '구축', '데이터센터'], text: '대규모 설비 투자로 장비·소재·전력 등 후방 산업까지 수요가 이어질 가능성이 큽니다.' },
  { words: ['인수', '합병', 'M&A', '제휴', '협력', 'MOU', '파트너십'], text: '기업 간 협력·재편으로 시장 경쟁 구도가 바뀌고, 경쟁사의 대응 전략 변화가 예상됩니다.' },
  { words: ['출시', '공개', '선보', '론칭', '신제품'], text: '신규 제품·서비스 경쟁이 치열해져, 경쟁사의 후속 출시와 가격 전략에 영향을 줄 수 있습니다.' },
  { words: ['실적', '매출', '영업이익', '주가', '전망'], text: '실적과 시장 전망이 투자 심리에 반영되어, 관련 업종 전반의 주가 흐름에 영향을 줄 수 있습니다.' },
  { words: ['인력', '채용', '인재', '교육'], text: '전문 인력 수요가 늘어나며, 기업들의 인재 확보 경쟁과 교육 프로그램 확대가 예상됩니다.' },
];

const DEFAULT_IMPACT = {
  AI: 'AI 도입 속도가 빨라지며 서비스 경쟁력과 GPU·데이터 인프라 수요에 영향을 줄 수 있습니다.',
  반도체: '메모리·파운드리 업황과 장비·소재 기업의 수주 흐름에 영향을 줄 수 있습니다.',
  클라우드: '기업의 클라우드 전환 비용과 데이터센터 인프라 투자 계획에 영향을 줄 수 있습니다.',
  사이버보안: '보안 솔루션 수요와 기업의 보안 투자 우선순위에 영향을 줄 수 있습니다.',
  통신: '통신사의 요금·투자 전략과 네트워크 장비 업계의 수주 흐름에 영향을 줄 수 있습니다.',
  플랫폼: '플랫폼 입점 기업과 이용자, 광고·커머스 시장의 경쟁 환경에 영향을 줄 수 있습니다.',
  과기정통부: 'ICT·R&D 기업의 연구개발 방향과 정부 과제 참여 전략에 영향을 줄 수 있습니다.',
  산업부: '제조·에너지·수출 기업의 투자 계획과 정부 지원 활용 전략에 영향을 줄 수 있습니다.',
  행안부: '공공 IT 사업 발주와 디지털 행정 서비스 시장에 영향을 줄 수 있습니다.',
};

function analyzeImpact(article, label) {
  const text = `${article.title} ${article.description}`;
  const rule = IMPACT_RULES.find((r) => r.words.some((w) => text.includes(w)));
  return rule ? rule.text : DEFAULT_IMPACT[label] || '관련 산업 전반의 동향 변화를 주시할 필요가 있습니다.';
}

module.exports = { classify, isRelevant, summaryOf, findMinistry, isPolicyLike, analyzeImpact, CATEGORIES, MINISTRIES };
