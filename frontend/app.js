// 프론트엔드: 백엔드 API에서 데이터를 받아 화면에 그린다
// - /api/banner   : 메인 배너 '오늘의 IT 업계 브리핑' 3줄
// - /api/briefing : IT 주요 뉴스 + 정부 정책 변경 카드

const AUTO_REFRESH_MS = 30 * 60 * 1000; // 오늘 날짜를 보고 있으면 30분마다 자동 갱신
const BANNER_ROLES = ['핵심 이슈', '산업 동향', '정책·시사점'];

const $ = (sel) => document.querySelector(sel);
let currentFilter = '전체';
let newsData = [];

// 한국 시간 기준 오늘 (YYYY-MM-DD)
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
let selectedDate = todayKst();

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function createCard(item) {
  const card = $('#card-template').content.firstElementChild.cloneNode(true);
  card.dataset.type = item.type;
  card.dataset.label = item.label;

  card.querySelector('.badge').textContent = item.type === 'policy' ? `정책 · ${item.label}` : item.label;
  card.querySelector('.source').textContent = item.source || '';
  card.querySelector('.date').textContent = formatDate(item.publishedAt);

  // 헤드라인 → 원문 링크 (textContent 사용 → 외부 데이터의 HTML이 실행되지 않음)
  const titleLink = card.querySelector('.card-title a');
  titleLink.textContent = item.title;
  titleLink.href = item.link;

  card.querySelector('.impact p').textContent = item.impact;
  return card;
}

function renderList(container, items, emptyText) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = `<p class="message">${emptyText}</p>`;
    return;
  }
  items.forEach((item) => container.appendChild(createCard(item)));
}

function renderNews() {
  const filtered = currentFilter === '전체' ? newsData : newsData.filter((n) => n.label === currentFilter);
  renderList($('#news-list'), filtered, '해당 분야의 뉴스가 없습니다.');
}

function formatDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}

function setBannerLines(lines, loadingText) {
  const ol = $('#banner-lines');
  ol.innerHTML = '';
  if (loadingText) {
    const li = document.createElement('li');
    li.className = 'loading';
    li.textContent = loadingText;
    ol.appendChild(li);
    return;
  }
  lines.forEach((line, i) => {
    const li = document.createElement('li');
    li.dataset.role = BANNER_ROLES[i];
    li.textContent = line;
    ol.appendChild(li);
  });
}

