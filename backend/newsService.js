// 무료 RSS(API Key 불필요)에서 기준일의 뉴스를 모아 브리핑 데이터를 만든다

const { parseRss } = require('./rssParser');
const { classify, isRelevant, summaryOf, findMinistry, isPolicyLike, analyzeImpact } = require('./analyzer');
const { findEntities, canonicalize } = require('./aliasStore');

const googleNews = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;

// ── 뉴스 출처 ─────────────────────────────────────
// 1) 국내 IT 언론 RSS: 기사 요약문(description)이 있어 분석 재료로 좋다 (최근 1~2일치만 제공)
const OUTLET_FEEDS = [
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml' },
  { name: 'ZDNet Korea', url: 'https://feeds.feedburner.com/zdkorea' },
  { name: '연합뉴스', url: 'https://www.yna.co.kr/rss/industry.xml' },
];

// 2) Google 뉴스 RSS 검색: 분야별 기사 (날짜 범위 지정 가능)
const CATEGORY_QUERIES = {
  AI: '인공지능 OR 생성형AI',
  반도체: '반도체 OR HBM',
  클라우드: '클라우드 OR 데이터센터',
  사이버보안: '사이버보안 OR 해킹 OR 개인정보유출',
  통신: '통신사 OR 5G OR 6G OR 이동통신',
  플랫폼: '플랫폼 기업 OR 네이버 OR 카카오 OR 온라인플랫폼',
};

// 3) 부처별 정책 뉴스
const MINISTRY_QUERIES = {
  과기정통부: '과학기술정보통신부 OR 과기정통부',
  산업부: '산업통상부 OR 산업통상자원부 OR 산업부',
  행안부: '행정안전부 OR 행안부',
};

const MAX_NEWS = 10;
const MAX_POLICIES = 3;
const POLICY_DAYS = 3;       // 정책 카드는 기준일 포함 최근 3일에서 고른다
const MAX_ANALYSIS = 70;     // 메인 배너 분석에 넘길 최대 기사 수
const MAX_PER_LABEL = 12;    // 한 분야가 분석 자료를 독차지하지 않도록 분야별 상한
const CACHE_MS = 10 * 60 * 1000;

// ── 날짜 (한국 시간 기준) ─────────────────────────────
const KST_OFFSET = 9 * 3600 * 1000;
const kstDate = (d) => new Date(d.getTime() + KST_OFFSET).toISOString().slice(0, 10);
const todayKst = () => kstDate(new Date());
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s)) && s <= todayKst();

// Google 뉴스 검색어에 날짜 범위를 붙인다 (경계 오차는 뒤에서 pubDate로 다시 거른다)
const rangeQuery = (q, from, to) => `${q} after:${shiftDate(from, -1)} before:${shiftDate(to, 1)}`;

async function fetchFeed(url, sourceName = '', retries = 1) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (IT-Briefing student project)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRss(await res.text(), sourceName);
  } catch (err) {
    if (retries > 0) return fetchFeed(url, sourceName, retries - 1); // 일시적 오류면 한 번 더 시도
    console.warn(`[피드 실패] ${sourceName || url} → ${err.message}`);
    return [];
  }
}

// ── 중복 기사 판별 ──────────────────────────────────
// 언론사마다 제목을 조금씩 바꿔 쓰므로, 정규화한 제목의 두 글자 조각이 얼마나 겹치는지로 판단한다
const DUP_THRESHOLD = 0.5;
const SAME_SUBJECT_THRESHOLD = 0.45;
const INCIDENT_MIN_SIMILARITY = 0.2;          // 사건 단서로 묶을 때도 제목이 이 정도는 겹쳐야 한다
const INCIDENT_MIN_SUMMARY_SIMILARITY = 0.5;  // 수량 확인이 없을 때, 두 요약문이 이만큼 겹치면 같은 사실로 본다 // 주어(기업·기관·인물)가 같다고 확인된 제목끼리는 표현이 조금 달라도 같은 사건으로 본다
const MIN_LONG_OVERLAP = 0.25; // 긴 제목 기준으로도 이만큼은 겹쳐야 한다 (짧은 제목이 여러 기사를 흡수하는 것 방지)

