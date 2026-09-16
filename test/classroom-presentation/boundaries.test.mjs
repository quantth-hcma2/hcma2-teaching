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
// GATE 4C-C.2 RECONCILIATION: Item 4 (GATE 4C-A/B/C/C.2, approved separately) added the
// Knowledge participant-panel UI to index.html — entirely disjoint from Group Discussion /
// Classroom Presentation, but present in the same file. stripItem4() narrowly removes exactly
// Item 4's three known insertion points (the knPfViewState declaration, the
// knowledgeParticipantsMarkup()/knowledgeRenderParticipantsCompact() functions — renamed back
// to their pre-Item-4 form first so the region boundary is identical on both sides — and the
// kn-pf-compact CSS block + class attribute) before the pre-existing historical comparison
// below runs, so that comparison keeps protecting every Classroom-Presentation/Timer/Group-
// Discussion byte while no longer requiring Item 4's separately-approved work to be absent.
// It is a narrow, anchor-bounded removal (verified to reproduce the known-clean production
// baseline exactly, and to still fail on a synthetic unauthorized change to Classroom-
// Presentation-owned code) — not a broad "ignore index.html" escape hatch, and it never
// touches any file outside this test.
function stripItem4(source){
  source=source.replace(' class="kn-pf-compact"','');
  const cssStart=source.indexOf('/* GATE 4C-B: Knowledge participant Compact card only');
  if(cssStart!==-1){
    const cssEnd=source.indexOf('\n\n/* Badges */',cssStart);
    source=source.slice(0,cssStart)+source.slice(cssEnd+1);
  }
  source=source.replaceAll('knowledgeRenderParticipantsCompact','knowledgeRenderParticipants');
  const aStart=source.indexOf('const participantCounts=new Map();\n');
  const aEnd=source.indexOf('  const openerUid=STATE.user.uid;',aStart);
  if(aStart!==-1&&aEnd!==-1)source=source.slice(0,aStart+'const participantCounts=new Map();\n'.length)+source.slice(aEnd);
  const closeAnchor='    knowledgeRenderParticipants();\n  }\n';
  const closePos=source.indexOf(closeAnchor);
  const bStart=closePos!==-1?closePos+closeAnchor.length:-1;
  const bEnd=source.indexOf('function knowledgeSpreadsheetSafe(',bStart);
  if(bStart!==-1&&bEnd!==-1)source=source.slice(0,bStart)+source.slice(bEnd);
  return source;
}
test('index changes stay inside Group Discussion plus two imports and one stylesheet (plus the separately-approved Item 4 participant panel)',()=>{
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
  assert.equal(strip(stripItem4(read('index.html'))),strip(stripItem4(baseline('index.html'))));
});
