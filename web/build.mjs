/* 빌드: engine 모듈 + 화면 JS를 한 덩어리로 번들해 index.html에 인라인 → dist/index.html 단일 파일.
   정적 호스팅에 dist/index.html 하나만 올리면 배포 끝(프로젝트의 단일 파일 배포 원칙 유지).

   같은 결과물을 저장소 루트의 docs/index.html 로도 함께 쓴다 — GitHub Pages가
   main 브랜치의 /docs 를 서빙하기 때문. 손으로 복사하면 반드시 잊어버려서 옛 화면이
   게시되므로, 배포본 생성은 이 스크립트 한 곳에서만 일어나게 묶어 둔다. */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  write: false,
  charset: 'utf8',
  external: ['node:fs'], // kasi-client의 동적 import — 브라우저에선 실패해도 조용히 무시됨
});
const js = result.outputFiles[0].text;
if (js.includes('</script')) throw new Error('번들에 </script 문자열 — 인라인 불가');

const tpl = readFileSync('index.html', 'utf8');
if (!tpl.includes('/*__APP_JS__*/')) throw new Error('index.html에 /*__APP_JS__*/ 플레이스홀더 없음');
const html = tpl.replace('/*__APP_JS__*/', () => js);

const PAGES_DIR = fileURLToPath(new URL('../docs', import.meta.url)); // GitHub Pages 게시 경로
for (const dir of ['dist', PAGES_DIR]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, html);
}
console.log(`dist/index.html + docs/index.html 생성 (번들 ${(js.length / 1024).toFixed(1)}KB)`);
