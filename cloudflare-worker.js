/** Apex Social Web — backend privado de administración (Cloudflare Workers, plan gratuito).
 * Secrets: ADMIN_PASSWORD=VUELO, GITHUB_TOKEN=token fine-grained Contents: Read and write.
 * Vars: ALLOWED_ORIGIN=https://hgregotti-cell.github.io
 *       GITHUB_OWNER=hgregotti-cell, GITHUB_REPO=apex-social-web
 */
const reply=(obj,status=200,origin='')=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type, X-Apex-Password','Access-Control-Allow-Methods':'GET, PUT, OPTIONS'}});
const utf8base64=(str)=>{const bytes=new TextEncoder().encode(str);let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result)};
export default {async fetch(request,env){
 const origin=request.headers.get('Origin')||'';
 const allowed=env.ALLOWED_ORIGIN||'https://hgregotti-cell.github.io';
 if(origin!==allowed)return reply({error:'Origen no autorizado'},403,allowed);
 if(request.method==='OPTIONS')return reply({},204,allowed);
 const url=new URL(request.url);
 if(!['/auth','/sites'].includes(url.pathname))return reply({error:'Ruta inexistente'},404,allowed);
 if(!env.ADMIN_PASSWORD||!env.GITHUB_TOKEN)return reply({error:'Configuración del servidor incompleta'},503,allowed);
 if(request.headers.get('X-Apex-Password')!==env.ADMIN_PASSWORD)return reply({error:'Contraseña incorrecta'},401,allowed);
 if(url.pathname==='/auth'&&request.method==='GET')return reply({ok:true},200,allowed);
 if(url.pathname!=='/sites'||request.method!=='PUT')return reply({error:'Método no permitido'},405,allowed);
 let body;try{body=await request.json()}catch{return reply({error:'JSON inválido'},400,allowed)}
 if(!Array.isArray(body.sites)||body.sites.length>500)return reply({error:'Lista de lugares inválida'},400,allowed);
 const ids=new Set();
 for(const s of body.sites){
  if(typeof s.id!=='string'||!/^[-_a-zA-Z0-9]{1,80}$/.test(s.id)||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||!Number.isFinite(s.lat)||Math.abs(s.lat)>90||!Number.isFinite(s.lon)||Math.abs(s.lon)>180||!Array.isArray(s.windFromDirections)||s.windFromDirections.length>16||s.windFromDirections.some(d=>!Number.isFinite(d)||d<0||d>=360)||[s.maxWind,s.maxGust,s.tolerance].some(n=>n!==undefined&&(!Number.isFinite(n)||n<0||n>120))|| (s.notes!==undefined&&(typeof s.notes!=='string'||s.notes.length>500)))return reply({error:'Datos de despegue inválidos'},400,allowed);
  ids.add(s.id);
 }
 const owner=env.GITHUB_OWNER||'hgregotti-cell',repo=env.GITHUB_REPO||'apex-social-web';
 const endpoint=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/despegues.json`;
 const headers={'Authorization':`Bearer ${env.GITHUB_TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Apex-Social-Admin'};
 try{
  const current=await fetch(endpoint,{headers});if(!current.ok)return reply({error:'No se pudo consultar despegues.json en GitHub ('+current.status+')'},502,allowed);
  const meta=await current.json();
  const payload=JSON.stringify({version:1,sites:body.sites},null,2)+'\n';
  const write=await fetch(endpoint,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Apex Social: administrar despegues',content:utf8base64(payload),sha:meta.sha,branch:'main'})});
  if(!write.ok)return reply({error:'GitHub rechazó la publicación ('+write.status+'). Revisá permisos y rama.'},502,allowed);
  return reply({ok:true},200,allowed);
 }catch{return reply({error:'No se pudo conectar con GitHub'},502,allowed)}
 }};
