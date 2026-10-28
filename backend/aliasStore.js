// 별칭 DB(data/aliases.json)를 읽어, 같은 대상을 가리키는 여러 표기를 표준명으로 찾아 준다
// 별칭은 JSON 파일에서만 관리한다 (이 파일은 수정할 필요 없음, 서버 재시작 시 반영)

const fs = require('fs');
const path = require('path');

const ALIAS_FILE = path.join(__dirname, '..', 'data', 'aliases.json');
const TYPES = ['company', 'government', 'organization', 'technology', 'country'];

// 'KT', 'MS', 'AI' 같은 짧은 영문 약어는 대소문자를 구분한다 (analyzer.js와 같은 기준)
const isShortAcronym = (term) => /^[A-Z]{2,4}$/.test(term);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 영문으로 시작/끝나는 별칭은 앞뒤가 영문이 아닐 때만 일치 ('KT'가 'SKT' 안에서 일치하지 않게)
// 숫자는 붙어도 된다 ('HBM4'의 'HBM', 'AI2'의 'AI'). analyzer.js의 키워드 일치 기준과 같다
function termPattern(term) {
  const before = /^[A-Za-z]/.test(term) ? '(?<![A-Za-z])' : '';
  const after = /[A-Za-z]$/.test(term) ? '(?![A-Za-z])' : '';
  return new RegExp(`${before}${escapeRegExp(term)}${after}`, isShortAcronym(term) ? 'g' : 'gi');
}

// 파일을 읽고 검사한다. 잘못된 항목은 경고만 남기고 건너뛰어 서버가 멈추지 않게 한다
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8'));
  } catch (err) {
    console.warn(`[별칭 DB] ${ALIAS_FILE}을 읽지 못해 별칭 없이 동작합니다 → ${err.message}`);
    return { entries: [], terms: [], byName: new Map() };
  }

  const entries = [];
  const terms = [];          // { term, pattern, entry } — 긴 표기부터 검사
  const byName = new Map();  // 표준명·별칭(소문자) → 항목
  const warn = (msg) => console.warn(`[별칭 DB] ${msg}`);

  (Array.isArray(raw.entries) ? raw.entries : []).forEach((e, i) => {
    const where = `entries[${i}]${e && e.canonical ? ` (${e.canonical})` : ''}`;
    if (!e || typeof e.canonical !== 'string' || !e.canonical.trim()) return warn(`${where}: canonical이 없어 건너뜁니다`);
    if (!TYPES.includes(e.type)) return warn(`${where}: type은 ${TYPES.join(', ')} 중 하나여야 해 건너뜁니다`);
    if (byName.has(e.canonical.toLowerCase())) return warn(`${where}: 이미 등록된 이름이라 건너뜁니다`);

    // 분야 이름이 맞는지는 분류 규칙을 가진 analyzer.js가 검사한다 (별칭 DB는 분류 규칙을 모른다)
    const categories = (Array.isArray(e.categories) ? e.categories : []).filter((c) => typeof c === 'string');
    const entry = { canonical: e.canonical.trim(), aliases: [], variants: [], type: e.type, categories };

    // 별칭은 문자열, 또는 뜻이 여러 개인 약칭이면 조건을 붙인 객체 { name, context, notFollowedBy }
    for (const item of [entry.canonical, ...(Array.isArray(e.aliases) ? e.aliases : [])]) {
      const name = typeof item === 'string' ? item : item && item.name;
      if (typeof name !== 'string' || !name.trim()) continue;
      const term = name.trim();
      const owner = byName.get(term.toLowerCase());
      if (owner && owner !== entry) { warn(`${where}: 별칭 '${term}'은 이미 '${owner.canonical}'에 있어 무시합니다`); continue; }
      if (owner) continue; // 같은 항목 안의 중복
      byName.set(term.toLowerCase(), entry);
      if (term !== entry.canonical) entry.aliases.push(term);
      const list = (v) => (Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w) : []);
      // notContext는 항목 전체(표준명 포함)에 붙일 수 있다 (예: '카카오'는 '코코아'·'초콜릿'과 함께면 회사가 아님)
      const notContext = [...list(e.notContext), ...list(item.notContext)];
      const variant = { name: term, context: list(item.context), notFollowedBy: list(item.notFollowedBy), notContext };
      entry.variants.push(variant);
      terms.push({ term, pattern: termPattern(term), entry, ...variant });
    }
    entries.push(entry);
  });

  terms.sort((a, b) => b.term.length - a.term.length);
  return { entries, terms, byName };
}

const db = load();

// 조건이 붙은 약칭은 문맥이 맞을 때만 인정한다
//  - context: 같은 글에 이 단어 중 하나가 있어야 함 (예: 'MS'는 '클라우드', '윈도' 등과 함께일 때만 마이크로소프트)
//  - notFollowedBy: 바로 뒤에 이 글자가 오면 제외 (예: '北美'(북미)의 '北'은 북한이 아님)
//  - notContext: 같은 글에 이 단어 중 하나가 있으면 제외 (예: '코코아'와 함께 나온 '카카오'는 회사가 아님)
function fitsContext(t, text, end) {
  if (t.notFollowedBy.some((w) => text.startsWith(w, end))) return false;
  if (t.notContext.some((w) => text.includes(w))) return false;
  if (t.context.length && !t.context.some((w) => text.toLowerCase().includes(w.toLowerCase()))) return false;
  return true;
}

// text에 등장하는 대상들을 찾는다. 겹치는 표기는 더 긴 쪽을 우선한다 (예: '네이버클라우드' > '네이버')
// options.types: 이 type의 항목만 찾는다 (예: ['company', 'government'])
// 반환: [{ canonical, type, categories, matched, index }] (등장 순서)
function findEntities(text = '', { types } = {}) {
  const taken = [];
  const found = [];
  for (const t of db.terms) {
    const { pattern, entry } = t;
    if (types && !types.includes(entry.type)) continue;
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s) || !fitsContext(t, text, end)) continue;
      taken.push([start, end]);
      found.push({ canonical: entry.canonical, type: entry.type, categories: entry.categories, matched: m[0], index: start });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// text 속 별칭을 모두 표준명으로 바꾼다 (예: '北 해킹조직 Lazarus' → '북한 해킹조직 라자루스')
function canonicalize(text = '', options) {
  let out = '';
  let pos = 0;
  for (const f of findEntities(text, options)) {
    out += text.slice(pos, f.index) + f.canonical;
    pos = f.index + f.matched.length;
  }
  return out + text.slice(pos);
}

// 표준명 또는 별칭으로 항목을 찾는다 (없으면 null)
const getEntry = (name = '') => db.byName.get(name.trim().toLowerCase()) || null;

// 이름이 속한 항목의 모든 표기를 조건과 함께 돌려준다 (DB에 없으면 그 이름 하나)
// 예: 'D램' → [{ name: 'D램' }, { name: 'DRAM' }, { name: '디램' }]
function variantsOf(name) {
  const entry = getEntry(name);
  return entry ? entry.variants : [{ name, context: [], notFollowedBy: [], notContext: [] }];
}

module.exports = { findEntities, canonicalize, getEntry, variantsOf, entries: db.entries, ALIAS_FILE };
