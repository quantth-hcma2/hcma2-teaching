import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base='63c32f4c0c918ef7ecead9588afaea2de8c72ce1';
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const baseline=name=>execFileSync('git',['show',`${base}:${name}`],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
test('RichText contract, renderer, editor, serializer hotfix, membership and base Rules are byte-equivalent to production',()=>{
  for(const name of ['rich-text-contract.mjs','rich-text-renderer.mjs','rich-text-editor.mjs','rich-text-editor-serializer.mjs','group-membership.mjs','firestore.rules'])assert.equal(read(name),baseline(name),name);
});
test('candidate Rules differ only by the isolated legacy timer allow clause',()=>{
  const rules=read('firestore.rules.production-candidate');
  const start=rules.indexOf('      // CLASSROOM PRESENTATION V1:');
  const end=rules.indexOf('      // groupActivities has no trash stage',start);
  assert.ok(start>0&&end>start);
  assert.equal(rules.slice(0,start)+rules.slice(end),baseline('firestore.rules.production-candidate'));
});
test('index changes stay inside Group Discussion plus two imports and one stylesheet',()=>{
  function strip(source){
    source=source.replace('<link rel="stylesheet" href="./group-classroom-presentation.css">\n','').replace('import { timerSeconds, writeTimer } from "./group-classroom-timer.mjs";\n','').replace('import { mountClassroomPresentation } from "./group-classroom-presentation.mjs";\n','');
    const start=source.indexOf('async function groupLive('),end=source.indexOf('// GATE 2A-AUTH-I2-CORRECTION: owner/admin-only roster',start);
    source=source.slice(0,start)+source.slice(end);
    // Locate the student clock by its unique element, independent of the surrounding function name.
    const marker=source.indexOf('      const el=$("#gsTimer");');
    const studentEnd=source.indexOf('    },1000);',marker);
    assert.ok(marker>0&&studentEnd>marker);
    return source.slice(0,marker)+source.slice(studentEnd);
  }
  assert.equal(strip(read('index.html')),strip(baseline('index.html')));
});