// 언론사명(' - 연합뉴스'), 말머리('[2026 국감]', '(종합)'), 기호·공백을 지운다
const stripTitle = (t) => t
  .replace(/\s+[-|]\s+[^-|]{1,20}$/, '')
  .replace(/^(\s*[[(【<][^\])】>]{1,20}[\])】>])+/, '')
  .trim();
// 기업·기관 등의 별칭을 표준명으로 통일한다 (data/aliases.json, 예: '北'→'북한', 'Google'→'구글')
// 'AI', 'HBM' 같은 기술 용어는 대상이 아니라 주제라서 바꾸지 않는다
const ENTITY_TYPES = ['company', 'government', 'organization', 'country'];
// 표준명은 두 글자짜리 기호로 바꿔 비교한다. '과기정통부'→'과학기술정보통신부'처럼 이름이 길어지면
// 같은 기관이 나왔다는 이유만으로 겹치는 조각이 늘어 다른 사건까지 중복으로 볼 수 있기 때문
// (실제 기사로 비교해 보니 1글자는 같은 사건을 너무 놓치고, 표준명 그대로는 오탐이 많았다)
const entitySymbols = new Map(); // 표준명 → 유니코드 사용자 영역 글자
const symbolOf = (canonical) => {
  if (!entitySymbols.has(canonical)) entitySymbols.set(canonical, String.fromCharCode(0xe000 + entitySymbols.size));
  return entitySymbols.get(canonical);
};
function unifyNames(title) {
  const text = stripTitle(title);
  let out = '';
  let pos = 0;
  for (const f of findEntities(text, { types: ENTITY_TYPES })) {
    out += text.slice(pos, f.index) + symbolOf(f.canonical).repeat(2);
    pos = f.index + f.matched.length;
  }
  return out + text.slice(pos);
}
const titleKey = (t) => unifyNames(t).replace(/[^가-힣A-Za-z0-9\ue000-\uf8ff]/g, '');

// ── 사건 단서: 제목에서 상투 문구를 뺀 핵심 낱말 ──
// 국감 기사 등에 반복되는 표현과 너무 일반적인 낱말 (이것들만 겹치면 같은 사건의 근거가 아니다)
// STOP_STEMS는 활용형까지 뺀다 ('마련할', '답변하는'), STOP_WORDS는 그 낱말만 뺀다 ('종합'은 빼도 '종합감사'는 남김)
const STOP_STEMS = ['국감', '국정감사', '범부처', '대응책', '대책', '마련', '우려', '확산', '촉구', '질타', '지적', '답변', '강조',
  '추진', '발표', '확대', '개최', '진행', '본격', '전망', '논란', '필요'];
const STOP_WORDS = ['계획', '방안', '정부', '장관', '의원', '위원장', '관련', '기업', '업체', '고객', '서비스', '정보', '개인정보',
  '이용자', '피해', '종합', '단독', '속보', '포토', '오늘', '내년', '올해', '직후'];
// 같은 사건인지 가를 때 쓰는 사건 유형 (출시·공개처럼 흔한 동작은 넣지 않는다)
const INCIDENT_TYPES = [
  ['해킹', '유출', '랜섬웨어', '침해', '디도스', 'DDoS', '피싱', '악성코드', '취약점'],
  ['장애', '먹통', '서비스 중단', '접속 불가'],
  ['인수', '합병', '매각'],
  ['소송', '고소', '고발', '압수수색', '수사'],
  ['과징금', '제재', '징계', '시정명령'],
  ['리콜', '화재', '폭발'],
];
const PARTICLE = /(으로|에서|에게|까지|부터|에도|에는|와|과|은|는|이|가|을|를|의|에|로|도|만)$/;
const GENERIC_LATIN = ['AI', 'IT', 'ICT', 'CEO', 'CTO', 'MOU', 'SW', 'HW'];
const SPECIFIC_TYPES = ['company', 'organization']; // 정부 부처·국가는 여러 사건에 두루 나와 특정 근거가 아니다

