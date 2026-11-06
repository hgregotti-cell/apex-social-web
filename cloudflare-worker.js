/** Apex Social Web · Cloudflare Worker + D1.
 * Binding D1: DB -> apex-social-db
 * Secret: ADMIN_PASSWORD (no publicar el valor).
 * Frontend permitido: https://hgregotti-cell.github.io
 */
const ORIGIN='https://hgregotti-cell.github.io';
const json=(data,status=200,origin=ORIGIN)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, X-Apex-Password','Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Vary':'Origin'}});
const parseJson=s=>{try{return JSON.parse(s)}catch{return null}};
function valid(s){return s&&typeof s.id==='string'&&/^[-_a-zA-Z0-9]{1,80}$/.test(s.id)&&typeof s.name==='string'&&s.name.trim().length>0&&s.name.length<=80&&Number.isFinite(s.lat)&&Math.abs(s.lat)<=90&&Number.isFinite(s.lon)&&Math.abs(s.lon)<=180&&Array.isArray(s.windFromDirections)&&s.windFromDirections.length<=16&&s.windFromDirections.every(x=>Number.isFinite(x)&&x>=0&&x<360)&&[s.maxWind,s.maxGust,s.tolerance].every(x=>x===undefined||(Number.isFinite(x)&&x>=0&&x<=120))&&(s.notes===undefined||(typeof s.notes==='string'&&s.notes.length<=500));}
const schema=`CREATE TABLE IF NOT EXISTS despegues (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, latitud REAL NOT NULL, longitud REAL NOT NULL, orientaciones TEXT NOT NULL DEFAULT '[]', condiciones TEXT NOT NULL DEFAULT '{}', observaciones TEXT NOT NULL DEFAULT '', datos_extra TEXT NOT NULL DEFAULT '{}', creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
export default {async fetch(request,env){
 const origin=request.headers.get('Origin')||'';
 if(origin&&origin!==ORIGIN)return json({error:'Origen no autorizado'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Content-Type, X-Apex-Password','Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Vary':'Origin'}});
 const path=new URL(request.url).pathname;
 if(path==='/')return json({ok:true,service:'apex-social-api',storage:'D1'});
 if(!env.DB)return json({error:'Falta configurar binding D1 llamado DB'},503);
 if(path==='/despegues'&&request.method==='GET'){
  try{const result=await env.DB.prepare('SELECT id,nombre,latitud,longitud,orientaciones,condiciones,observaciones,datos_extra FROM despegues ORDER BY nombre').all();
   const despegues=(result.results||[]).map(r=>{const extra=parseJson(r.datos_extra)||{},cond=parseJson(r.condiciones)||{};return {...extra,id:r.id,name:r.nombre,lat:r.latitud,lon:r.longitud,windFromDirections:parseJson(r.orientaciones)||[],maxWind:cond.maxWind??extra.maxWind??30,maxGust:cond.maxGust??extra.maxGust??35,tolerance:cond.tolerance??extra.tolerance??30,notes:r.observaciones};});
   const meta=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='apex_metadata'").first();
   let initialized=false;if(meta){initialized=!!(await env.DB.prepare("SELECT value FROM apex_metadata WHERE key='initialized'").first())}
   return json({despegues,initialized});
  }catch(e){return json({error:'No se pudo leer D1: '+String(e.message||e)},500)}
 }
 if(!['/auth','/sites'].includes(path))return json({error:'Ruta inexistente'},404);
 if(!env.ADMIN_PASSWORD)return json({error:'Falta ADMIN_PASSWORD en Secrets'},503);
 if(request.headers.get('X-Apex-Password')!==env.ADMIN_PASSWORD)return json({error:'Contraseña incorrecta'},401);
 if(path==='/auth'&&request.method==='GET')return json({ok:true});
 if(path!=='/sites'||request.method!=='PUT')return json({error:'Método no permitido'},405);
 let body;try{body=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!Array.isArray(body.sites)||body.sites.length>500)return json({error:'Lista de lugares inválida'},400);
 const ids=new Set();for(const s of body.sites){if(!valid(s)||ids.has(s.id))return json({error:'Datos inválidos o ID duplicado'},400);ids.add(s.id)}
 try{
  const statements=[env.DB.prepare(schema),env.DB.prepare('CREATE TABLE IF NOT EXISTS apex_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),env.DB.prepare('DELETE FROM despegues')];
  for(const s of body.sites){const {id,name,lat,lon,windFromDirections,maxWind,maxGust,tolerance,notes,...extra}=s;statements.push(env.DB.prepare('INSERT INTO despegues (id,nombre,latitud,longitud,orientaciones,condiciones,observaciones,datos_extra) VALUES (?,?,?,?,?,?,?,?)').bind(id,name,lat,lon,JSON.stringify(windFromDirections),JSON.stringify({maxWind:maxWind??30,maxGust:maxGust??35,tolerance:tolerance??30}),notes||'',JSON.stringify(extra)));}
  statements.push(env.DB.prepare("INSERT INTO apex_metadata(key,value) VALUES('initialized','1') ON CONFLICT(key) DO UPDATE SET value='1'"));
  await env.DB.batch(statements);
  return json({ok:true,count:body.sites.length});
 }catch(e){return json({error:'No se pudo guardar en D1: '+String(e.message||e)},500)}
 }};
