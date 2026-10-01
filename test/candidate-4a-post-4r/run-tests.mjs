import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const here=path.join(root,'test','candidate-4a-post-4r');
const prior=path.resolve(root,'../../../../2026-09-21/referenced-chatgpt-conversation-this-is-an/work/library-hub-card-port-04e7eb6');
const jdkRoot=path.join(prior,'.local-tools','jdk21');
const jdkHome=readdirSync(jdkRoot,{withFileTypes:true}).filter(x=>x.isDirectory())
  .map(x=>path.join(jdkRoot,x.name)).find(x=>existsSync(path.join(x,'bin','java.exe')));
const cache=path.join(prior,'.local-tools','npm-cache','_npx');
const firebaseCli=readdirSync(cache,{withFileTypes:true}).filter(x=>x.isDirectory())
  .map(x=>path.join(cache,x.name,'node_modules','firebase-tools','lib','bin','firebase.js')).find(existsSync);
if(!jdkHome||!firebaseCli)throw new Error('Existing emulator runtime is unavailable');
const env={...process.env,JAVA_HOME:jdkHome,PATH:`${path.join(jdkHome,'bin')};${process.env.PATH||process.env.Path||''}`,
  XDG_CONFIG_HOME:path.join(root,'.local-tools','config')};
const selected=process.env.HCMA2_TEST_PATTERN
  ? ` --test-name-pattern="${process.env.HCMA2_TEST_PATTERN}"` : '';
const skipped=process.env.HCMA2_TEST_SKIP_PATTERN
  ? ` --test-skip-pattern="${process.env.HCMA2_TEST_SKIP_PATTERN}"` : '';
const testFile=process.env.HCMA2_TEST_FILE||'lifecycle.test.mjs';
const command=`"${process.execPath}" --test --test-concurrency=1${selected}${skipped} "${path.join(here,testFile)}"`;
const result=spawnSync(process.execPath,[firebaseCli,'emulators:exec','--config',path.join(here,'firebase.json'),
  '--project','demo-candidate-4a-post-4r','--only','firestore',command],{cwd:root,env,encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
if(result.error)throw result.error;
const output=`${result.stdout||''}\n${result.stderr||''}`;
if(result.status!==0){
  console.error('Candidate 4A behavior/parity test failed; no E2 diagnostics accepted');
  process.exit(result.status??1);
}
if(!process.env.HCMA2_TEST_BASELINE_RULES && !process.env.HCMA2_DIAGNOSTIC_ONLY){
  const fatal=/Null value error|undefined value|maximum of 1000 expressions|maximum number of.*document access calls|too many document access calls/i;
  if(fatal.test(output)){
    console.error('Candidate 4A genuine Null/undefined or expression/access limit diagnostic detected');
    process.exit(1);
  }
  const countsLine=output.split(/\r?\n/).find(line=>line.includes('GATE_COUNTS '));
  const counts=countsLine&&JSON.parse(countsLine.slice(countsLine.indexOf('GATE_COUNTS ')+12));
  const denied=output.split(/\r?\n/).filter(line=>line.includes('GATE_DENY '))
    .map(line=>JSON.parse(line.slice(line.indexOf('GATE_DENY ')+10)));
  if(testFile!=='lifecycle.test.mjs'||selected||skipped||!counts||
      counts.null||counts.expressionLimit||counts.accessLimit||counts.other||
      counts.E2!==2||counts.R2!==4||counts.C3!==15||
      denied.length!==Object.values(counts).reduce((a,b)=>a+b,0)||
      denied.filter(x=>x.actual==='C3').some(x=>!/^D(?:0[1-9]|1[0-5])$/.test(x.ledgerId||''))){
    console.error('Candidate 4A gate did not match the locked E2/R2/D01-D15 ledger');
    process.exit(1);
  }
  console.log(`Locked diagnostic ledger matched: E2=${counts.E2}, R2=${counts.R2}, C3=${counts.C3}; new/unclassified=0`);
}
process.exit(result.status??1);
