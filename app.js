/* Apex Social Web V1.28 · motor FIX16 conservador */
'use strict';
const $=id=>document.getElementById(id);
const sectors=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
const state={sites:[],weather:new Map(),favorites:new Set(JSON.parse(localStorage.getItem('apex_favs')||'[]')),view:'map',map:null,markers:[],satellite:true,token:'',editing:null,selectedDirections:[],pending:false,selectedTime:0,windLayer:null,windEnabled:true,quickSiteId:null,modelCache:new Map(),forecastDay:null,forecastMode:'table',forecastTab:'hourly'};
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const degDiff=(a,b)=>Math.abs(((a-b+540)%360)-180);
const windLabel=d=>d==null?'—':sectors[Math.round(((d%360)+360)%360/22.5)%16];
const isLanding=site=>site?.type==='landing';
const siteTypeLabel=site=>isLanding(site)?'Aterrizaje':'Despegue';
const fmt=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.display='none',4500)}
// Motor de evaluación adaptado de RC 0.19.0 iOS COMPASS FIX16.
// Se conservan los límites configurables por despegue y el contrato kind/label/reason/score.
// V1.43: semáforo de superficie; sin penalizaciones por concordancia ni variables de altura.
function assess(site,h){
 const unknown=(reason)=>({kind:'unknown',label:'SIN DATOS',reason,causes:[reason],score:0});
 if(!h)return unknown('Sin pronóstico para este horario.');
 const wind=h.windMax??h.wind,gust=h.gustMax??h.gust,rain=h.rain;
 const orientations=site.windFromDirections||[];
 const windLimit=Number(site.maxWind??30),gustLimit=Number(site.maxGust??35),tolerance=Number(site.tolerance??30);
 const bad=[],warn=[];
 if(Number.isFinite(wind)){if(wind>=windLimit)bad.push(`Viento ${fmt(wind)} km/h: límite ${fmt(windLimit)}.`);else if(wind>=windLimit-5)warn.push(`Viento ${fmt(wind)} km/h: próximo al límite.`);}
 if(Number.isFinite(gust)){if(gust>=gustLimit)bad.push(`Ráfagas ${fmt(gust)} km/h: límite ${fmt(gustLimit)}.`);else if(gust>=gustLimit-5)warn.push(`Ráfagas ${fmt(gust)} km/h: próximas al límite.`);}
 if(Number.isFinite(rain)){if(rain>=.8)bad.push(`Precipitación ${fmt(rain,1)} mm/h.`);else if(rain>=.1)warn.push(`Precipitación ${fmt(rain,1)} mm/h.`);}
 if(orientations.length&&Number.isFinite(h.dir)&&wind>0){const delta=Math.min(...orientations.map(x=>degDiff(x,h.dir)));if(delta>tolerance)bad.push(`Dirección ${windLabel(h.dir)} incompatible con el lugar.`);else if(delta>15&&delta>=tolerance-5)warn.push(`Dirección ${windLabel(h.dir)} próxima al borde admitido.`);}
 const missing=!Number.isFinite(wind)||!Number.isFinite(gust)||!Number.isFinite(rain)||!orientations.length||(!Number.isFinite(h.dir)&&wind!==0);
 const kind=bad.length?'bad':missing?'unknown':warn.length?'warn':'good';
 const causes=bad.length?[...bad,...warn]:missing?['Faltan datos de superficie u orientaciones configuradas.']:warn.length?warn:['Viento, ráfagas, dirección y precipitación dentro de los criterios configurados.'];
 return {kind,label:{bad:'NO RECOMENDADO',unknown:'SIN DATOS',warn:'ATENCIÓN',good:'FAVORABLE'}[kind],reason:causes.join(' '),causes,score:{bad:20,unknown:0,warn:65,good:100}[kind]};
}
function statusExplanation(site,h){const a=assess(site,h);return `<div class="apex-status-explanation ${a.kind}"><strong>${safe(a.label)}</strong><ul>${a.causes.map(c=>`<li>${safe(c)}</li>`).join('')}</ul></div>`}