async function loadBanner() {
  const isToday = selectedDate === todayKst();
  $('#banner-title').textContent = isToday ? '오늘의 IT 업계 브리핑' : 'IT 업계 브리핑';
  $('#banner-date').textContent = formatDay(selectedDate);
  $('#banner-mode').textContent = '';
  $('#banner-mode').className = 'banner-mode';
  $('#banner-note').textContent = '';
  setBannerLines([], '기사들을 종합해 브리핑을 작성하는 중…');

  try {
    const res = await fetch(`/api/banner?date=${selectedDate}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `서버 응답 오류 (${res.status})`);
    if (data.date !== selectedDate) return; // 그 사이 날짜를 바꿨으면 무시

    setBannerLines(data.lines);
    const mode = $('#banner-mode');
    if (data.mode === 'ai') {
      mode.textContent = 'AI 분석';
      mode.classList.add('ai');
      $('#banner-note').textContent = `기준일 기사 ${data.articleCount}건을 AI(OpenAI ${data.model})가 종합 분석했습니다. 사실 확인은 아래 원문 기사를 참고하세요.`;
    } else {
      mode.textContent = '자동 집계';
      $('#banner-note').textContent = `기준일 기사 ${data.articleCount}건의 분야별 건수를 집계한 문장입니다 (AI 분석 아님). 서버의 .env 파일에 OPENAI_API_KEY를 넣으면 AI 분석으로 바뀝니다.`;
    }
  } catch (err) {
    setBannerLines([], `브리핑을 불러오지 못했습니다. (${err.message})`);
  }
}

async function loadBriefing(force = false) {
  const btn = $('#refresh-btn');
  btn.disabled = true;
  btn.textContent = '불러오는 중…';

  try {
    const res = await fetch(`/api/briefing?date=${selectedDate}${force ? '&refresh=1' : ''}`);
    if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
    const data = await res.json();

    newsData = data.news;
    renderList($('#policy-list'), data.policies, '기준일 포함 최근 3일간 확인된 정책 변경 소식이 없습니다.');
    renderNews();

    $('#policy-count').textContent = `${data.policies.length}건`;
    $('#news-count').textContent = `${data.news.length}건`;
    $('#updated-at').textContent = `업데이트: ${formatDate(data.updatedAt)}`;
    $('#sources').textContent = `출처: ${data.sources.join(', ')}`;
  } catch (err) {
    const msg = `뉴스를 불러오지 못했습니다. 백엔드 서버(node backend/server.js)가 실행 중인지 확인하세요. (${err.message})`;
    $('#policy-list').innerHTML = '';
    $('#news-list').innerHTML = '';
    const p = document.createElement('p');
    p.className = 'message';
    p.textContent = msg;
    $('#news-list').appendChild(p);
    $('#updated-at').textContent = '업데이트 실패';
  } finally {
    btn.disabled = false;
    btn.textContent = '새로고침';
  }
}

// 분야 필터 버튼
$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  currentFilter = chip.dataset.filter;
  renderNews();
});

// 뉴스 카드를 먼저 받고(캐시 준비), 이어서 배너를 작성한다
async function loadAll(force = false) {
  await loadBriefing(force);
  loadBanner();
}

// 기준일 선택 (오늘 이후는 선택 불가)
const dateInput = $('#date-input');
dateInput.value = selectedDate;
dateInput.max = selectedDate;
dateInput.addEventListener('change', () => {
  if (!dateInput.value || dateInput.value > todayKst()) {
    dateInput.value = selectedDate;
    return;
  }
  selectedDate = dateInput.value;
  loadAll();
});

$('#refresh-btn').addEventListener('click', () => loadAll(true));

// 계절 헤더: 오늘 날짜의 월로 계절을 정하고, 마스코트·말풍선·움직이는 효과를 바꾼다 (외부 API 없이 직접 그림)
// 12~2월 겨울(눈) · 3~5월 봄(꽃잎) · 6~8월 여름(민들레 씨앗) · 9~11월 가을(낙엽) — 빈티지 수채화 색감
function seasonOf(date) {
  const m = Number(date.slice(5, 7));
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

const SEASON_FX = {
  winter: {
    bubble: (m) => (m === 12 ? '메리 크리스마스!' : '눈이 와요!'),
    density: 14, size: [1, 3.2], speed: [0.3, 1], spin: 0,
    colors: () => [getComputedStyle(document.documentElement).getPropertyValue('--snow')],
    draw(ctx, p) {
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  spring: {
    bubble: () => '봄이 왔어요!',
    density: 26, size: [3, 5], speed: [0.4, 0.9], spin: 0.03,
    colors: () => ['#e3a6ab', '#efc6c4', '#d48a92'],
    draw(ctx, p) {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.5, p.r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  summer: {
    bubble: () => '시원한 여름!',
    density: 40, size: [3, 6], speed: [0.2, 0.5], spin: 0.01, rise: true,
    colors: () => ['#a8936a'],
    draw(ctx, p) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, p.r * 1.6);
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r);
      }
      ctx.stroke();
    },
  },
  autumn: {
    bubble: () => '단풍 구경 가요!',
    density: 34, size: [4, 7], speed: [0.5, 1.1], spin: 0.04,
    colors: () => ['#c0703a', '#a4472f', '#d4a24c', '#8a5a2b'],
    draw(ctx, p) {
      ctx.beginPath();
      ctx.moveTo(0, -p.r);
      ctx.quadraticCurveTo(p.r, 0, 0, p.r);
      ctx.quadraticCurveTo(-p.r, 0, 0, -p.r);
      ctx.fill();
    },
  },
};

const seasonFx = (() => {
  const header = $('.site-header');
  const canvas = $('#season-fx');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = ([min, max]) => min + Math.random() * (max - min);
  let fx = null;
  let particles = [];
  let w = 0;
  let h = 0;
  let running = false;

  const newParticle = (y) => {
    const colors = fx.colors();
    return {
      x: Math.random() * w,
      y,
      r: rand(fx.size),
      speed: rand(fx.speed),
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2 * fx.spin,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  };

  function fill() {
    const count = Math.min(90, Math.round(w / fx.density));
    particles = Array.from({ length: count }, () => newParticle(Math.random() * h));
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fx) fill();
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.y += fx.rise ? -p.speed : p.speed;
      p.phase += 0.02;
      p.x += Math.sin(p.phase) * 0.4;
      p.rot += p.spin;
      if (!fx.rise && p.y - p.r * 2 > h) Object.assign(p, newParticle(-p.r * 2));
      if (fx.rise && p.y + p.r * 2 < 0) Object.assign(p, newParticle(h + p.r * 2));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = 0.55 + p.r / 16;
      ctx.fillStyle = p.color;
      fx.draw(ctx, p);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    set(date) {
      const season = seasonOf(date);
      header.dataset.season = season;
      fx = SEASON_FX[season];
      $('#mascot-bubble').textContent = fx.bubble(Number(date.slice(5, 7)));
      if (reduceMotion) return; // 움직임 줄이기 설정이면 마스코트·배경만 바꾸고 효과는 끈다
      fill();
      if (!running) {
        running = true;
        frame();
      }
    },
  };
})();

seasonFx.set(todayKst());
loadAll();
setInterval(() => {
  if (selectedDate === todayKst()) loadAll();
}, AUTO_REFRESH_MS);
