import fs from 'node:fs/promises';
import path from 'node:path';
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const [,, specPath, outPath] = process.argv;
if (!specPath || !outPath) {
  console.error('Usage: node scripts/render-card.mjs <spec.json> <out.png>');
  process.exit(2);
}
const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
const width = spec.width || 680;
const height = spec.height || 720;
const amber = '#d8b06a';
const blue = '#7fb8ff';
const h = (type, style, children = []) => ({ type, props: { style, children } });
const txt = (s) => String(s ?? '');

async function maybeRead(p) { try { return await fs.readFile(p); } catch { return null; } }
const fontPaths = [
  ['/System/Library/Fonts/Supplemental/Arial.ttf', 400],
  ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', 700],
  ['/System/Library/Fonts/SFNS.ttf', 400]
];
const fonts = [];
for (const [p, weight] of fontPaths) {
  const data = await maybeRead(p);
  if (data) fonts.push({ name: 'CardFont', data, weight, style: 'normal' });
  if (fonts.length >= 2) break;
}
if (!fonts.length) throw new Error('No usable font found');
const fontFamily = 'CardFont';

const Text = (content, style={}) => h('div', { display:'flex', fontFamily, ...style }, txt(content));
const tagColor = spec.tagColor === 'amber' ? amber : blue;
function row(r) {
  return h('div', { display:'flex', flexDirection:'row', gap:14, padding:'12px 0', borderTop:'1px solid rgba(255,255,255,.07)' }, [
    Text(r.k, { width:160, fontSize:12, color:'#8a8d94', paddingTop:2 }),
    Text(r.v, { flex:1, fontSize:14, color:'#d6d8dd', lineHeight:1.5 })
  ]);
}
function step(s, last) {
  return h('div', { display:'flex', flexDirection:'row', gap:16 }, [
    h('div', { display:'flex', flexDirection:'column', alignItems:'center', width:14 }, [
      h('div', { display:'flex', width:10, height:10, borderRadius:999, background:'#3b6df0', marginTop:5 }),
      ...(last ? [] : [h('div', { display:'flex', width:2, flex:1, background:'rgba(255,255,255,.10)', minHeight:12 })])
    ]),
    h('div', { display:'flex', flexDirection:'column', paddingBottom:16 }, [
      Text(s.q, { fontSize:14.5, color:'#e9e9ec', fontWeight:700 }),
      Text(s.a, { fontSize:12.5, color:'#9a9da5', marginTop:2, lineHeight:1.5 })
    ])
  ]);
}
function bar(b) {
  const c = b.color === 'amber' ? amber : b.color === 'dim' ? '#454b57' : '#3b6df0';
  return h('div', { display:'flex', flexDirection:'row', alignItems:'center', gap:12, margin:'10px 0' }, [
    Text(b.label, { width:170, fontSize:12.5, color:'#c9ccd3', justifyContent:'flex-end' }),
    h('div', { display:'flex', height:20, width:Math.max(3, Math.min(100, b.pct ?? 0))*3.4, borderRadius:5, background:c }),
    Text(b.value, { fontSize:12, color:'#8a8d94' })
  ]);
}
function verdict(v) {
  if (!v) return null;
  const isBlue = v.color === 'blue';
  return h('div', { display:'flex', flexDirection:'column', marginTop:24, padding:'16px 18px', background:isBlue?'rgba(90,150,255,.07)':'rgba(216,176,106,.08)', borderLeft:`3px solid ${isBlue?'#3b6df0':amber}`, borderRadius:'0 10px 10px 0' }, [
    Text(v.k, { fontSize:10.5, letterSpacing:1.4, textTransform:'uppercase', color:isBlue?blue:amber, marginBottom:6 }),
    Text(v.v, { fontSize:14, color:'#e9e9ec', lineHeight:1.55 })
  ]);
}
const cardKids = [];
if (spec.tag) cardKids.push(Text(spec.tag, { fontSize:11, letterSpacing:1.6, textTransform:'uppercase', color:tagColor, marginBottom:14 }));
if (spec.title) cardKids.push(Text(spec.title, { fontSize:23, color:'#f2f2f4', fontWeight:700, marginBottom:10 }));
if (spec.sub) cardKids.push(Text(spec.sub, { fontSize:13, color:'#9a9da5', marginBottom:26, lineHeight:1.5 }));
for (const b of spec.bars || []) cardKids.push(bar(b));
for (const r of spec.rows || []) cardKids.push(row(r));
(spec.steps || []).forEach((s,i,a)=>cardKids.push(step(s, i===a.length-1)));
const v = verdict(spec.verdict); if (v) cardKids.push(v);

const tree = h('div', { display:'flex', alignItems:'center', justifyContent:'center', width, height, background:'#14171c', padding:44 }, [
  h('div', { display:'flex', flexDirection:'column', width:width-80, background:'#1d2129', border:'1px solid rgba(255,255,255,.09)', borderRadius:16, padding:'40px 46px' }, cardKids)
]);

const svg = await satori(tree, { width, height, fonts });
const wasmPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
await initWasm(await fs.readFile(wasmPath));
const png = new Resvg(svg, { fitTo: { mode:'width', value:width } }).render().asPng();
await fs.writeFile(outPath, png);
console.log(JSON.stringify({ outPath, bytes:png.length, font:fonts.map(f=>`${f.weight}`).join(',') }));