function hourFor(site){const hours=state.weather.get(site.id)||[];const target=Date.now()+state.selectedTime*3600000;return hours.find(h=>h.ts>=target-45*60*1000)||hours[0]||null}
async function loadSites(){
 let sites=null, apiError=null, snapshotError=null;
 const apiConfigured=Boolean(window.APEX_ADMIN_API);
 if(apiConfigured){
  try{
   const endpoint=window.APEX_ADMIN_API.replace(/\/$/,'')+'/despegues';
   const r=await fetch(endpoint+'?t='+Date.now(),{cache:'no-store'});
   if(!r.ok)throw Error('HTTP '+r.status);
   const data=await r.json();
   if(!data.initialized||!Array.isArray(data.despegues))throw Error('Respuesta de D1 inválida');
   sites=data.despegues;state.siteSource='Cloudflare-D1';state.siteSnapshot=false;state.siteSyncedAt=new Date().toISOString();
  }catch(e){apiError=e;console.warn('Apex: Cloudflare no accesible, se busca copia pública',e)}
 }
 if(!sites){
  try{
   // El respaldo se publica en el mismo dominio de GitHub Pages que la web.
   const r=await fetch('lugares-publicos.json?t='+Date.now(),{cache:'no-store'});
   if(!r.ok)throw Error('HTTP '+r.status);
   const data=await r.json();
   if(!Array.isArray(data.sites)||!data.exportedAt||data.source!=='Cloudflare-D1')throw Error('Copia pública inválida');
   sites=data.sites;state.siteSource='respaldo GitHub Pages';state.siteSnapshot=true;state.siteSyncedAt=data.exportedAt;
  }catch(e){snapshotError=e;console.warn('Apex: copia pública no disponible',e)}
 }
 if(!sites&&!apiConfigured){
  try{const r=await fetch('despegues.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(!Array.isArray(data.sites))throw Error('Archivo local inválido');sites=data.sites;state.siteSource='archivo local';state.siteSnapshot=true;state.siteSyncedAt=null}catch(e){snapshotError=e}
 }
 if(!sites){
  state.siteSource='ERROR DE CONEXIÓN';updateSitesSource('Cloudflare y respaldo público no disponibles');
  toast('No se pudo cargar la lista de lugares. Intentá actualizar.');return;
 }
 const valid=sites.filter(s=>typeof s.name==='string'&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&Array.isArray(s.windFromDirections));
 if(valid.length!==sites.length)console.warn('Apex: registros inválidos',sites.length-valid.length);
 state.sites=valid;render();updateSitesSource();await loadWeather();
 if(apiError&&state.siteSnapshot)console.info('Apex: lectura desde respaldo público; la edición requiere acceso a Cloudflare');
}
function updateSitesSource(error=''){
 const el=$('sitesSource');if(!el)return;
 if(error){el.textContent='⚠ '+error;el.title=error;el.classList.add('has-error');return}
 el.classList.remove('has-error');
 const date=state.siteSyncedAt?new Date(state.siteSyncedAt):null;
 const stamp=date&&!Number.isNaN(date.getTime())?date.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'sin fecha';
 const stale=date&&(Date.now()-date.getTime())>6*3600000;
 el.textContent=(state.siteSnapshot?'◷ ':'✓ ')+state.siteSource+' · '+state.sites.length+' lugares · actualizado '+stamp+(stale?' · COPIA ANTIGUA':'');
 el.title=state.siteSnapshot?'Copia de lectura; los cambios sólo se guardan en Cloudflare. No editar sobre una copia desactualizada.':'Datos leídos directamente de Cloudflare D1';
}

function weatherFromJson(json){
 const h=json.hourly||{}, offset=json.utc_offset_seconds||0;
 const val=(key,i)=>h[key]?.[i]==null?null:Number(h[key][i]);
 return (h.time||[]).map((t,i)=>{const parts=t.split(/[-T:]/).map(Number);return {
  ts:Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4])-offset*1000,local:t,
  wind:val('wind_speed_10m',i),gust:val('wind_gusts_10m',i),dir:val('wind_direction_10m',i),
  rain:val('precipitation',i),cloud:val('cloud_cover',i),cloudLow:val('cloud_cover_low',i),
  temp:val('temperature_2m',i),feels:val('apparent_temperature',i),humidity:val('relative_humidity_2m',i),
  rainProb:val('precipitation_probability',i),cape:val('cape',i),wind850:val('wind_speed_850hPa',i),
  direction850:val('wind_direction_850hPa',i),pressure:val('surface_pressure',i),visibility:val('visibility',i)
 }}).filter(x=>Number.isFinite(x.ts));
}
// V1.23: única fuente horaria combinada para tabla, semáforo, mapa y brújula.
// No se cambia assess(): sólo cambia la calidad/origen de sus datos.
// Modelos globales disponibles con licencia de Open-Meteo. Los modelos regionales
// WRF Argentina y Zephr-HD de Windguru NO se simulan ni se etiquetan como activos.
// IFS-HRES 9 km se consulta directamente; si falta un campo se informa sin inventar.
const APEX_MODELS=[['IFS-HRES 9 km','ecmwf_ifs_hres_9km'],['ICON','icon_seamless'],['GFS','gfs_seamless'],['GDPS / GEM','gem_global']];
const APEX_REGIONAL_INFO=[{name:'WRF Argentina (Windguru)',status:'No integrado: requiere fuente autorizada'},{name:'Zephr-HD Argentina (Windguru)',status:'No integrado: requiere fuente autorizada'}];
const APEX_HOURLY='temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,precipitation_probability,cloud_cover,cloud_cover_low,cape,wind_speed_850hPa,wind_direction_850hPa,surface_pressure,visibility';
const APEX_FIELDS=['wind','gust','dir','rain','cloud','cloudLow','temp','feels','humidity','rainProb','cape','wind850','direction850','pressure','visibility'];
const APEX_ANGLES=new Set(['dir','direction850']);
state.modelHourly=new Map();state.centerCache=new Map();
function circularMean(degrees){const values=degrees.filter(Number.isFinite);if(!values.length)return null;const sx=values.reduce((a,d)=>a+Math.sin(d*Math.PI/180),0),sy=values.reduce((a,d)=>a+Math.cos(d*Math.PI/180),0);if(Math.hypot(sx,sy)<1e-7)return null;return (Math.atan2(sx,sy)*180/Math.PI+360)%360}
function mergeModels(results){
 const valid=results.filter(r=>Array.isArray(r.rows)&&r.rows.length);
 // Coincidencia por hora local, como FIX16: evita desfases por zona horaria entre proveedores.
 const byTime=new Map();for(const model of valid)for(const h of model.rows){const key=h.local;if(!byTime.has(key))byTime.set(key,[]);byTime.get(key).push(h);}
 const min=arr=>arr.length?Math.min(...arr):null,max=arr=>arr.length?Math.max(...arr):null;
 const vals=(arr,key)=>arr.map(h=>h[key]).filter(Number.isFinite);
 return [...byTime.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([local,available])=>{
  const row={ts:available[0].ts,local,models:available.length,modelNames:valid.filter(r=>r.rows.some(h=>h.local===local)).map(r=>r.name)};
  for(const field of APEX_FIELDS){const v=vals(available,field);row[field]=v.length?(APEX_ANGLES.has(field)?circularMean(v):v.reduce((a,b)=>a+b,0)/v.length):null;}
  // Agregación original: extremos para viento, ráfagas, temperatura; máximos para riesgos.
  row.windMin=min(vals(available,'wind'));row.windMax=max(vals(available,'wind'));
  row.gustMin=min(vals(available,'gust'));row.gustMax=max(vals(available,'gust'));
  row.tempMin=min(vals(available,'temp'));row.tempMax=max(vals(available,'temp'));
  row.wind=row.windMax;row.gust=row.gustMax;row.temp=row.tempMax;
  row.rain=max(vals(available,'rain'));row.cape=max(vals(available,'cape'));row.wind850=max(vals(available,'wind850'));
  const w=vals(available,'wind'),g=vals(available,'gust');let confidence=100-(APEX_MODELS.length-available.length)*18;
  if(w.length){const spread=max(w)-min(w);confidence-=spread>12?20:spread>7?10:0;}
  if(g.length){const spread=max(g)-min(g);confidence-=spread>15?20:spread>9?10:0;}
  const dirs=vals(available,'dir');row.directionSpread=Math.max(0,...dirs.flatMap(a=>dirs.map(b=>degDiff(a,b))));row.modelDirections=dirs;confidence-=row.directionSpread>60?25:row.directionSpread>30?12:0;
  row.confidence=Math.max(0,Math.min(100,Math.round(confidence)));
  return row;
 });
}
async function fetchModelForecast(lat,lon,days=5,fields=APEX_HOURLY){return Promise.all(APEX_MODELS.map(async ([name,model])=>{try{const url=new URL('https://api.open-meteo.com/v1/forecast');Object.entries({latitude:lat,longitude:lon,models:model,hourly:fields,wind_speed_unit:'kmh',timezone:'auto',forecast_days:days}).forEach(([k,v])=>url.searchParams.set(k,v));const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),22000);let response;try{response=await fetch(url,{signal:controller.signal})}finally{clearTimeout(timeout)}if(!response.ok)throw Error('HTTP '+response.status);const json=await response.json();if(json.error)throw Error(json.reason||'Modelo no disponible');const rows=weatherFromJson(json);if(!rows.length)throw Error('Sin horas disponibles');return {name,model,rows}}catch(e){return {name,model,error:e.name==='AbortError'?'Tiempo agotado':String(e.message||e)}}}))}
async function loadWeather(){const sites=[...state.sites];$('updated').textContent='Consultando modelos globales…';let done=0;const queue=[...sites];async function worker(){while(queue.length){const site=queue.shift();const results=await fetchModelForecast(site.lat,site.lon);const merged=mergeModels(results);if(merged.length){state.weather.set(site.id,merged);state.modelHourly.set(site.id,results)}else{state.weather.delete(site.id);state.modelHourly.delete(site.id)}done++;$('updated').textContent=`${done}/${sites.length} · pronósticos combinados`;renderCards();renderMarkers();if(state.focusSiteId===site.id)updateMapCompass()}}await Promise.all(Array.from({length:Math.min(2,sites.length)},worker));$('updated').textContent=`Multimodelo · ${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`;updateMapCompass();scheduleCenterWind()}
function visibleSites(forMap=false){let sites=state.sites.filter(s=>forMap||s.name.toLowerCase().includes($('search').value.toLowerCase()));if(state.view==='favorites')sites=sites.filter(s=>state.favorites.has(s.id));const f=$('filter').value;if(f==='good')sites=sites.filter(s=>assess(s,hourFor(s)).kind==='good');if(f==='bad')sites=sites.filter(s=>assess(s,hourFor(s)).kind==='bad');if(state.view==='favorites')sites.sort((a,b)=>assess(b,hourFor(b)).score-assess(a,hourFor(a)).score);return sites;}
function card(site){const h=hourFor(site),a=assess(site,h),fav=state.favorites.has(site.id);return `<article class="site-card"><div class="site-top"><div><div class="site-title">${isLanding(site)?'🟠 Aterrizaje · ':''}${safe(site.name)}</div><div class="site-coords">⌖ ${fmt(site.lat,5)}, ${fmt(site.lon,5)}</div></div><button class="star ${fav?'on':''}" data-action="favorite" data-id="${safe(site.id)}" title="Favorito">★</button></div><div class="status ${a.kind}">${safe(a.label)}</div><div class="site-stats"><div class="stat"><small>↗ Viento</small><strong>${fmt(h?.wind)} <small style="display:inline">km/h</small></strong></div><div class="stat"><small>≋ Ráfagas</small><strong>${fmt(h?.gust)} <small style="display:inline">km/h</small></strong></div><div class="stat"><small>◈ Dirección</small><strong>${windLabel(h?.dir)}</strong></div></div><div class="site-reason">${safe(a.reason)}</div><div class="site-bottom"><div class="orientation">⌁ ${siteTypeLabel(site)}: ${site.windFromDirections.length?site.windFromDirections.map(windLabel).join(' · '):'Sin configurar'}</div><div class="site-actions"><button class="text-btn" data-action="detail" data-id="${safe(site.id)}">VER MÁS ›</button>${state.token?`<button class="text-btn" data-action="edit" data-id="${safe(site.id)}">✎</button><button class="text-btn danger-btn" data-action="delete" data-id="${safe(site.id)}">✕</button>`:''}</div></div></article>`}
function renderCards(){const sites=visibleSites();$('count').textContent=sites.length;$('cards').innerHTML=sites.length?sites.map(card).join(''):'<div class="empty">No hay despegues para mostrar.</div>'}
// Ícono original de FIX16: Flutter Icons.paragliding es el glifo Material Icons 'paragliding'.
// Usamos el mismo glifo tipográfico, no un dibujo SVG aproximado.
const landingWindsock=`<svg class="apex-landing-svg" viewBox="0 0 48 56" aria-hidden="true"><path d="M15 9V47" stroke="#e7f4ff" stroke-width="3" stroke-linecap="round"/><path d="M15 12Q26 7 43 16L39 28Q26 19 15 23Z" fill="#ff7922" stroke="#fff" stroke-width="1.5"/><path d="M22 11L28 13L25 24L19 23Z M33 14L39 16L36 27L30 24Z" fill="#fff"/><circle class="apex-landing-base" cx="15" cy="47" r="5.2" fill="var(--landing-color,#13cb8e)" stroke="#f6fcff" stroke-width="1.8"/></svg>`;
const orangeParaglider='<span class="apex-takeoff-body"><span class="material-icons apex-original-paraglider" aria-hidden="true">paragliding</span></span>';
// V1.24: no vincular un popup permanente al marcador. Leaflet alterna
// automáticamente los popups vinculados al tocar un marcador y, después de
// cerrar el editor, podía dejar únicamente el tooltip con el nombre.
// Abrimos un popup nuevo explícitamente en CADA toque, sin alternancia.
function renderMarkers(){
 if(!state.map)return;
 state.hoverSiteId=null;state.markers.forEach(m=>state.map.removeLayer(m));state.markers=[];
 visibleSites(true).forEach(s=>{
  const a=assess(s,hourFor(s));
  const icon=L.divIcon({className:'',html:isLanding(s)?`<div class="apex-landing-marker ${a.kind}" title="${safe(a.label)}"><span class="apex-landing-rotor" style="--wind-to:${Number.isFinite(hourFor(s)?.dir)?(hourFor(s).dir+90)%360:0}deg">${landingWindsock}</span></div>`:`<div class="apex-paraglider ${a.kind}" title="${safe(a.label)}">${orangeParaglider}</div>`,iconSize:isLanding(s)?[48,56]:[46,46],iconAnchor:isLanding(s)?[24,48]:[23,23]});
  const marker=L.marker([s.lat,s.lon],{icon}).addTo(state.map);
  // En modo edición el tooltip táctil puede interceptar el segundo toque.
  marker.bindTooltip(s.name,{direction:'top'});
  marker.on('mouseover',()=>{if(!state.pickLocation&&window.matchMedia('(hover: hover)').matches){state.hoverSiteId=s.id;updateMapCompass();}});
  marker.on('mouseout',()=>{if(state.hoverSiteId===s.id){state.hoverSiteId=null;updateMapCompass();}});
  marker.on('click',e=>{
   if(state.pickLocation)return;
   state.hoverSiteId=null;state.focusSiteId=s.id;updateMapCompass();
   marker.closeTooltip();
   {
    const current=state.sites.find(x=>x.id===s.id);
    if(!current)return;
    const status=assess(current,hourFor(current));
    const popup=`<div class="apex-marker-menu"><strong>${safe(current.name)}</strong><small class="apex-kind">${siteTypeLabel(current)}</small><div class="apex-popup-status ${status.kind}"><strong>${safe(status.label)}</strong><span>${fmt(hourFor(current)?.wind)} km/h · ráf. ${fmt(hourFor(current)?.gust)} · ${windLabel(hourFor(current)?.dir)}</span></div><div class="apex-marker-actions"><button type="button" data-action="detail" data-id="${safe(current.id)}">Pronóstico</button><button type="button" data-action="edit" data-id="${safe(current.id)}">✎ Editar</button><button type="button" data-action="delete" data-id="${safe(current.id)}">Eliminar</button></div></div>`;
    // No bindPopup: evita el cierre automático al volver a tocar el mismo símbolo.
    L.popup({autoPan:true,autoPanPaddingTopLeft:L.point(12,12),autoPanPaddingBottomRight:L.point(12,36),keepInView:true,closeButton:true,maxWidth:310,minWidth:Math.min(230,Math.max(170,state.map.getSize().x-56)),autoClose:true,closeOnClick:true})
     .setLatLng(marker.getLatLng()).setContent(popup).openOn(state.map);
   }
  });
  state.markers.push(marker);
 });
}
function render(){renderCards();renderMarkers();updateMapCompass();renderWindLayer();$('addBtn').hidden=!state.token;}
// V1.3: capas nativas Leaflet. Sin createTile personalizado: Leaflet
// administra coordenadas, posicionamiento, zoom y carga de cada mosaico.
function initMap(){
  state.map=L.map('map',{zoomControl:false,preferCanvas:true,zoomSnap:1,
    center:[-42.89,-71.32],zoom:10});
  L.control.zoom({position:'bottomright'}).addTo(state.map);
  state.osm=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    subdomains:'abc',maxZoom:19,attribution:'© OpenStreetMap contributors',
    crossOrigin:true,updateWhenIdle:false,keepBuffer:4
  });
  state.sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:18,attribution:'Imagery © Esri',crossOrigin:true,
    updateWhenIdle:false,keepBuffer:4
  });
  state.satellite=true;state.sat.addTo(state.map);$('layerBtn').textContent='Vista: Satélite';$('layerBtn').title='Estás viendo Satélite. Clic para cambiar a Calles';
  state.map.on('moveend',()=>scheduleCenterWind());
  const resize=()=>{if(state.map)state.map.invalidateSize({pan:false,animate:false})};
  requestAnimationFrame(()=>requestAnimationFrame(resize));
  window.addEventListener('load',resize);
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)resize()});
  if(window.ResizeObserver){const observer=new ResizeObserver(resize);
    observer.observe($('mapSection'));state.mapResizeObserver=observer;}
}