function cluesOf(title) {
  const text = stripTitle(title);
  const keys = new Set();
  const specific = new Set();
  let rest = '';
  let pos = 0;
  for (const f of findEntities(text, { types: ENTITY_TYPES })) {
    rest += text.slice(pos, f.index) + ' ';
    pos = f.index + f.matched.length;
    if (SPECIFIC_TYPES.includes(f.type)) {
      keys.add(`@${f.canonical}`);
      specific.add(`@${f.canonical}`);
    }
  }
  rest += text.slice(pos);
  // 따옴표 안의 한 낱말은 고유명사로 본다 (예: ‘기프티엘’)
  const quoted = new Set([...text.matchAll(/['‘’"“”]([가-힣A-Za-z0-9]{2,12})['‘’"“”]/g)].map((m) => m[1].replace(PARTICLE, '')));
  for (const raw of rest.split(/[^가-힣A-Za-z0-9]+/)) {
    const w = raw.length > 2 ? raw.replace(PARTICLE, '') : raw;
    if (w.length < 2 || /^\d+$/.test(w) || STOP_WORDS.includes(w) || STOP_STEMS.some((s) => w.startsWith(s))) continue;
    keys.add(w);
    if (quoted.has(w) || (/^[A-Za-z][A-Za-z0-9]{2,}$/.test(w) && !GENERIC_LATIN.includes(w.toUpperCase()))) specific.add(w);
  }
  const incidents = INCIDENT_TYPES.flat().filter((k) => text.includes(k)); // 제목에 나온 사건 낱말
  const flat = text.replace(/[^가-힣A-Za-z0-9]/g, ''); // 띄어쓰기가 달라도 찾을 수 있게 ('디지털 트윈' ↔ '디지털트윈')
  return { keys, specific, incidents, flat };
}

// 단위가 붙은 수량을 값으로 읽는다 (예: '1만8359명' → 18359명, '1만8천여명' → 18000명, '267억 원' → 267억원)
const UNIT = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3 };
function quantitiesOf(text) {
  const found = [];
  for (const m of text.matchAll(/((?:\d[\d,]*(?:\.\d+)?\s*[조억만천]?\s*)+)여?\s*(명|건|원|달러|개사|곳|가구)/g)) {
    let value = 0;
    for (const [, n, u] of m[1].matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([조억만천])?/g)) value += Number(n.replace(/,/g, '')) * (UNIT[u] || 1);
    if (value > 0) found.push({ value, unit: m[2] });
  }
  return found;
}
// 같은 단위의 수량이 5% 안쪽으로 같으면 같은 사실을 전한 것으로 본다 ('1만8359명' ≈ '1만8천여명')
const sameQuantity = (a, b) => a.quantities.some((x) => b.quantities.some((y) => x.unit === y.unit && Math.abs(x.value - y.value) <= 0.05 * Math.max(x.value, y.value)));

const toBigrams = (s) => {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
};

function titleInfo(title, summary = '') {
  const key = titleKey(title);
  const bigrams = new Set();
  for (let i = 0; i < key.length - 1; i++) bigrams.add(key.slice(i, i + 2));
  // 'OO, …' 형식의 주어 (예: '신정훈 의원', 'KT'). 쉼표 앞이 4단어 이상이면 주어가 아닌 문장으로 본다
  // (예: 'SiC 반도체 결함 판별 파장, …')
  const head = unifyNames(title).match(/^([^,…·]{1,20}),/);
  const subject = head && head[1].trim().split(/\s+/).length <= 3 ? head[1].replace(/[^가-힣A-Za-z0-9\ue000-\uf8ff]/g, '') : null;
  // 주어를 표준명 글자로 적은 것 (sameName 비교용, 예: '삼성전자')
  const rawHead = stripTitle(title).match(/^([^,…·]{1,20}),/);
  const subjectName = subject && rawHead ? canonicalize(rawHead[1], { types: ENTITY_TYPES }).replace(/[^가-힣A-Za-z0-9]/g, '') : null;
  // 기사에 나온 숫자 ('3분기', '2천억' 등. '5G'처럼 영문이 붙은 것은 제외). 별칭 변환 전 원래 제목에서 뽑는다
  const nums = new Set(stripTitle(title).match(/\d+(\.\d+)?(?![\dA-Za-z.])/g) || []);
  const summaryBigrams = toBigrams(summary.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 200));
  return { key, bigrams, subject, subjectName, nums, clues: cluesOf(title), summaryBigrams, quantities: quantitiesOf(stripTitle(title)) };
}

const sharedCount = (a, b) => [...a.bigrams].filter((g) => b.bigrams.has(g)).length;

// 겹치는 조각 수 ÷ 짧은 제목의 조각 수
function similarity(a, b) {
  return sharedCount(a, b) / Math.min(a.bigrams.size, b.bigrams.size) || 0;
}

// 두 주어가 같은 대상인지 (예: '신정훈 의원' ≈ '신정훈 국회의원', 'KT' ≠ 'SKT', '삼성전자' ≠ 'LG전자')
function sameSubject(x, y) {
  if (x === y) return true;
  if (x[0] !== y[0]) return false;
  const gx = titleInfo(x);
  const gy = titleInfo(y);
  return (2 * sharedCount(gx, gy)) / (gx.bigrams.size + gy.bigrams.size) >= 0.5;
}

// 한쪽 이름이 다른 쪽 이름으로 시작하면 같은 대상으로 본다 (예: '삼성' ⊂ '삼성전자', '이글루' ⊂ '이글루코퍼레이션')
const sameName = (x, y) => Boolean(x && y && Math.min(x.length, y.length) >= 2 && (x.startsWith(y) || y.startsWith(x)));

// 유사도가 높아도 주어나 숫자가 다르면 별개의 보도로 본다 (예: '삼성전자, 3분기…' vs 'SK하이닉스, 3분기…')
// 한쪽의 사건 단서가 다른 쪽 제목에도 있으면 공유한 것으로 본다 (기업·기관은 같은 표준명일 때만)
const inOther = (k, other) => (k.startsWith('@') ? other.clues.keys.has(k) : other.clues.flat.includes(k));
const sharedClues = (a, b) => [...new Set([...[...a.clues.keys].filter((k) => inOther(k, b)), ...[...b.clues.keys].filter((k) => inOther(k, a))])];

// 제목 표현이 크게 달라도 같은 사건으로 보는 경우 (모든 조건을 만족해야 한다)
//  - 특정 이름(별칭 DB의 기업·기관, 영문 고유명사, 따옴표 속 이름)이 두 제목에 함께 있고
//  - 같은 사건 낱말(해킹·유출, 장애, 인수·합병, 소송·수사, 제재 등)을 2개 이상 함께 쓰며
//    (PHP 사태처럼 큰 사건은 'PHP+해킹'만 같은 다른 후속 기사가 많아, 낱말 하나로는 묶지 않는다)
//  - 같은 사실을 전한다는 확인이 있을 때: 같은 수량(피해 규모 등)이 나오거나, 두 기사 모두 요약문이 있고 요약문이 많이 겹칠 때
//    (요약문이 없는 Google 뉴스 기사는 수량으로만 확인한다. 확인할 수 없으면 묶지 않는다)
function sameIncident(a, b) {
  if (similarity(a, b) < INCIDENT_MIN_SIMILARITY) return false;
  const specific = sharedClues(a, b).filter((k) => a.clues.specific.has(k) || b.clues.specific.has(k));
  if (!specific.length) return false;
  if (a.clues.incidents.filter((k) => b.clues.incidents.includes(k)).length < 2) return false;
  if (sameQuantity(a, b)) return true;
  if (a.summaryBigrams.size >= 8 && b.summaryBigrams.size >= 8) {
    const shared = [...a.summaryBigrams].filter((g) => b.summaryBigrams.has(g)).length;
    return shared / Math.min(a.summaryBigrams.size, b.summaryBigrams.size) >= INCIDENT_MIN_SUMMARY_SIMILARITY;
  }
  return false;
}

function isSameStory(a, b) {
  if (a.key === b.key) return true;
  if (Math.min(a.bigrams.size, b.bigrams.size) < 8) return false; // 너무 짧은 제목은 완전히 같을 때만
  const subjectsMatch = a.subject && b.subject && (sameSubject(a.subject, b.subject) || sameName(a.subjectName, b.subjectName));
  if (a.subject && b.subject && !subjectsMatch) return false;
  if (a.nums.size && b.nums.size && ![...a.nums].some((n) => b.nums.has(n))) return false;
  const similarTitles = similarity(a, b) >= (subjectsMatch ? SAME_SUBJECT_THRESHOLD : DUP_THRESHOLD)
    && sharedCount(a, b) / Math.max(a.bigrams.size, b.bigrams.size) >= MIN_LONG_OVERLAP;
  // 제목이 비슷해도 상투 문구·부처명 말고는 겹치는 사건 단서가 없으면 다른 사건 (예: 국감 '우려 확산…범부처 대응책')
  if (similarTitles) return !(a.clues.keys.size && b.clues.keys.size && !sharedClues(a, b).length);
  return sameIncident(a, b);
}

// 앞서 고른 기사와 같은 사건이면 false, 처음 보는 기사면 기록하고 true
function createDedupe() {
  const picked = [];
  return (title, summary = '') => {
    const info = titleInfo(title, summary);
    if (picked.some((p) => isSameStory(p, info))) return false;
    picked.push(info);
    return true;
  };
}

function byNewest(a, b) {
  return (b.pubDate?.getTime() || 0) - (a.pubDate?.getTime() || 0);
}

function toCard(article, label, type) {
  return {
    type,                 // 'news' | 'policy'
    label,                // 분야 또는 부처명
    title: article.title,
    link: article.link,
    source: article.source,
    publishedAt: article.pubDate ? article.pubDate.toISOString() : null,
    impact: analyzeImpact(article, label),
  };
}

async function buildBriefing(date) {
  const policyFrom = shiftDate(date, -(POLICY_DAYS - 1));
  const [outletLists, categoryLists, ministryLists] = await Promise.all([
    Promise.all(OUTLET_FEEDS.map((f) => fetchFeed(f.url, f.name))),
    Promise.all(Object.values(CATEGORY_QUERIES).map((q) => fetchFeed(googleNews(rangeQuery(q, shiftDate(date, -1), date))))),
    Promise.all(Object.values(MINISTRY_QUERIES).map((q) => fetchFeed(googleNews(rangeQuery(q, policyFrom, date))))),
  ]);

  const onDay = (a) => a.pubDate && kstDate(a.pubDate) === date;
  const inRange = (from) => (a) => a.pubDate && kstDate(a.pubDate) >= from && kstDate(a.pubDate) <= date;
  // 기준일 기사 먼저, 그다음 최신순
  const sameDayFirst = (a, b) => onDay(b) - onDay(a) || byNewest(a, b);

  const outletArticles = outletLists.flat().filter(inRange(policyFrom));
  // Google 뉴스 검색 결과에는 무관한 기사가 섞이므로 언론사 기사와 같은 분류 기준(isRelevant)으로 거른다
  const catLists = Object.keys(CATEGORY_QUERIES).map((cat, i) => categoryLists[i].filter((a) => isRelevant(a, cat)));
  const minLists = Object.keys(MINISTRY_QUERIES).map((m, i) => ministryLists[i].filter((a) => findMinistry({ title: a.title, description: '' }) === m));

  // ── 메인 배너 분석용: 기준일에 나온 기사 전체 (중복 제거) ──
  const isNewForAnalysis = createDedupe();
  const analysis = [];
  const perLabel = {};
  const addAnalysis = (a, label) => {
    if (analysis.length >= MAX_ANALYSIS || (perLabel[label] || 0) >= MAX_PER_LABEL || !isNewForAnalysis(a.title, summaryOf(a))) return;
    perLabel[label] = (perLabel[label] || 0) + 1;
    // Google 뉴스 요약문은 '제목 + 언론사'뿐이라 의미가 없으므로 비운다
    const description = summaryOf(a).slice(0, 220);
    analysis.push({ label, title: a.title, source: a.source, publishedAt: a.pubDate.toISOString(), description });
  };
  // 요약문이 있는 언론사 기사를 먼저 넣는다
  outletArticles.filter(onDay).sort(byNewest).forEach((a) => {
    const ministry = findMinistry(a);
    const c = classify(a);
    if (c.category) addAnalysis(a, c.category);
    else if (ministry) addAnalysis(a, ministry);
  });
  Object.keys(MINISTRY_QUERIES).forEach((m, i) => minLists[i].filter(onDay).sort(byNewest).slice(0, 6).forEach((a) => addAnalysis(a, m)));
  Object.keys(CATEGORY_QUERIES).forEach((cat, i) => catLists[i].filter(onDay).sort(byNewest).slice(0, 8).forEach((a) => addAnalysis(a, cat)));

  // ── 카드 목록 ────────────────────────────────────
  // 앞서 고른 카드와 같은 사건이면 건너뛴다 (정책·뉴스 카드 공통)
  const isNewCard = createDedupe();
  const take = (a) => isNewCard(a.title, summaryOf(a));

  // 정책 변경: 부처별 1건씩, 최대 3건 (기준일 포함 최근 3일)
  const policies = [];
  Object.keys(MINISTRY_QUERIES).forEach((ministry, i) => {
    if (policies.length >= MAX_POLICIES) return;
    const inTitle = (a) => findMinistry({ title: a.title, description: '' }) === ministry;
    // 제목에 부처명이 있는 기사 → 기준일 → 최신순 으로 우선한다
    const order = (a, b) => inTitle(b) - inTitle(a) || sameDayFirst(a, b);
    const fromOutlets = outletArticles.filter((a) => findMinistry(a) === ministry && isPolicyLike(a));
    const fromGoogle = minLists[i].filter(inRange(policyFrom)).filter(isPolicyLike);
    const pick = [...fromOutlets.sort(order), ...fromGoogle.sort(order)].find(take);
    if (pick) policies.push(toCard(pick, ministry, 'policy'));
  });

  // IT 뉴스: 분야별로 번갈아 골라 최대 10건 (기준일 기사 우선, 부족하면 전날 기사)
  const newsFrom = shiftDate(date, -1);
  const pools = Object.keys(CATEGORY_QUERIES).map((cat, i) => {
    const fromOutlets = outletArticles.filter(inRange(newsFrom)).filter((a) => classify(a).category === cat);
    const fromGoogle = catLists[i].filter(inRange(newsFrom));
    return { cat, list: [...fromOutlets, ...fromGoogle].sort(sameDayFirst) };
  });

  const news = [];
  let progressed = true;
  while (news.length < MAX_NEWS && progressed) {
    progressed = false;
    for (const pool of pools) {
      if (news.length >= MAX_NEWS) break;
      while (pool.list.length) {
        const a = pool.list.shift();
        if (take(a)) {
          news.push(toCard(a, pool.cat, 'news'));
          progressed = true;
          break;
        }
      }
    }
  }

  return {
    date,
    updatedAt: new Date().toISOString(),
    sources: [...OUTLET_FEEDS.map((f) => f.name), 'Google 뉴스 RSS'],
    news,
    policies,
    analysis, // 메인 배너(오늘의 IT 업계 브리핑) 작성용 기사 목록 — 응답에서는 제외한다
  };
}

const cache = new Map(); // date → { data, time }

async function getBriefing({ date = todayKst(), force = false } = {}) {
  const hit = cache.get(date);
  if (!force && hit && Date.now() - hit.time < CACHE_MS) return hit.data;
  const data = await buildBriefing(date);
  cache.set(date, { data, time: Date.now() });
  return data;
}

module.exports = { getBriefing, todayKst, isValidDate, createDedupe };
