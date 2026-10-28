// 백엔드 서버 (Node.js 기본 모듈 + 배너 AI 분석용 openai 패키지)
// - OpenAI API 키는 프로젝트 루트의 .env 에서 읽으며, 백엔드에서만 사용한다 (브라우저로 보내지 않음)
// - GET /api/briefing           : 기준일의 IT 뉴스 + 정책 변경 (JSON)
//       ?date=YYYY-MM-DD (생략하면 오늘, 한국 시간)   ?refresh=1 (캐시 무시)
// - GET /api/banner?date=...     : 메인 배너 '오늘의 IT 업계 브리핑' 3줄
// - 그 외 경로                 : frontend 폴더의 정적 파일 제공

const http = require('http');
const fs = require('fs');
const path = require('path');

// 프로젝트 루트의 .env 를 환경변수로 불러온다 (Node.js 내장 기능, 다른 모듈보다 먼저 실행)
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const { getBriefing, todayKst, isValidDate } = require('./newsService');
const { getBanner } = require('./bannerWriter');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, pathname) {
  const filePath = path.normalize(path.join(FRONTEND_DIR, pathname === '/' ? 'index.html' : pathname));
  // frontend 폴더 밖의 파일(.env, backend 코드 등) 접근 차단
  if (!filePath.startsWith(FRONTEND_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/briefing' || url.pathname === '/api/banner') {
    const date = url.searchParams.get('date') || todayKst();
    if (!isValidDate(date)) return sendJson(res, 400, { error: '날짜는 오늘 이전의 YYYY-MM-DD 형식이어야 합니다.' });
    try {
      const { analysis, ...briefing } = await getBriefing({ date, force: url.searchParams.get('refresh') === '1' });
      if (url.pathname === '/api/banner') return sendJson(res, 200, await getBanner(date, analysis));
      return sendJson(res, 200, briefing);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: '뉴스를 가져오는 중 오류가 발생했습니다.' });
    }
  }

  serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY
    ? `   배너 AI 분석: 켜짐 (모델 ${process.env.OPENAI_MODEL || 'gpt-4o-mini'})`
    : '   배너 AI 분석: 꺼짐 (.env 에 OPENAI_API_KEY 를 넣으면 켜집니다)');
  console.log('   종료하려면 Ctrl + C 를 누르세요.');
});
