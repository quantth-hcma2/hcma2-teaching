import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('index.html'), 'utf8');
const between = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source boundary: ${start}`);
  return source.slice(a, b);
};
const menu = between('const TEACHER_MENU = [', 'let teacherRouteGeneration=0;');
const router = between('function navigateTeacherTopLevel(key){', 'async function teacherOverview(c){');
const history = between('async function teacherHistory(c,', 'async function teacherReportView(c,');
const report = between('async function teacherReportView(c,', 'function downloadBlob(');

test('1: standalone report item is absent from teacher sidebar', () => {
  assert.doesNotMatch(menu, /key:"reports"|label:"Báo cáo"/);
});
test('2, 12: Interaction owns history and retains search/status filtering', () => {
  assert.match(router, /if\(key==="create"\) return teacherHistory\(c,routeGeneration\)/);
  assert.match(history, /LỊCH SỬ \/ KẾT QUẢ/);
  assert.match(history, /id="hSearch"/);
  assert.match(history, /id="hFilter"/);
  assert.match(history, /\(!fl\|\|s\.status===fl\).*\(!kw\|\|s\.title\.toLowerCase\(\)\.includes\(kw\)\)/);
});
test('3, 5: result reopening and direct report URL use the same report view', () => {
  assert.match(history, /data-r="\$\{s\.id\}"/);
  assert.match(history, /MỞ LẠI KẾT QUẢ/);
  assert.match(history, /window\.location\.hash = "#\/report\/"\+encodeURIComponent\(b\.dataset\.r\)/);
  assert.match(router, /hash\.startsWith\("#\/report\/"\).*teacherReportView\(c, decodeURIComponent\(hash\.split\("\/"\)\[2\]\)\)/);
});
test('4, 6, 7: in-app Back targets Interaction; hash navigation remains native', () => {
  assert.match(report, /\$\("#btnBackRep"\)\.onclick = \(\)=>navigateTeacherTopLevel\("create"\)/);
  assert.match(router, /STATE\.teacherNav=key;\s*clearListeners\(\);\s*if\(window\.location\.hash\)\{ window\.location\.hash=""; return; \}/);
  assert.doesNotMatch(report, /window\.history\.length|teacherNav="reports"/);
  assert.doesNotMatch(router, /history\.replaceState|history\.pushState/);
  assert.match(router, /if\(key==="history" \|\| key==="reports"\)/);
});
test('8–11: report rendering, chart, print, CSV and JSON remain wired', () => {
  assert.match(report, /resolveReportQuestionBlocks\(/);
  assert.match(report, /renderChart\(canvas, b\.q, b\.options, b\.docs, "report"\)/);
  assert.match(report, /\$\("#btnPrint"\)\.onclick = \(\)=>window\.print\(\)/);
  assert.match(report, /\$\("#btnCsv"\)\.onclick = \(\)=>exportSessionCSV\(/);
  assert.match(report, /\$\("#btnJson"\)\.onclick = \(\)=>exportSessionJSON\(/);
  assert.match(source, /function exportSessionCSV\(/);
  assert.match(source, /function exportSessionJSON\(/);
});