function windCompass(site,h){const dir=h?.dir;const sectorsSvg=(site.windFromDirections||[]).map(d=>`<path d="M 110 110 L ${110+86*Math.sin((d-15)*Math.PI/180)} ${110-86*Math.cos((d-15)*Math.PI/180)} A 86 86 0 0 1 ${110+86*Math.sin((d+15)*Math.PI/180)} ${110-86*Math.cos((d+15)*Math.PI/180)} Z" fill="#1ecf96" opacity=".26"/>`).join('');
 const rot=Number.isFinite(dir)?dir:0;return `<div class="wind-compass"><svg viewBox="0 0 220 220" role="img" aria-label="Brújula: norte fijo arriba; viento desde ${safe(windLabel(dir))}"><circle cx="110" cy="110" r="100" fill="#06172f" stroke="#355a7a" stroke-width="2"/><circle cx="110" cy="110" r="86" fill="none" stroke="#214362" stroke-dasharray="2 7"/>${sectorsSvg}<g fill="#a6c2db" font-size="14" font-weight="800" text-anchor="middle"><text x="110" y="23" fill="#ff7840">N</text><text x="197" y="115">E</text><text x="110" y="204">S</text><text x="23" y="115">O</text></g>${Number.isFinite(dir)?`<g transform="rotate(${rot} 110 110)"><path d="M110 29L98 68H106V151H114V68H122Z" fill="#ff7b31"/><path d="M110 191l-12-33h8v-34h8v34h8Z" fill="#4bb8ff"/><circle cx="110" cy="110" r="8" fill="#e7f4ff"/></g>`:''}<circle cx="110" cy="110" r="3" fill="#06172f"/></svg><div class="compass-caption"><strong>${Number.isFinite(dir)?`${windLabel(dir)} · ${fmt(dir)}°`:'Sin datos'}</strong><span>Viento DESDE el sector naranja</span><span>HACIA el sector azul</span><small>Verde: orientación admitida del despegue</small></div></div>`}
