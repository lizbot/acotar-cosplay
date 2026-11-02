import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../starfall-sky.js', import.meta.url), 'utf8')).split('(function StarfallSky()')[0];
function sky() {
  const sandbox = { window: { innerWidth:1200, innerHeight:800 } };
  vm.runInNewContext(source + '\nglobalThis.sky = { ShootingStar, Particle, config: SFCFG };', sandbox);
  return sandbox.sky;
}
function run(fps) {
  const { ShootingStar } = sky(), particles = [];
  const star = new ShootingStar(600,300,30,true,150,1,1,1200,800);
  for (let i=0;i<fps;i++) star.update(1/fps,[],particles);
  return particles;
}
test('cyan shooting stars emit a dust wake at both low and high frame rates', () => {
  const low = run(30), high = run(120);
  assert.ok(low.length > 15); assert.ok(high.length > 15);
  assert.ok(Math.abs(low.length - high.length) <= 8);
});
test('dust lingers after the star, then expires; particle count stays bounded', () => {
  const { ShootingStar, Particle, config } = sky(); const dust = new Particle(1,1);
  dust.update(1); assert.equal(dust.done,false);
  for(let i=0;i<240;i++) dust.update(1/60);
  assert.equal(dust.done,true);
  config.SHOOT_DUST_MAX=12; const particles=[];
  const star=new ShootingStar(600,300,30,true,150,1,1,1200,800);
  for(let i=0;i<60;i++)star.update(1/60,[],particles);
  assert.equal(particles.length,12);
});
test('shooting-star head and trail use cyan rather than the old gold palette', () => {
  const { ShootingStar }=sky(), colors=[];
  const gradient={addColorStop:(_,color)=>colors.push(color)};
  const ctx={save(){},restore(){},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};
  const star=new ShootingStar(600,300,30,true,150,1,1,1200,800);star.t=.5;star.draw(ctx);
  assert.ok(colors.some(c=>c.startsWith('rgba(87,243,222,')));
  assert.ok(colors.some(c=>c.startsWith('rgba(212,255,250,')));
  assert.ok(!colors.some(c=>c.includes('255,248,200')));
});
