// Run with a locally installed Playwright package; serve only this repository on loopback.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const packagePath=process.env.PLAYWRIGHT_PACKAGE || 'playwright';
const {chromium}=await import(packagePath.startsWith('C:')?pathToFileURL(packagePath).href:packagePath);
const server=createServer((req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root))throw Error('path');res.setHeader('Content-Type',p.endsWith('.mp3')?'audio/mpeg':p.endsWith('.mjs')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function state(){return page.evaluate(()=>window.fixture.state());}
async function click(action){await page.locator(`[data-action="${action}"]`).click();await page.waitForFunction(()=>!document.querySelector('[data-action="start"]').disabled);}
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/test/classroom-presentation/harness.html`);await page.waitForFunction(()=>window.ready);
  await check('production groupLive mounts controls and opens/closes/reopens common popup',async()=>{await page.locator('#gCommonExpand').click();assert.equal(await page.locator('dialog').evaluate(e=>e.open),true);await page.locator('[data-close]').click();await page.locator('#gCommonExpand').click();assert.equal(await page.locator('dialog').evaluate(e=>e.open),true);});
  await check('Escape closes and restores trigger focus',async()=>{await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').evaluate(e=>e.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'gCommonExpand');});
  await check('RichText exact DOM matches common renderer, retains full long content and formatting',async()=>{
    await page.evaluate(()=>{const text='Nội dung dài '.repeat(65);const runs=[];for(let i=0;i<text.length;i+=400)runs.push({text:text.slice(i,i+400),font:'times',size:24,color:'blue',bold:true,italic:true});window.fixture.update({instructions:text+'\n\nCuối',instructionsRich:{version:1,blocks:[{type:'paragraph',runs},{type:'paragraph',runs:[{text:''}]},{type:'paragraph',runs:[{text:'Cuối'}]}]}});});
    await page.locator('#gCommonExpand').click();
    assert.equal(await page.locator('[data-content]').innerHTML(),await page.locator('#gLiveInstructions').innerHTML());
    assert.ok((await page.locator('[data-content]').textContent()).endsWith('Cuối'));
    const span=page.locator('[data-content] span').first();assert.equal(await span.evaluate(e=>e.style.fontSize),'24px');assert.equal(await span.evaluate(e=>e.style.fontWeight),'700');assert.equal(await span.evaluate(e=>e.style.fontStyle),'italic');
    await page.locator('[data-close]').click();
  });
  await check('invalid rich content/XSS fails closed to inert plain text in popup',async()=>{await page.evaluate(()=>window.fixture.update({instructions:'<img src=x onerror=alert(1)>',instructionsRich:{version:1,blocks:[{type:'paragraph',runs:[{text:'bad',color:'red;position:fixed'}]}]}}));await page.locator('#gCommonExpand').click();assert.equal(await page.locator('[data-content] img').count(),0);assert.equal(await page.locator('[data-content]').textContent(),'<img src=x onerror=alert(1)>');await page.locator('[data-close]').click();});
  await check('set/start persists chosen duration and synchronizes all clocks including popup',async()=>{await page.locator('[data-minutes]').fill('5');await click('start');assert.equal((await state()).durationSec,300);await page.locator('#gCommonExpand').click();assert.equal(await page.locator('[data-clock]').textContent(),await page.locator('#gTimer').textContent());await page.locator('[data-close]').click();});
  await check('pause freezes; resume uses remaining time',async()=>{await page.evaluate(()=>window.fixture.update({startedAt:new Date(Date.now()-10000)}));await click('pause');const paused=await state();assert.ok(paused.pausedRemainingSec>=289&&paused.pausedRemainingSec<=290);assert.equal(paused.startedAt,null);await click('resume');assert.equal((await state()).durationSec,paused.pausedRemainingSec);});
  await check('+1/-1 changes countdown while preserving paused state',async()=>{await click('pause');const before=(await state()).pausedRemainingSec;await click('add');assert.equal((await state()).pausedRemainingSec,before+60);await click('subtract');assert.equal((await state()).pausedRemainingSec,before);});
  await check('reset uses input and stays paused',async()=>{await page.locator('[data-minutes]').fill('2');await click('reset');assert.equal((await state()).durationSec,120);assert.equal((await state()).startedAt,null);});
  await check('expiry shows 00:00 and visual indication in popup, without lifecycle writes',async()=>{await page.evaluate(()=>window.fixture.update({durationSec:1,startedAt:new Date(Date.now()-2000),pausedRemainingSec:null}));await page.locator('#gCommonExpand').click();assert.equal(await page.locator('[data-clock]').textContent(),'00:00');assert.equal(await page.locator('[data-expiry]').textContent(),'HẾT GIỜ');assert.equal(await page.locator('dialog').evaluate(e=>e.classList.contains('expired')),true);assert.equal((await state()).status,'open');await page.locator('[data-close]').click();});
  await check('restart immediately after expiry and invalid input stays local',async()=>{await page.locator('[data-minutes]').fill('5');await click('start');assert.equal((await state()).durationSec,300);const count=await page.evaluate(()=>fixture.writes().length);await page.locator('[data-minutes]').fill('-2');await click('start');assert.equal(await page.evaluate(()=>fixture.writes().length),count);assert.ok(await page.evaluate(()=>window.lastError));});
  await check('sound toggle handles autoplay rejection without errors',async()=>{await page.evaluate(()=>{window.Audio=class{play(){return Promise.reject(Error('autoplay blocked'));}pause(){}removeAttribute(){}load(){}};});await page.locator('[data-sound]').check();await page.evaluate(()=>fixture.update({durationSec:1,startedAt:new Date(),pausedRemainingSec:null}));await page.waitForTimeout(1400);assert.equal((await state()).status,'open');await page.locator('[data-sound]').uncheck();});
  await check('all timer write payloads exclude status/content/membership',async()=>{const writes=await page.evaluate(()=>fixture.writes());assert.ok(writes.length>0);for(const p of writes)assert.deepEqual(Object.keys(p).sort(),['durationSec','pausedRemainingSec','startedAt','updatedAt']);});
  await check('responsive popup fits small viewport with scroll and reachable close',async()=>{await page.setViewportSize({width:390,height:844});await page.locator('#gCommonExpand').click();const box=await page.locator('dialog').boundingBox();assert.ok(box.x>=0&&box.width<=390&&box.height<=844);assert.equal(await page.locator('[data-close]').isVisible(),true);});
  const out=process.env.CLASSROOM_TEST_OUTPUT;if(out){mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'popup-mobile.png')});await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>fixture.update({instructions:'Nhiệm vụ chung\n1. Thảo luận các phương án.\n2. Chuẩn bị trình bày kết quả.',instructionsRich:null,durationSec:300,startedAt:null,pausedRemainingSec:300}));await page.screenshot({path:path.join(out,'popup-desktop.png')});}
  await check('cleanup removes popup and controls',async()=>{await page.evaluate(()=>fixture.dispose());assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.locator('.classroom-tools').count(),0);});
  await page.reload();await page.waitForFunction(()=>window.ready);

  await check('combined MP3 decodes as a single element; starts once at the 10s threshold',async()=>{
    await page.reload();await page.waitForFunction(()=>window.ready);
    await page.evaluate(()=>{const Native=window.Audio;window.assets=[];window.Audio=class extends Native{constructor(url){super(url);window.assets.push(this)}}});
    await page.locator('[data-sound]').check();
    await page.waitForFunction(()=>assets.length===1&&assets[0].readyState>=2&&!assets[0].muted);
    const metadata=await page.evaluate(()=>({src:assets[0].src,duration:assets[0].duration,loop:assets[0].loop}));
    assert.ok(metadata.src.endsWith('/assets/audio/timer-expiry-combined.mp3'));
    assert.ok(Number.isFinite(metadata.duration)&&metadata.duration>10&&!metadata.loop);
    await page.evaluate(()=>fixture.update({durationSec:10,startedAt:new Date(),pausedRemainingSec:null}));
    await page.waitForFunction(()=>!assets[0].paused&&assets[0].currentTime>0);
    assert.equal(await page.evaluate(()=>assets.length),1);
  });
  await check('no stop/replace at 00:00: the single asset continues on its own into the alarm tail and reaches natural end',async()=>{
    await page.evaluate(()=>fixture.update({durationSec:1,startedAt:new Date(),pausedRemainingSec:null}));
    await page.waitForFunction(()=>!assets[0].paused);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>assets[0].paused),false);
    await page.waitForFunction(()=>assets[0].ended,{},{timeout:20000});
    assert.ok(await page.evaluate(()=>Math.abs(assets[0].currentTime-assets[0].duration)<0.1));
    await page.evaluate(()=>fixture.dispose());assert.ok(await page.evaluate(()=>assets[0].paused));
  });
  await check('single play, popup duplicates none, pause/resume/adjustments safe, no second play at 00:00',async()=>{
    await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
    await page.reload();await page.waitForFunction(()=>window.ready);
    await page.evaluate(()=>{window.events=[];window.media=[];window.Audio=class{currentTime=0;paused=true;muted=false;constructor(url){this.url=url;media.push(this)}play(){this.paused=false;if(!this.muted)events.push({url:this.url,offset:this.currentTime});return Promise.resolve()}pause(){this.paused=true}removeAttribute(){}load(){}}});
    await page.locator('[data-sound]').check();
    await page.evaluate(()=>fixture.update({durationSec:11,startedAt:new Date(),pausedRemainingSec:null}));
    await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>events.length),1);
    await page.locator('#gCommonExpand').click();await page.locator('[data-close]').click();assert.equal(await page.evaluate(()=>events.length),1);
    await click('pause');assert.equal(await page.evaluate(()=>media[0].paused),true);
    await page.clock.runFor(1000);await click('resume');assert.equal(await page.evaluate(()=>events.length),2);
    assert.ok(await page.evaluate(()=>events[1].offset>0));
    await click('add');assert.equal(await page.evaluate(()=>media[0].paused),true);await click('subtract');assert.equal(await page.evaluate(()=>events.length),3);
    await page.clock.runFor(11000);
    assert.equal(await page.evaluate(()=>events.length),3);
    assert.equal(await page.evaluate(()=>media[0].paused),false);
    await page.clock.runFor(5000);assert.equal(await page.evaluate(()=>events.length),3);
    await page.locator('[data-sound]').uncheck();assert.equal(await page.evaluate(()=>media[0].paused),true);
    await page.evaluate(()=>fixture.dispose());
  });
  await check('expired opening stays silent; turning ON afterwards does not replay an already-consumed cycle',async()=>{
    await page.reload();await page.waitForFunction(()=>window.ready);
    await page.evaluate(()=>{window.count=0;window.Audio=class{play(){if(!this.muted)count++;return Promise.reject(Error('blocked'))}pause(){}removeAttribute(){}load(){}};fixture.update({durationSec:1,startedAt:new Date(Date.now()-60000)})});
    await page.locator('[data-sound]').check();await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>count),0);
    await page.evaluate(()=>fixture.update({durationSec:10,startedAt:new Date()}));await page.clock.runFor(2000);assert.equal(await page.evaluate(()=>count),1);
  });
  assert.deepEqual(errors,[]);if(out)writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,failed:0,checks,errors},null,2));
}finally{await browser.close();server.close();}