function forecastMatrix(site,hours){const rows=[
 ['ESTADO',h=>`<span class="status ${assess(site,h).kind}" title="${safe(assess(site,h).reason)}">${safe(assess(site,h).label)}</span>`],
 ['TEMPERATURA',h=>`${fmt(h.tempMin??h.temp,1)}–${fmt(h.tempMax??h.temp,1)} °C`],['SENSACIÓN',h=>`${fmt(h.feels,1)} °C`],
 ['VIENTO 10 m',h=>`${fmt(h.windMin??h.wind)}–${fmt(h.windMax??h.wind)} km/h`],['RÁFAGA',h=>`${fmt(h.gustMin??h.gust)}–${fmt(h.gustMax??h.gust)} km/h`],
 ['DIRECCIÓN',h=>`${windLabel(h.dir)} · ${fmt(h.dir)}°`],
 ['LLUVIA',h=>`${fmt(h.rain,1)} mm`],['PROB. LLUVIA',h=>`${fmt(h.rainProb)} %`],
 ['NUBOSIDAD',h=>`${fmt(h.cloud)} %`],['NUBE BAJA',h=>`${fmt(h.cloudLow)} %`],
 ['VIENTO ~1500 m',h=>`${fmt(h.wind850)} km/h`],['DIR. ~1500 m',h=>`${windLabel(h.direction850)} · ${fmt(h.direction850)}°`],
 ['CAPE',h=>`${fmt(h.cape)} J/kg`],['HUMEDAD',h=>`${fmt(h.humidity)} %`],
 ['PRESIÓN',h=>`${fmt(h.pressure)} hPa`],['VISIBILIDAD',h=>h.visibility==null?'—':`${fmt(h.visibility/1000,1)} km`]
 ];return `<div class="forecast-data"><div class="matrix-scroll" role="region" tabindex="0" aria-label="Tabla horaria completa; deslizá horizontalmente para consultar las 24 horas"><table class="apex-matrix"><thead><tr><th>VARIABLE / HORA</th>${hours.map(h=>`<th>${safe(h.local.slice(11,16))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><th>${label}</th>${hours.map(h=>`<td>${fn(h)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`}
function applyForecastTab(){const dialog=$('detailDialog');dialog.dataset.forecastTab=state.forecastTab;dialog.querySelectorAll('[data-forecast-tab]').forEach(b=>{const active=b.dataset.forecastTab===state.forecastTab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active))});}

function showDetail(id,day){if($('quickDialog')?.open)$('quickDialog').close();const s=state.sites.find(x=>x.id===id);if(!s)return;const all=state.weather.get(id)||[],h=hourFor(s);const days=[...new Set(all.map(x=>x.local.slice(0,10)))].slice(0,5);const chosen=days.includes(day)?day:days[0];const hs=all.filter(x=>x.local.startsWith(chosen||'')).slice(0,24);const current=hs.find(x=>x.ts>=Date.now()-3600000)||hs[0]||h;const a=assess(s,current);
 $('detailContent').innerHTML=`<div class="eyebrow">APEX SOCIAL · METEOROLOGÍA DE VUELO</div><h2>${safe(s.name)}</h2><div class="detail-meta"><span>⌖ ${fmt(s.lat,5)}, ${fmt(s.lon,5)}</span><span>${siteTypeLabel(s)}: ${s.windFromDirections.map(windLabel).join(' · ')||'Sin configurar'}</span><span>Horizonte: 5 días</span></div><div class="day-selector">${days.map((d,i)=>`<button class="day-button ${d===chosen?'selected':''}" data-day="${safe(d)}" data-site="${safe(id)}">${i===0?'HOY · ':''}${safe(d.slice(8,10)+'/'+d.slice(5,7))}</button>`).join('')}</div>${statusExplanation(s,current)}<div class="forecast-tabs" role="tablist" aria-label="Secciones del pronóstico"><button type="button" role="tab" data-forecast-tab="hourly" class="forecast-tab">Pronóstico horario</button><button type="button" role="tab" data-forecast-tab="evolution" class="forecast-tab">Evolución del viento</button><button type="button" role="tab" data-forecast-tab="summary" class="forecast-tab">Condiciones actuales</button><button type="button" role="tab" data-forecast-tab="advanced" class="forecast-tab">Perfil y riesgos</button></div><div class="forecast-tab-panel forecast-advanced"><div id="advancedProfile"></div></div><div class="forecast-tab-panel forecast-summary"><div class="forecast-overview"><div class="forecast-intro"><div class="status ${a.kind}">${safe(a.label)}</div><p>${safe(a.reason)}</p><div class="overview-metrics"><div><small>VIENTO</small><strong>${fmt(current?.wind)} <small>km/h</small></strong></div><div><small>RÁFAGA</small><strong>${fmt(current?.gust)} <small>km/h</small></strong></div><div><small>TEMPERATURA</small><strong>${fmt(current?.temp,1)} °C</strong></div><div><small>NUBE BAJA</small><strong>${fmt(current?.cloudLow)} %</strong></div></div><p class="source-note">Motor FIX16: máximos entre IFS-HRES 9 km, ICON, GFS y GDPS/GEM para viento, ráfagas, lluvia, CAPE y viento a 850 hPa; rangos mínimos y máximos. Semáforo limitado a variables de superficie. No es una medición ni autorización de vuelo.</p></div></div></div><div class="forecast-tab-panel forecast-hourly"><div class="matrix-header"><strong>PRONÓSTICO HORARIO · 24 HORAS</strong><span>Deslizá horizontalmente para ver todas las horas</span></div>${hs.length?forecastMatrix(s,hs):'<div class="empty">Sin datos meteorológicos para este día.</div>'}</div><div class="forecast-tab-panel forecast-evolution">${hs.length?forecastInsights(s,hs):'<div class="empty">Sin datos meteorológicos para este día.</div>'}</div><p class="source-note">La brújula de viento y orientaciones está sobre el mapa. Las condiciones reales deben verificarse en el despegue.</p>`;
 state.forecastDay=chosen;applyForecastTab();if(state.forecastTab==='advanced')advancedProfile(id,chosen);if(state.forecastTab==='evolution'&&chosen)loadModelComparison(id,chosen); if(!$('detailDialog').open)$('detailDialog').showModal();const matrix=$('detailDialog').querySelector('.matrix-scroll');if(matrix)matrix.scrollLeft=0;state.hoverSiteId=null;state.focusSiteId=s.id;updateMapCompass();}
const API_URL=(window.APEX_ADMIN_API||'').replace(/\/$/,'');
let pendingAdminAction=null;
function requestAdmin(action,id=null){pendingAdminAction={action,id};$('quickDialog')?.open&&$('quickDialog').close();state.map?.closePopup();openAdmin()}
function openAdmin(){ $('adminPassword').value='';$('adminMessage').textContent=API_URL?'':'Falta configurar la dirección del servidor de administración en config.js.';$('adminDialog').showModal() }
async function api(path,method='GET',body){if(!API_URL)throw Error('Configurá APEX_ADMIN_API en config.js');const response=await fetch(API_URL+path,{method,headers:{'Content-Type':'application/json','X-Apex-Password':state.token},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Error HTTP '+response.status);return data}
async function adminLogin(){const password=$('adminPassword').value; if(!password){$('adminMessage').textContent='Ingresá la contraseña.';return}state.token=password;$('loginBtn').disabled=true;try{await api('/auth');$('adminDialog').close();$('adminPassword').value='';const pending=pendingAdminAction;pendingAdminAction=null;render();if(pending?.action==='edit')openEdit(pending.id);else if(pending?.action==='delete')deleteSite(pending.id);else openEdit(null)}catch(e){state.token='';$('adminMessage').textContent=e.message}finally{$('loginBtn').disabled=false}}
async function publishSites(next){if(state.siteSnapshot){toast('Edición deshabilitada desde copia pública. Conectate a Cloudflare y actualizá antes de guardar.');return false}if(state.pending)return false;state.pending=true;try{await api('/sites','PUT',{sites:next});state.sites=next;render();updateSitesSource();toast('Guardado en Cloudflare D1. Los cambios ya están disponibles.');return true}catch(e){toast('Error al guardar: '+e.message);return false}finally{state.pending=false}}
function setDraftLocation(lat,lon){$('siteLat').value=Number(lat).toFixed(6);$('siteLon').value=Number(lon).toFixed(6);updateDraftMarker()}
function updateDraftMarker(){if(!state.map)return;const lat=Number($('siteLat').value),lon=Number($('siteLon').value);if(!$('siteLat').value||!$('siteLon').value||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;const icon=L.divIcon({className:'',html:'<div class="apex-windsock" title="Arrastrá para ajustar"><span class="windsock-pole"></span><span class="windsock-fabric"></span><span class="windsock-target"></span></div>',iconSize:[44,56],iconAnchor:[22,52]});if(!state.draftMarker){state.draftMarker=L.marker([lat,lon],{icon,draggable:true,zIndexOffset:2000}).addTo(state.map);state.draftMarker.on('dragend',()=>{const c=state.draftMarker.getLatLng();setDraftLocation(c.lat,c.lng)})}else state.draftMarker.setLatLng([lat,lon]);}
function clearDraft(){if(state.draftMarker){state.map.removeLayer(state.draftMarker);state.draftMarker=null}state.pickLocation=false;document.body.classList.remove('picking-location');$('pickBanner').hidden=true}

function renderManage(){const q=$('manageSearch').value.trim().toLocaleLowerCase('es');const sites=state.sites.filter(s=>s.name.toLocaleLowerCase('es').includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'es'));$('manageList').innerHTML=sites.length?sites.map(s=>`<div class="manage-site"><div class="manage-site-name"><strong>${safe(s.name)} · ${siteTypeLabel(s)}</strong><small>${fmt(s.lat,5)}, ${fmt(s.lon,5)} · ${s.windFromDirections?.map(windLabel).join(' / ')||'Sin orientación'}</small></div><div class="manage-site-actions"><button class="ghost" data-manage="edit" data-id="${safe(s.id)}">✎ Editar</button><button class="ghost danger-btn" data-manage="delete" data-id="${safe(s.id)}">Eliminar</button></div></div>`).join(''):'<div class="empty">No hay despegues que coincidan.</div>'}
function openManage(){if(!state.token){openAdmin();return}$('manageSearch').value='';renderManage();$('manageDialog').showModal()}
function openEdit(id){if($('quickDialog')?.open)$('quickDialog').close();state.map?.closePopup();if(!state.token){requestAdmin('edit',id);return}const s=state.sites.find(x=>x.id===id);state.editing=s?.id||null;state.selectedDirections=[...(s?.windFromDirections||[])];$('siteType').value=isLanding(s)?'landing':'takeoff';$('editTitle').textContent=s?'Editar '+siteTypeLabel(s).toLowerCase():'Nuevo lugar';$('siteName').value=s?.name||'';$('siteLat').value=s?.lat??'';$('siteLon').value=s?.lon??'';$('siteMaxGust').value=s?.maxGust??35;$('siteMaxWind').value=s?.maxWind??30;$('siteTolerance').value=s?.tolerance??30;$('siteNotes').value=s?.notes||'';updateSiteTypeLabels();renderSectors();updateEditorPreview();if(s)updateDraftMarker();$('editDialog').showModal()}
function updateSiteTypeLabels(){const landing=$('siteType').value==='landing';$('siteNameLabel').firstChild.textContent=landing?'Nombre del aterrizaje':'Nombre del despegue';$('pickMapBtn').textContent=landing?'📍 Señalar aterrizaje en mapa':'📍 Señalar despegue en mapa';$('siteName').placeholder=landing?'Ej. Tambo Aterri':'Ej. Cerro 21';$('landingPresets').hidden=!landing;$('siteTypeHelp').textContent=landing?'Seleccioná las direcciones de viento admitidas para aproximación y aterrizaje. El semáforo aplica los mismos límites configurables.':'Seleccioná las direcciones de viento admitidas para el despegue.';}
function downloadSitesBackup(){if(!state.sites.length){toast('No hay lugares cargados para respaldar.');return}const data={format:'apex-social-sites-backup',version:1,source:state.siteSource||'desconocida',exportedAt:new Date().toISOString(),count:state.sites.length,sites:state.sites};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='apex-social-'+(state.siteSource==='Cloudflare-D1'?'D1-actual':'archivo-local')+'-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Respaldo '+(state.siteSource||'')+': '+state.sites.length+' lugares. Guardá el JSON fuera de GitHub.');}
function renderSectors(){$('sectors').innerHTML=sectors.map((s,i)=>`<button type="button" class="sector ${state.selectedDirections.includes(i*22.5)?'selected':''}" data-deg="${i*22.5}">${s}</button>`).join('')}
async function saveEdit(ev){ev.preventDefault();if(!state.token)return;const name=$('siteName').value.trim(),lat=Number($('siteLat').value),lon=Number($('siteLon').value);if(!name||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!state.selectedDirections.length){toast('Completá nombre, coordenadas y orientaciones.');return}const id=state.editing||('site_'+Date.now().toString(36));const old=state.sites.find(x=>x.id===id)||{};const item={...old,id,name,lat,lon,type:$('siteType').value==='landing'?'landing':'takeoff',windFromDirections:[...state.selectedDirections].sort((a,b)=>a-b),maxGust:Number($('siteMaxGust').value),maxWind:Number($('siteMaxWind').value),tolerance:Number($('siteTolerance').value),notes:$('siteNotes').value.trim()};const next=state.editing?state.sites.map(s=>s.id===id?item:s):[...state.sites,item];const btn=$('editForm').querySelector('[type=submit]');btn.disabled=true;const ok=await publishSites(next);btn.disabled=false;if(ok){$('editDialog').close();clearDraft();loadWeather();renderManage()}}
async function deleteSite(id){if($('quickDialog')?.open)$('quickDialog').close();state.map?.closePopup();if(!state.token){requestAdmin('delete',id);return}const s=state.sites.find(x=>x.id===id);if(!s||!confirm(`¿Eliminar «${s.name}»? El mapa permanecerá en su lugar.\nEsta acción se guardará en Cloudflare D1.`))return;const next=state.sites.filter(x=>x.id!==id);if(await publishSites(next)){state.weather.delete(id);renderManage()}}
function startPick(){
 state.pickLocation=true;
 // Antes de cerrar el formulario, ubicar la manga en las coordenadas ingresadas
 // o en el centro actual del mapa para que sea visible desde el primer momento.
 const lat=Number($('siteLat').value),lon=Number($('siteLon').value);
 const valid=$('siteLat').value.trim()!==''&&$('siteLon').value.trim()!==''&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
 const point=valid?L.latLng(lat,lon):state.map.getCenter();
 setDraftLocation(point.lat,point.lng);
 $('editDialog').close();$('pickBanner').hidden=false;document.body.classList.add('picking-location');
 if(valid&&!state.map.getBounds().contains(point))state.map.panTo(point,{animate:true});
 requestAnimationFrame(()=>{state.map.invalidateSize({pan:false});updateDraftMarker()});
 toast('Arrastrá la manga o tocá el mapa para señalar el despegue.');
}
function finishPick(){state.pickLocation=false;document.body.classList.remove('picking-location');$('pickBanner').hidden=true;$('editDialog').showModal()}

// FIX16: brújula GEOGRÁFICA en el mapa; independiente del pronóstico modal.
// Leaflet no rota el mapa en esta versión web, por lo que el norte siempre queda arriba.
state.focusSiteId=null;
state.hoverSiteId=null;
state.centerWind=null;
state.centerWindTimer=null;
function centerForecastSite(){
  const hover=state.sites.find(s=>s.id===state.hoverSiteId);
  if(hover)return hover;
  const focus=state.sites.find(s=>s.id===state.focusSiteId);
  if(focus)return focus;
  if(!state.map)return null;
  const c=state.map.getCenter();
  return [...state.sites].sort((a,b)=>(a.lat-c.lat)**2+(a.lon-c.lng)**2-( (b.lat-c.lat)**2+(b.lon-c.lng)**2 ))[0]||null;
}
function mapCompassSvg(site,h,dir){
 const valid=site?.windFromDirections||[];
 const arc=(deg,r,width,color,opacity)=>{const a=(deg-width/2)*Math.PI/180,b=(deg+width/2)*Math.PI/180;const p=x=>`${(70+r*Math.sin(x)).toFixed(2)} ${(70-r*Math.cos(x)).toFixed(2)}`;return `<path d="M ${p(a)} A ${r} ${r} 0 0 1 ${p(b)}" fill="none" stroke="${color}" stroke-width="${opacity===.9?5:10}" stroke-linecap="round" opacity="${opacity}"/>`};
 const bands=valid.map(d=>arc(d,58,60,'#36e398',.23)+arc(d,58,30,'#36e398',.9)).join('');
 const labels=sectors.map((label,i)=>{const a=i*22.5*Math.PI/180;const r=i%4===0?43:49;return `<text x="${70+r*Math.sin(a)}" y="${74-r*Math.cos(a)}" fill="${i===0?'#ff792d':'#d6e8fa'}" font-size="${i%4===0?10:6.8}" font-weight="800" text-anchor="middle">${label}</text>`}).join('');
 return `<svg viewBox="0 0 140 140" role="img" aria-label="Brújula geográfica con norte fijo"><circle cx="70" cy="70" r="67" fill="#07182f" stroke="#31516c" stroke-width="2"/>${bands}${labels}${Number.isFinite(dir)?`<g transform="rotate(${dir} 70 70)"><path d="M70 8L63 31L70 26L77 31Z" fill="#ff7b27"/><path d="M70 132L63 109L70 114L77 109Z" fill="#57c3ff"/><path d="M70 30V110" stroke="#ff8935" stroke-width="2"/></g>`:''}<circle cx="70" cy="70" r="10" fill="#102c4c" stroke="#3b6686"/><text x="70" y="73" text-anchor="middle" fill="#fff" font-size="8" font-weight="900">${Number.isFinite(dir)?windLabel(dir):'N↑'}</text></svg>`;
}
function updateMapCompass(){
 const box=$('mapCompass');if(!box)return;
 const site=centerForecastSite(),h=site?hourFor(site):null,w=site?h:state.centerWind;
 const dir=w?.dir;
 box.innerHTML=`${mapCompassSvg(site,h,dir)}<div class="map-compass-caption"><strong>${site?safe(site.name):'VIENTO MAPA'}</strong><span>${Number.isFinite(dir)?`${windLabel(dir)} ${Math.round(dir)}° → ${windLabel((dir+180)%360)}`:'Dirección —'}</span><span>${Number.isFinite(w?.wind)?Math.round(w.wind):fmt(h?.wind)} km/h · ráf. ${Number.isFinite(w?.gust)?Math.round(w.gust):fmt(h?.gust)} km/h</span><small>${site?site.windFromDirections.map(windLabel).join(' · '):'Seleccioná un despegue'}</small></div>`;
}
function scheduleCenterWind(){
 clearTimeout(state.centerWindTimer);
 state.centerWindTimer=setTimeout(async()=>{
  if(!state.map)return;
  const c=state.map.getCenter(),key=`${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
  const request=state.centerWindRequest=(state.centerWindRequest||0)+1;
  let cache=state.centerCache.get(key);
  if(!cache||Date.now()-cache.at>20*60*1000){
   const results=await fetchModelForecast(c.lat,c.lng,3,'wind_speed_10m,wind_gusts_10m,wind_direction_10m');
   const rows=mergeModels(results);cache={at:Date.now(),rows};if(rows.length){state.centerCache.set(key,cache);if(state.centerCache.size>20)state.centerCache.delete(state.centerCache.keys().next().value)}
  }
  if(request!==state.centerWindRequest)return;
  const target=Date.now()+state.selectedTime*3600000;
  const h=cache?.rows.find(h=>h.ts>=target-45*60*1000)||cache?.rows[0];
  state.centerWind=h?{wind:h.wind,gust:h.gust,dir:h.dir,models:h.models}:null;
  renderWindLayer();updateMapCompass();
 },650);
}

// V1.17 · La hora es individual de cada navegador: no se sincroniza con otros visitantes.
function updateTimeLabel(){const d=new Date(Date.now()+state.selectedTime*3600000);$('timeLabel').textContent=state.selectedTime===0?'Ahora':d.toLocaleString('es-AR',{weekday:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function showQuickSite(id){const s=state.sites.find(x=>x.id===id);if(!s)return;const h=hourFor(s),a=assess(s,h),next=(state.weather.get(id)||[]).filter(x=>x.ts>=Date.now());const windowHours=next.filter(x=>assess(s,x).kind==='good').slice(0,3);$('quickContent').innerHTML=`<div class="eyebrow">${siteTypeLabel(s).toUpperCase()} · CONSULTA RÁPIDA</div><h2>${safe(s.name)}</h2><div class="apex-kind">${siteTypeLabel(s)}</div><div class="status ${a.kind}">${safe(a.label)}</div><p>${safe(a.reason)}</p><div class="quick-metrics"><div><small>VIENTO</small><b>${fmt(h?.wind)} km/h</b></div><div><small>RÁFAGA</small><b>${fmt(h?.gust)} km/h</b></div><div><small>DIRECCIÓN</small><b>${windLabel(h?.dir)} ${fmt(h?.dir)}°</b></div></div><p class="source-note">Próximas horas favorables según el pronóstico combinado: ${windowHours.length?windowHours.map(x=>safe(x.local.slice(5,16).replace('T',' '))).join(' · '):'No identificadas'}</p><div class="dialog-actions"><button class="orange-btn" data-action="detail" data-id="${safe(id)}">Ver pronóstico completo</button><button class="ghost" data-action="favorite" data-id="${safe(id)}">★ Favorito</button><button class="ghost" data-action="edit" data-id="${safe(id)}">✎ Modificar</button>${state.token?`<button class="ghost danger-btn" data-action="delete" data-id="${safe(id)}">Eliminar</button>`:''}</div>`;state.quickSiteId=id;$('quickDialog').showModal();}
function forecastInsights(s,hs){
 const good=hs.filter(h=>assess(s,h).kind==='good'), intervals=[];let first=null,last=null;
 for(const h of hs){if(assess(s,h).kind==='good'){if(!first)first=h;last=h}else if(first){intervals.push([first,last]);first=null;last=null}}if(first)intervals.push([first,last]);
 const windows=intervals.map(([a,b])=>a.local.slice(11,16)+'–'+String(Math.min(24,Number(b.local.slice(11,13))+1)).padStart(2,'0')+':00');
 const valid=hs.filter(h=>Number.isFinite(h.wind)&&Number.isFinite(h.gust));
 const limit=Number(s.maxGust??35), top=Math.max(20,Math.ceil(Math.max(limit,...valid.map(h=>Math.max(h.wind,h.gust)))/10)*10);
 const W=780,H=238,left=45,right=16,upper=15,bottom=35,plotW=W-left-right,plotH=H-upper-bottom;
 const x=i=>left+(i/Math.max(1,valid.length-1))*plotW;
 const y=n=>upper+(1-n/top)*plotH;
 const line=key=>valid.map((h,i)=>`${x(i).toFixed(1)},${y(h[key]).toFixed(1)}`).join(' ');
 const grid=[0,.25,.5,.75,1].map(f=>{const v=top*f, yy=y(v);return `<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}" stroke="#355777" stroke-width="1" opacity=".7"/><text x="${left-9}" y="${yy+4}" fill="#b8d0e5" font-size="12" text-anchor="end">${Math.round(v)}</text>`}).join('');
 const ticks=valid.map((h,i)=>i%3===0||i===valid.length-1?`<line x1="${x(i)}" x2="${x(i)}" y1="${upper}" y2="${H-bottom}" stroke="#2c4c69" opacity=".35"/><text x="${x(i)}" y="${H-12}" fill="#c6d8e9" font-size="12" text-anchor="middle">${safe(h.local.slice(11,16))}</text>`:'').join('');
 const maxWind=Math.max(0,...valid.map(h=>h.wind)),maxGust=Math.max(0,...valid.map(h=>h.gust));
 const chart=`<div class="wind-graph enhanced-graph"><div class="wind-chart-title"><strong>VIENTO Y RÁFAGAS · ${safe(hs[0]?.local.slice(8,10)+'/'+hs[0]?.local.slice(5,7))}</strong><span>km/h · horas locales</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico horario de viento y ráfagas en kilómetros por hora, con eje horario y límite de ráfagas">${grid}${ticks}<line x1="${left}" x2="${W-right}" y1="${y(limit)}" y2="${y(limit)}" stroke="#ff6878" stroke-width="2" stroke-dasharray="7 6"/><polyline points="${line('gust')}" fill="none" stroke="#ff9b42" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${line('wind')}" fill="none" stroke="#4dcaff" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/></svg><div class="graph-legend"><span>🔵 Viento 10 m</span><span>🟠 Ráfagas</span><span class="limit-legend">- - Límite ${fmt(limit)} km/h</span></div></div>`;
 return `<section class="forecast-insights"><div class="insight-top"><div><strong>EVOLUCIÓN DEL VIENTO</strong><p>${windows.length?'Ventanas favorables: '+safe(windows.join(' · ')):'No se detectaron ventanas favorables'}</p><small>${good.length}/${hs.length} horas favorables según los criterios del despegue. No equivale a autorización de vuelo.</small></div></div><div class="wind-summary-cards"><div><small>VIENTO MÁXIMO</small><strong>${fmt(maxWind)} km/h</strong></div><div><small>RÁFAGA MÁXIMA</small><strong>${fmt(maxGust)} km/h</strong></div><div><small>LÍMITE CONFIGURADO</small><strong>${fmt(limit)} km/h</strong></div></div>${chart}</section>`;
}
// Open-Meteo permite solicitar modelos por separado. No se inventa consenso ni confianza.
async function loadModelComparison(id,day,force=false){
 const site=state.sites.find(x=>x.id===id),el=$('modelComparison');if(!site||!el||!day)return;
 const key=id+'|'+day;el.dataset.requestKey=key;el.innerHTML='<div class="model-loading">Cargando los modelos que forman la tabla…</div>';
 let results=state.modelHourly.get(id);
 if(force||!results){results=await fetchModelForecast(site.lat,site.lon);state.modelHourly.set(id,results);const merged=mergeModels(results);if(merged.length){state.weather.set(id,merged);renderCards();renderMarkers()}}
 if(!el.isConnected||el.dataset.requestKey!==key)return;
 const daily=results.map(r=>r.rows?{name:r.name,rows:r.rows.filter(h=>h.local.startsWith(day))}:{name:r.name,error:r.error});
 const ok=daily.filter(r=>r.rows?.length);const combined=(state.weather.get(id)||[]).filter(h=>h.local.startsWith(day));
 const summary=ok.length?`${ok.length}/${APEX_MODELS.length} modelos globales disponibles para este día. La tabla y el semáforo usan máximos de viento, ráfagas, lluvia, CAPE y viento a 850 hPa; mínimos y máximos visibles en la tabla. Otras variables usan promedio circular o aritmético según corresponda.`:'No hay modelos disponibles para este día.';
 const max=(arr,key)=>arr.length?Math.max(...arr.map(h=>Number.isFinite(h[key])?h[key]:0)):null;
 const rows=daily.map(r=>r.rows?.length?`<tr><th>${safe(r.name)}</th><td>${fmt(max(r.rows,'wind'))} km/h</td><td>${fmt(max(r.rows,'gust'))} km/h</td><td>${r.rows.filter(h=>assess(site,h).kind==='good').length} h</td></tr>`:`<tr><th>${safe(r.name)}</th><td colspan="3">${safe(r.error||'Sin datos para este día')}</td></tr>`).join('');
 const combinedRow=combined.length?`<tr><th>Combinado · tabla</th><td>${fmt(max(combined,'wind'))} km/h</td><td>${fmt(max(combined,'gust'))} km/h</td><td>${combined.filter(h=>assess(site,h).kind==='good').length} h</td></tr>`:'';
 const times=combined.filter((_,i)=>i%3===0);const gustRows=[...daily.filter(r=>r.rows?.length),{name:'Combinado · tabla',rows:combined}].map(r=>`<tr><th>${safe(r.name)}</th>${times.map(h=>`<td>${fmt(r.rows.find(z=>z.ts===h.ts)?.gust)}</td>`).join('')}</tr>`).join('');
 el.innerHTML=`<p class="model-summary">${safe(summary)} El acuerdo entre modelos no es una probabilidad de seguridad.</p><div class="model-table-wrap"><table><thead><tr><th>Modelo</th><th>Viento máx.</th><th>Ráfaga máx.</th><th>Horas favorables</th></tr></thead><tbody>${combinedRow}${rows}<tr><th>WRF Argentina · Windguru</th><td colspan="3">No integrado · fuente autorizada pendiente</td></tr><tr><th>Zephr-HD Argentina · Windguru</th><td colspan="3">No integrado · fuente autorizada pendiente</td></tr></tbody></table></div>${times.length?`<h4>Ráfagas por hora · km/h</h4><div class="model-table-wrap"><table><thead><tr><th>Modelo</th>${times.map(h=>`<th>${safe(h.local.slice(11,16))}</th>`).join('')}</tr></thead><tbody>${gustRows}</tbody></table></div>`:''}<small>Fuente: Open-Meteo, modelos IFS-HRES 9 km, ICON, GFS y GDPS/GEM. La combinación utiliza máximos para variables críticas; las demás variables se agregan según el método FIX16. WRF Argentina y Zephr-HD de Windguru no están integrados: sus datos requieren una fuente y permisos independientes. Verificá las condiciones reales en el lugar.</small>`;
}
function updateEditorPreview(){const el=$('editorPreview');if(!el)return;const dirs=state.selectedDirections.map(windLabel).join(' · ')||'Sin orientación';el.innerHTML=`<strong>Vista previa del ${$('siteType').value==='landing'?'aterrizaje':'despegue'}</strong><span>${safe($('siteName').value.trim()||'Nuevo despegue')}</span><small>Orientaciones: ${safe(dirs)} · viento máx. ${safe($('siteMaxWind').value)} km/h · ráfagas máx. ${safe($('siteMaxGust').value)} km/h</small>`}
// Flujo animado original Apex Social: partículas de viento a 10 m, dirección uniforme.
// Es una visualización orientativa del pronóstico en el centro del mapa, NO un campo espacial.
const ApexWindFlow=L.Layer.extend({
 onAdd(map){this._map=map;this._canvas=L.DomUtil.create('canvas','apex-wind-flow');this._canvas.setAttribute('aria-hidden','true');this._canvas.style.pointerEvents='none';map.getPanes().overlayPane.appendChild(this._canvas);this._ctx=this._canvas.getContext('2d',{alpha:true});this._seed=0;this._particles=[];this._last=0;this._onResize=()=>this._resize();map.on('moveend zoomend resize',this._onResize);this._resize();this._tick=this._tick.bind(this);this._raf=requestAnimationFrame(this._tick)},
 onRemove(map){cancelAnimationFrame(this._raf);map.off('moveend zoomend resize',this._onResize);this._canvas.remove();this._ctx=null},
 setWind(deg,speed){if(this._dir===deg&&this._speed===speed)return;this._dir=deg;this._speed=speed;this._last=0},
 _resize(){if(!this._map||!this._canvas)return;const size=this._map.getSize(),pos=this._map.containerPointToLayerPoint([0,0]);L.DomUtil.setPosition(this._canvas,pos);const dpr=Math.min(window.devicePixelRatio||1,2);this._w=size.x;this._h=size.y;this._canvas.width=Math.round(size.x*dpr);this._canvas.height=Math.round(size.y*dpr);this._canvas.style.width=size.x+'px';this._canvas.style.height=size.y+'px';this._ctx.setTransform(dpr,0,0,dpr,0,0);this._particles=[]},
 _tick(now){this._raf=requestAnimationFrame(this._tick);if(!this._ctx||document.hidden||!this._w||!this._h)return;if(now-this._last<33)return;const dt=Math.min((now-this._last||33)/33,2);this._last=now;const ctx=this._ctx,w=this._w,h=this._h;ctx.clearRect(0,0,w,h);if(!state.spatialField)return;const count=Math.min(145,Math.max(30,Math.floor(w*h/5200)));while(this._particles.length<count)this._particles.push({x:Math.random()*w,y:Math.random()*h,life:Math.random()*130,age:Math.random()*90,len:15+Math.random()*23,speed:.65+Math.random()*.75});ctx.lineWidth=2.15;ctx.lineCap='round';for(const p of this._particles){const v=spatialVector(p.x/w,p.y/h);if(!v)continue;const speed=Math.hypot(v.u,v.v);if(speed<.2)continue;const vx=v.u/speed,vy=-v.v/speed;const pace=Math.min(2.8,Math.max(.15,speed/18));const color=speed>=35?'255,95,105':speed>=25?'255,180,65':'132,224,255';const travel=pace*p.speed*dt*1.5;p.x+=vx*travel;p.y+=vy*travel;p.age+=dt;p.life-=dt;const opacity=Math.min(1,p.age/20,p.life/25);if(p.x< -40||p.x>w+40||p.y< -40||p.y>h+40||p.life<=0){p.x=Math.random()*w;p.y=Math.random()*h;p.life=55+Math.random()*105;p.age=0;continue}const g=ctx.createLinearGradient(p.x-vx*p.len,p.y-vy*p.len,p.x,p.y);g.addColorStop(0,'rgba(92,205,245,0)');g.addColorStop(1,`rgba(${color},${(.85*opacity).toFixed(3)})`);ctx.strokeStyle=g;ctx.beginPath();ctx.moveTo(p.x-vx*p.len,p.y-vy*p.len);ctx.lineTo(p.x,p.y);ctx.stroke()}}
});
function renderWindLayer(){if(!state.map)return;if(!state.windEnabled){if(state.windLayer){state.map.removeLayer(state.windLayer);state.windLayer=null}return}if(!state.windLayer){state.windLayer=new ApexWindFlow();state.windLayer.addTo(state.map)}}
// V1.31: búsqueda mundial desacoplada de los filtros de despegues.
// Photon para sugerencias, Open-Meteo para ciudades y Nominatim sólo por acción
// explícita (política de uso de Nominatim). Sin Overpass masivo ni áreas fijas.
let placeRequest=0,placeTimer=null,placeAbort=null,placeItems=[];
const placeCache=new Map();
const placeNorm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
function placeHide(){const el=$('placeResults');el.hidden=true;$('search').setAttribute('aria-expanded','false')}
function placeCategory(p){const t=String(p.osm_value||p.type||'').toLowerCase();if(['dam','weir'].includes(t))return ['Represa','🏞️'];if(t.includes('national_park')||t.includes('protected_area')||t.includes('nature_reserve'))return ['Parque / reserva','🌲'];if(['lake','reservoir','water','river','stream'].includes(t))return ['Lago / embalse / río','🌊'];if(['peak','mountain','volcano','ridge'].includes(t))return ['Cerro / montaña','⛰️'];if(['city','town','village','hamlet','municipality'].includes(t))return ['Ciudad / localidad','📍'];if(['aerodrome','airport'].includes(t))return ['Aeropuerto','✈️'];if(['street','residential','road','house'].includes(t))return ['Dirección','🛣️'];return ['Lugar','📌']}
function placeName(p){return [p.name,p.city&&p.city!==p.name?p.city:null,p.state,p.country].filter(Boolean).join(', ')}
function placeLocal(q){const needle=placeNorm(q);return needle?state.sites.filter(s=>placeNorm(s.name).includes(needle)).slice(0,7):[]}
function placeDraw(q,places=[],status=''){const box=$('placeResults');if(!q.trim()){placeHide();return}placeItems=places;const siteHtml=placeLocal(q).map(s=>`<button type="button" class="place-option" data-place-site="${safe(s.id)}"><span>${isLanding(s)?'🚩':'🪂'}</span><span><strong>${safe(s.name)}</strong><small>${siteTypeLabel(s)} registrado · Ir al mapa</small></span></button>`).join('');const placeHtml=places.map((p,i)=>{const [kind,emoji]=placeCategory(p);return `<button type="button" class="place-option" data-place-index="${i}"><span>${emoji}</span><span><strong>${safe(p.name||'Lugar sin nombre')}</strong><small>${safe(kind)} · ${safe([p.city&&p.city!==p.name?p.city:null,p.state,p.country].filter(Boolean).join(', '))}</small></span></button>`}).join('');box.innerHTML=siteHtml+placeHtml+(status?`<div class="place-loading">${safe(status)}</div>`:'');box.hidden=false;$('search').setAttribute('aria-expanded','true')}
function placeFly(lat,lon,zoom){if(!Number.isFinite(lat)||!Number.isFinite(lon))return;placeHide();if(state.view!=='map')document.querySelector('.nav[data-view="map"]')?.click();const map=state.map;if(!map)return;map.stop();map.flyTo([lat,lon],Math.max(10,Math.min(17,zoom)),{animate:true,duration:2.1,easeLinearity:0.22})}
function placeZoom(p){const kind=String(p.osm_value||p.type||'').toLowerCase();if(['national_park','protected_area','nature_reserve','forest'].includes(kind))return 11;if(['lake','reservoir','water'].includes(kind))return 12;if(['city','town','municipality'].includes(kind))return 14;if(['village','hamlet'].includes(kind))return 15;return 16}
function placeDedup(items){const seen=new Set();return items.filter(p=>{if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||!p.name)return false;const key=placeNorm(p.name)+'|'+Math.round(p.lat*100)+'|'+Math.round(p.lon*100);if(seen.has(key))return false;seen.add(key);return true}).slice(0,15)}
async function placeFetch(url,signal,ms=7500){const timeout=new AbortController();const timer=setTimeout(()=>timeout.abort(),ms);const abort=()=>timeout.abort();signal?.addEventListener('abort',abort,{once:true});try{const r=await fetch(url,{signal:timeout.signal,headers:{'Accept':'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}}
function placeVariants(q){
 const clean=q.trim().replace(/\s+/g,' ');
 const bare=clean.replace(/^(represa|dique|embalse|lago|laguna|parque nacional|parque|cerro|aeropuerto|rio|río)\s+(de(l)?\s+)?/i,'').trim();
 const variants=[clean];
 if(bare.length>=4&&placeNorm(bare)!==placeNorm(clean))variants.push(bare);
 const n=placeNorm(clean);
 if(n.includes('futaleufu'))variants.push('Amutui Quimey');
 if(n.includes('alerces'))variants.push('Parque Nacional Los Alerces');
 return [...new Set(variants)].slice(0,3);
}
async function placePhoton(q,signal){
 const url=new URL('https://photon.komoot.io/api/');
 url.searchParams.set('q',q);url.searchParams.set('limit','12');url.searchParams.set('lang','es');
 // Preferir el entorno visible sin limitar los resultados a ese país o región.
 const c=state.map?.getCenter();if(c){url.searchParams.set('lat',String(c.lat));url.searchParams.set('lon',String(c.lng))}
 const data=await placeFetch(url,signal);
 return (data.features||[]).filter(f=>f.geometry?.coordinates?.length>=2).map(f=>({...f.properties,lon:Number(f.geometry.coordinates[0]),lat:Number(f.geometry.coordinates[1])}));
}
async function placeCities(q,signal){const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.searchParams.set('name',q);url.searchParams.set('count','10');url.searchParams.set('language','es');url.searchParams.set('format','json');const data=await placeFetch(url,signal);return (data.results||[]).map(p=>({name:p.name,city:p.name,state:p.admin1,country:p.country,osm_value:p.feature_code?.startsWith('PPL')?'city':'place',lat:Number(p.latitude),lon:Number(p.longitude)}))}
async function placeNominatim(q,signal){
 const url=new URL('https://nominatim.openstreetmap.org/search');
 url.searchParams.set('q',q);url.searchParams.set('format','jsonv2');url.searchParams.set('addressdetails','1');url.searchParams.set('limit','12');url.searchParams.set('accept-language','es');
 const data=await placeFetch(url,signal,11000);
 return (data||[]).map(p=>({name:p.name||p.display_name?.split(',')[0],city:p.address?.city||p.address?.town||p.address?.village,state:p.address?.state,country:p.address?.country,osm_value:p.type,lat:Number(p.lat),lon:Number(p.lon)}));
}
function placeRank(p,q){
 const name=placeNorm(p.name),term=placeNorm(q);
 const alias=placeVariants(q).map(placeNorm);
 const exact=alias.some(x=>x===name);
 const contains=alias.some(x=>name.includes(x));
 const type=String(p.osm_value||'').toLowerCase();
 const priority=['dam','reservoir','lake','national_park','protected_area','city','town','village','aerodrome'].includes(type)?2:0;
 return (exact?100:contains?50:0)+priority;
}
async function placeLookup(explicit=false){
 const q=$('search').value.trim();
 if(q.length<3){placeDraw(q,[],'Escribí al menos 3 letras.');return}
 const id=++placeRequest;
 placeAbort?.abort();placeAbort=new AbortController();
 const signal=placeAbort.signal;
 const cacheKey=(explicit?'full:':'auto:')+placeNorm(q);
 if(placeCache.has(cacheKey)){placeDraw(q,placeCache.get(cacheKey));return}
 placeDraw(q,[],'Buscando lugares…');
 let found=[],success=0;
 const show=(loading=false)=>{
  if(id!==placeRequest||signal.aborted||q!==$('search').value.trim())return;
  const ranked=placeDedup(found).sort((a,b)=>placeRank(b,q)-placeRank(a,q));
  placeDraw(q,ranked,loading?'Buscando más coincidencias…':ranked.length?'':success?'Sin coincidencias. Probá con otro nombre o tocá Buscar.':'Los servicios geográficos no respondieron. Intentá de nuevo.');
  if(!loading)placeCache.set(cacheKey,ranked);
 };
 const variants=placeVariants(q);
 // Las sugerencias sólo consultan Photon y el geocodificador de ciudades.
 // Nominatim se consulta únicamente al tocar Buscar, nunca por cada tecla.
 const tasks=[...variants.slice(0,explicit?3:2).map(v=>placePhoton(v,signal)),placeCities(q,signal)];
 if(explicit)tasks.push(placeNominatim(q,signal));
 await Promise.all(tasks.map(async task=>{
  try{const rows=await task;success++;if(id!==placeRequest||signal.aborted)return;found.push(...rows);show(true)}
  catch(e){if(e.name!=='AbortError')console.warn('Búsqueda geográfica:',e.message)}
 }));
 show(false);
}
function initPlaceSearch(){
 const inp=$('search');
 inp.placeholder='Ciudad, lago, represa, parque o despegue…';
 inp.addEventListener('input',()=>{
  placeRequest++;placeAbort?.abort();clearTimeout(placeTimer);
  const q=inp.value.trim();placeDraw(q);
  if(q.length>=3)placeTimer=setTimeout(()=>placeLookup(false),450);
 });
 inp.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();const first=$('placeResults').querySelector('.place-option');if(first&&!$('placeResults').hidden)first.click();else placeLookup(true)}
  if(e.key==='Escape')placeHide();
 });
 $('placeSearchBtn').addEventListener('click',()=>placeLookup(true));
 $('placeResults').addEventListener('click',e=>{
  const btn=e.target.closest('button');if(!btn)return;
  if(btn.dataset.placeSite){
   const s=state.sites.find(x=>x.id===btn.dataset.placeSite);
   if(s){inp.value=s.name;placeFly(Number(s.lat),Number(s.lon),16);state.focusSiteId=s.id;updateMapCompass()}
   return;
  }
  if(btn.dataset.placeIndex!==undefined){
   const p=placeItems[Number(btn.dataset.placeIndex)];
   if(p){inp.value=placeName(p);placeFly(p.lat,p.lon,placeZoom(p))}
  }
 });
 document.addEventListener('click',e=>{if(!e.target.closest('.apex-place-search'))placeHide()});
}

function init(){document.body.classList.add('map-mode');initMap();loadSites();scheduleCenterWind();initPlaceSearch();$('filter').addEventListener('change',render);$('refreshBtn').addEventListener('click',()=>loadSites());$('timeSlider').addEventListener('input',e=>{state.selectedTime=Number(e.target.value);updateTimeLabel();render();scheduleCenterWind();});$('timeNow').addEventListener('click',()=>{$('timeSlider').value='0';state.selectedTime=0;updateTimeLabel();render();scheduleCenterWind()});$('windToggle').classList.add('active');$('windToggle').setAttribute('aria-pressed','true');$('windToggle').addEventListener('click',()=>{state.windEnabled=!state.windEnabled;$('windToggle').classList.toggle('active',state.windEnabled);$('windToggle').setAttribute('aria-pressed',String(state.windEnabled));renderWindLayer()});updateTimeLabel();$('layerBtn').addEventListener('click',()=>{state.map.removeLayer(state.satellite?state.sat:state.osm);state.satellite=!state.satellite;(state.satellite?state.sat:state.osm).addTo(state.map);$('layerBtn').textContent=state.satellite?'Vista: Satélite':'Vista: Calles';$('layerBtn').title=state.satellite?'Estás viendo Satélite. Clic para cambiar a Calles':'Estás viendo Calles. Clic para cambiar a Satélite'});document.querySelectorAll('.nav[data-view]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b===btn));state.view=btn.dataset.view;document.body.classList.toggle('map-mode',state.view==='map');$('pageTitle').textContent=state.view==='favorites'?'Mis favoritos':state.view==='forecast'?'Pronóstico de vuelo':'Mapa de despegues';$('pageSub').textContent=state.view==='forecast'?'Seleccioná un despegue para consultar las próximas 24 horas':'Explorá lugares, orientaciones y condiciones previstas';render();requestAnimationFrame(()=>state.map?.invalidateSize({pan:false}))}));state.map.on('click',e=>{if(state.pickLocation){setDraftLocation(e.latlng.lat,e.latlng.lng)}});$('pickMapBtn').addEventListener('click',startPick);$('pickDoneBtn').addEventListener('click',finishPick);$('siteLat').addEventListener('change',updateDraftMarker);$('siteLon').addEventListener('change',updateDraftMarker);['siteMaxGust','siteMaxWind','siteTolerance','siteName'].forEach(id=>$(id).addEventListener('input',updateEditorPreview));$('editDialog').addEventListener('close',()=>{if(!state.pickLocation)clearDraft();state.map?.closePopup()});$('adminBtn').addEventListener('click',()=>requestAdmin('add'));$('addBtn').addEventListener('click',()=>openEdit(null));$('manageAdd').addEventListener('click',()=>{$('manageDialog').close();openEdit(null)});$('manageSearch').addEventListener('input',renderManage);$('manageList').addEventListener('click',async e=>{const b=e.target.closest('[data-manage]');if(!b)return;const id=b.dataset.id;if(b.dataset.manage==='edit'){$('manageDialog').close();openEdit(id)}else await deleteSite(id)});$('loginBtn').addEventListener('click',adminLogin);$('editForm').addEventListener('submit',saveEdit);$('siteType').addEventListener('change',()=>{updateSiteTypeLabels();updateEditorPreview()});$('backupBtn').addEventListener('click',downloadSitesBackup);$('landingPresets').addEventListener('click',e=>{const b=e.target.closest('[data-landing-name]');if(!b)return;$('siteType').value='landing';$('siteName').value=b.dataset.landingName;updateSiteTypeLabels();updateEditorPreview()});$('sectors').addEventListener('click',e=>{const btn=e.target.closest('[data-deg]');if(!btn)return;const deg=Number(btn.dataset.deg);state.selectedDirections=state.selectedDirections.includes(deg)?state.selectedDirections.filter(x=>x!==deg):[...state.selectedDirections,deg];renderSectors();updateEditorPreview()});document.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(close){if(close.dataset.close==='adminDialog')pendingAdminAction=null;$(close.dataset.close).close();return}const tabBtn=e.target.closest('[data-forecast-tab]');if(tabBtn){state.forecastTab=tabBtn.dataset.forecastTab;applyForecastTab();if(state.forecastTab==='evolution'&&state.focusSiteId&&state.forecastDay)loadModelComparison(state.focusSiteId,state.forecastDay);return}const btn=e.target.closest('[data-action]');if(!btn)return;const {action,id}=btn.dataset;if(action==='favorite'){state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);localStorage.setItem('apex_favs',JSON.stringify([...state.favorites]));renderCards()}if(action==='detail')showDetail(id);if(action==='quick')showQuickSite(id);if(action==='models')loadModelComparison(id,btn.dataset.day,true);if(action==='edit')requestAdmin('edit',id);if(action==='delete')deleteSite(id)});}
// V1.42: consultas adicionales independientes del almacenamiento de lugares.
const levels=['10m','80m','120m','180m','850hPa','700hPa','600hPa'];
const advancedCache=new Map();let fieldTimer,fieldSeq=0;
async function advancedFetch(lat,lon,fields,days=5){const u=new URL('https://api.open-meteo.com/v1/forecast');Object.entries({latitude:lat,longitude:lon,hourly:fields.join(','),timezone:'GMT',wind_speed_unit:'kmh',forecast_days:days}).forEach(([k,v])=>u.searchParams.set(k,v));const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);try{const r=await fetch(u,{signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer)}}
function spatialVector(x,y){const f=state.spatialField;if(!f)return null;const px=Math.max(0,Math.min(2,x*2)),py=Math.max(0,Math.min(2,y*2)),ix=Math.min(1,Math.floor(px)),iy=Math.min(1,Math.floor(py)),a=px-ix,b=py-iy;const pts=[f[iy*3+ix],f[iy*3+ix+1],f[(iy+1)*3+ix],f[(iy+1)*3+ix+1]];if(pts.some(p=>!p))return null;const mix=k=>pts[0][k]*(1-a)*(1-b)+pts[1][k]*a*(1-b)+pts[2][k]*(1-a)*b+pts[3][k]*a*b;return {u:mix('u'),v:mix('v')}}
function utcIndex(j,target){const times=j.hourly?.time||[];let best=-1,dist=Infinity;times.forEach((t,i)=>{const d=Math.abs(Date.parse(t+'Z')-target);if(d<dist){best=i;dist=d}});return dist<=3600000?best:-1}
function numberAt(j,k,i){const v=j.hourly?.[k]?.[i];return typeof v==='number'&&Number.isFinite(v)?v:null}
function scheduleField(){clearTimeout(fieldTimer);const seq=++fieldSeq;state.spatialField=null;$('fieldStatus').textContent='Campo de viento: consultando…';fieldTimer=setTimeout(async()=>{const level=$('windAltitude').value,map=state.map,size=map.getSize();if(!size.x||!size.y)return;const coords=Array.from({length:9},(_,i)=>map.containerPointToLatLng([size.x*(i%3)/2,size.y*Math.floor(i/3)/2]));const target=Date.now()+state.selectedTime*3600000;const fields=['wind_speed_'+level,'wind_direction_'+level];if(level.endsWith('hPa'))fields.push('geopotential_height_'+level);try{const data=await advancedFetch(coords.map(p=>p.lat.toFixed(4)).join(','),coords.map(p=>p.lng.toFixed(4)).join(','),fields,3);if(seq!==fieldSeq)return;const rows=Array.isArray(data)?data:[data];state.spatialField=coords.map((_,i)=>{const j=rows[i];if(!j)return null;const n=utcIndex(j,target),speed=numberAt(j,fields[0],n),dir=numberAt(j,fields[1],n),height=numberAt(j,fields[2],n);if(speed===null||dir===null||(level.endsWith('hPa')&&(height===null||!Number.isFinite(j.elevation)||height<=j.elevation)))return null;const r=dir*Math.PI/180;return {u:-speed*Math.sin(r),v:-speed*Math.cos(r)}});$('fieldStatus').textContent=`${level} · ${state.spatialField.filter(Boolean).length}/9 puntos · interpolado · azul <25 / naranja 25–34 / rojo ≥35 km/h`;renderWindLayer()}catch(e){if(seq===fieldSeq)$('fieldStatus').textContent='Campo no disponible · '+e.message}},800)}
function windowReport(){const start=Date.now(),end=start+48*3600000;const items=state.sites.filter(s=>!isLanding(s)).map(s=>{const rows=(state.weather.get(s.id)||[]).filter(h=>h.ts>=start&&h.ts<end);let groups=[],g=[];for(const h of rows){if(assess(s,h).kind==='good'&&h.local.slice(11,13)>='08'&&h.local.slice(11,13)<'20'){if(g.length&&h.ts-g.at(-1).ts>3600000){groups.push(g);g=[]}g.push(h)}else if(g.length){groups.push(g);g=[]}}if(g.length)groups.push(g);return {s,groups,rows}}).sort((a,b)=>b.groups.reduce((n,g)=>n+g.length,0)-a.groups.reduce((n,g)=>n+g.length,0));$('windowsContent').innerHTML='<h2>Ventanas previstas · próximas 48 h</h2><p>Filtro horario 08–20 local, no verifica luz solar ni seguridad. Solo criterios de superficie.</p>'+items.map(({s,groups,rows})=>`<article class="advanced-card"><strong>${safe(s.name)}</strong><p>${groups.length?groups.map(g=>safe(g[0].local.replace('T',' ')+' a '+g.at(-1).local.replace('T',' '))).join('<br>'):rows.length?'Sin horas favorables':'Sin datos'}</p><button class="ghost" data-advanced-site="${safe(s.id)}">Perfil y riesgos</button></article>`).join('');$('windowsDialog').showModal()}
async function advancedProfile(id,day){const site=state.sites.find(s=>s.id===id),el=$('advancedProfile');if(!site||!el)return;const key=site.lat+','+site.lon;el.innerHTML='<p>Consultando perfil atmosférico…</p>';const fields=[...levels.flatMap(l=>['wind_speed_'+l,'wind_direction_'+l,...(l.endsWith('hPa')?['geopotential_height_'+l]:[])]),'temperature_2m','dew_point_2m','boundary_layer_height','cape','weather_code','cloud_cover_low','precipitation'];try{let cache=advancedCache.get(key);if(!cache||Date.now()-cache.at>1200000){let j;try{j=await advancedFetch(site.lat,site.lon,fields)}catch{j=await advancedFetch(site.lat,site.lon,fields.filter(k=>k!=='boundary_layer_height'))}cache={j,at:Date.now()};advancedCache.set(key,cache)}if(!el.isConnected)return;const j=cache.j,rows=(state.weather.get(id)||[]).filter(h=>h.local.startsWith(day||''));const chosen=rows.find(h=>h.ts>=Date.now()+state.selectedTime*3600000)||rows[0];const target=chosen?.ts??Date.now();const draw=ts=>{const i=utcIndex(j,ts),v=k=>numberAt(j,k,i),elev=j.elevation;const profile=levels.map(l=>({l,s:v('wind_speed_'+l),d:v('wind_direction_'+l),z:l.endsWith('hPa')?v('geopotential_height_'+l):Number.isFinite(elev)?elev+parseInt(l):null})).filter(p=>p.z!==null&&(!p.l.endsWith('hPa')||p.z>elev)).sort((a,b)=>a.z-b.z);const t=v('temperature_2m'),dew=v('dew_point_2m'),base=t!==null&&dew!==null?Math.max(0,125*(t-dew)):null;const surface=profile.find(p=>p.l==='10m'),alerts=[];for(const p of profile){if(p.s!==null&&p.s>=site.maxWind)alerts.push(`${p.l}: viento ${fmt(p.s)} km/h supera o alcanza límite del lugar`);if(surface&&p.d!==null&&surface.d!==null&&p.s!==null&&surface.s!==null&&p.l!=='10m'&&(degDiff(p.d,surface.d)>45||Math.abs(p.s-surface.s)>15))alerts.push(`${p.l}: cambio importante de viento respecto a superficie`)}if([95,96,99].includes(v('weather_code')))alerts.push('Tormenta eléctrica prevista');if(v('cape')>=350)alerts.push('Inestabilidad: revisar convección y tormentas');if(surface?.d!=null&&site.windFromDirections?.length&&Math.min(...site.windFromDirections.map(d=>degDiff(d,surface.d)))>90)alerts.push('Viento opuesto a orientaciones admitidas: posible sotavento, no diagnóstico de rotor');const out=el.querySelector('.profile-output');out.innerHTML=`<div class="model-table-wrap"><table><thead><tr><th>Nivel</th><th>Altitud s.n.m.</th><th>Viento</th><th>Desde</th></tr></thead><tbody>${profile.map(p=>`<tr><th>${p.l}</th><td>${fmt(p.z)} m</td><td>${fmt(p.s)} km/h</td><td>${windLabel(p.d)}</td></tr>`).join('')}</tbody></table></div><div class="advanced-card">Capa límite: ${fmt(v('boundary_layer_height'))} m AGL<br>Base de condensación estimada: ${fmt(base)} m AGL<br>CAPE: ${fmt(v('cape'))} J/kg · Nube baja: ${fmt(v('cloud_cover_low'))}%<br>Precipitación: ${fmt(v('precipitation'),1)} mm/h</div><div class="advanced-card"><strong>Advertencias orientativas</strong><p>${alerts.length?alerts.map(safe).join('<br>'):'Sin alertas detectadas en los datos disponibles; no garantiza condiciones seguras.'}</p></div><small>Perfil Open-Meteo modelo automático. Base estimada por temperatura y rocío, no techo real. Capa límite y CAPE no equivalen a fuerza térmica. Niveles bajo terreno omitidos; — significa dato ausente.</small>`};el.innerHTML=`<label>Hora local <select class="profile-hour">${rows.map(h=>`<option value="${h.ts}" ${h.ts===target?'selected':''}>${safe(h.local.replace('T',' '))}</option>`).join('')}</select></label><div class="profile-output"></div>`;el.querySelector('select').onchange=e=>draw(Number(e.target.value));draw(target)}catch(e){if(el.isConnected)el.textContent='Perfil no disponible: '+e.message}}
function initAdvancedMeteo(){state.map.on('moveend resize',scheduleField);$('windAltitude').onchange=scheduleField;$('timeSlider').addEventListener('input',scheduleField);$('timeNow').addEventListener('click',scheduleField);$('windowsBtn').onclick=windowReport;document.addEventListener('click',e=>{const b=e.target.closest('[data-advanced-site]');if(b){$('windowsDialog').close();showDetail(b.dataset.advancedSite);state.forecastTab='advanced';applyForecastTab();advancedProfile(b.dataset.advancedSite,state.forecastDay)}const t=e.target.closest('[data-forecast-tab="advanced"]');if(t)advancedProfile(state.focusSiteId,state.forecastDay)});scheduleField()}
init();
initAdvancedMeteo();

// Selector de días del pronóstico ampliado
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-day][data-site]');if(b)showDetail(b.dataset.site,b.dataset.day)});

// Cada apertura o restauración de página comienza en Satélite.
window.addEventListener('pageshow',()=>{if(!state.map||!state.sat)return;if(state.osm&&state.map.hasLayer(state.osm))state.map.removeLayer(state.osm);if(!state.map.hasLayer(state.sat))state.sat.addTo(state.map);state.satellite=true;const btn=document.getElementById('layerBtn');if(btn){btn.textContent='Vista: Satélite';btn.title='Estás viendo Satélite. Clic para cambiar a Calles';}});
