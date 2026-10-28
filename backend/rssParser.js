// RSS(XML) 문자열을 외부 라이브러리 없이 파싱하는 간단한 모듈

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

// &amp; &#39; &#x27; 같은 HTML 엔티티를 실제 문자로 바꾼다
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const num = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

// HTML 태그를 제거하고 공백을 정리한다
function stripHtml(text) {
  // Google 뉴스처럼 두 번 인코딩된 경우(&amp;nbsp;)가 있어 디코딩을 두 번 한다
  return decodeEntities(decodeEntities(text.replace(/<[^>]*>/g, ' ')))
    .replace(/<[^>]*>/g, ' ') // 엔티티 디코딩 후 다시 나타난 태그 제거
    .replace(/\s+/g, ' ')
    .trim();
}

// <tag>...</tag> 내용을 꺼낸다 (CDATA 지원)
function getTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1];
  return value;
}

/**
 * RSS 문자열을 기사 객체 배열로 변환한다.
 * @returns {{title, link, description, pubDate: Date|null, source}[]}
 */
function parseRss(xml, defaultSource = '') {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    let title = stripHtml(getTag(item, 'title'));
    let source = stripHtml(getTag(item, 'source')) || defaultSource;

    // Google 뉴스 제목은 "제목 - 언론사" 형식이므로 언론사를 분리한다
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }

    const dateText = getTag(item, 'pubDate') || getTag(item, 'dc:date');
    const pubDate = dateText ? new Date(dateText) : null;

    return {
      title,
      link: stripHtml(getTag(item, 'link')),
      description: stripHtml(getTag(item, 'description')),
      pubDate: pubDate && !isNaN(pubDate) ? pubDate : null,
      source,
    };
  }).filter((a) => a.title && a.link);
}

module.exports = { parseRss, stripHtml };
