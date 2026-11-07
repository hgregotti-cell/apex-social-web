/* Apex Social Web V1 · meteorología orientativa · datos Open-Meteo */
'use strict';
const $=id=>document.getElementById(id);
const sectors=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
const state={sites:[],weather:new Map(),favorites:new Set(JSON.parse(localStorage.getItem('apex_favs')||'[]')),view:'map',map:null,markers:[],satellite:true,token:'',editing:null,selectedDirections:[],pending:false};
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const degDiff=(a,b)=>Math.abs(((a-b+540)%360)-180);
const windLabel=d=>d==null?'—':sectors[Math.round(((d%360)+360)%360/22.5)%16];
const fmt=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.display='none',4500)}
function assess(site,h){if(!h||!Number.isFinite(h.wind)||!Number.isFinite(h.gust)||!Number.isFinite(h.dir))return {kind:'unknown',label:'SIN DATOS',reason:'Pronóstico incompleto: no se puede recomendar volar',score:0};
 const problems=[];if(h.gust>=Number(site.maxGust??35))problems.push(`Ráfagas ${fmt(h.gust)} km/h (límite ${site.maxGust??35})`);if(h.wind>=Number(site.maxWind??30))problems.push(`Viento ${fmt(h.wind)} km/h (límite ${site.maxWind??30})`);if(h.rain>=0.3)problems.push('Precipitación prevista');
 if(problems.length)return {kind:'bad',label:'NO RECOMENDADO',reason:problems.join(' · '),score:Math.min(20,Math.max(0,50-h.gust))};
 if(!site.windFromDirections?.length)return {kind:'unknown',label:'ORIENTACIÓN PENDIENTE',reason:'Configurá una orientación antes de evaluar',score:0};
 const delta=Math.min(...site.windFromDirections.map(x=>degDiff(x,h.dir)));
 if(delta>Number(site.tolerance??30))return {kind:'bad',label:'DIRECCIÓN INCOMPATIBLE',reason:`Viento ${windLabel(h.dir)} fuera de los sectores del despegue`,score:15};
 const warnings=[];if(h.gust>=27)warnings.push('Ráfagas próximas al límite');if(h.wind>=22)warnings.push('Viento sostenido elevado');if(h.rain>0)warnings.push('Posible precipitación');if(h.cloud>=95)warnings.push('Nubosidad muy alta');
 if(warnings.length)return {kind:'warn',label:'PRECAUCIÓN',reason:warnings.join(' · '),score:Math.max(25,65-(h.gust-20)*2)};
 return {kind:'good',label:'FAVORABLE EN MODELO',reason:`Orientación compatible · ${windLabel(h.dir)} (${fmt(h.dir)}°). Verificar condiciones reales.`,score:Math.round(90-delta*.7)};
}
function hourFor(site){const hours=state.weather.get(site.id)||[];const now=Date.now();return hours.find(h=>h.ts>=now-45*60*1000)||hours[0]||null}
async function loadSites(){
 try{
  let sites=null;
  if(window.APEX_ADMIN_API){
   try{const r=await fetch(window.APEX_ADMIN_API.replace(/\/$/,'')+'/despegues',{cache:'no-store'});if(r.ok){const data=await r.json();if(data.initialized&&Array.isArray(data.despegues))sites=data.despegues;}}catch(e){console.warn('API no disponible, se intenta archivo original',e)}
  }
  if(!sites){const r=await fetch('despegues.json?nocache='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(!Array.isArray(data.sites))throw Error('Formato inválido');sites=data.sites;}
  state.sites=sites.filter(s=>typeof s.name==='string'&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&Array.isArray(s.windFromDirections));render();loadWeather();
 }catch(e){$('cards').innerHTML=`<div class="empty">No se pudieron cargar los despegues. Conservá despegues.json en GitHub Pages.<br>${safe(e.message)}</div>`;toast('Error cargando lugares')}
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
async function loadWeather(){const sites=[...state.sites];$('updated').textContent='Actualizando pronósticos...';let done=0;const queue=[...sites];async function worker(){while(queue.length){const site=queue.shift();try{
 const u=new URL('https://api.open-meteo.com/v1/forecast');Object.entries({latitude:site.lat,longitude:site.lon,hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,precipitation_probability,cloud_cover,cloud_cover_low,cape,wind_speed_850hPa,wind_direction_850hPa,surface_pressure,visibility',wind_speed_unit:'kmh',timezone:'auto',forecast_days:5}).forEach(([k,v])=>u.searchParams.set(k,v));
 const r=await fetch(u,{signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('HTTP '+r.status);state.weather.set(site.id,weatherFromJson(await r.json()));
 }catch(e){console.warn('Pronóstico ampliado',site.name,e);state.weather.delete(site.id)}done++;$('updated').textContent=`${done}/${sites.length} actualizados`;renderCards();renderMarkers()}}await Promise.all(Array.from({length:Math.min(3,sites.length)},worker));$('updated').textContent=`Actualizado · ${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`;}
function visibleSites(){let sites=state.sites.filter(s=>s.name.toLowerCase().includes($('search').value.toLowerCase()));if(state.view==='favorites')sites=sites.filter(s=>state.favorites.has(s.id));const f=$('filter').value;if(f==='good')sites=sites.filter(s=>assess(s,hourFor(s)).kind==='good');if(f==='bad')sites=sites.filter(s=>assess(s,hourFor(s)).kind==='bad');return sites;}
function card(site){const h=hourFor(site),a=assess(site,h),fav=state.favorites.has(site.id);return `<article class="site-card"><div class="site-top"><div><div class="site-title">${safe(site.name)}</div><div class="site-coords">⌖ ${fmt(site.lat,5)}, ${fmt(site.lon,5)}</div></div><button class="star ${fav?'on':''}" data-action="favorite" data-id="${safe(site.id)}" title="Favorito">★</button></div><div class="status ${a.kind}">${safe(a.label)}</div><div class="site-stats"><div class="stat"><small>↗ Viento</small><strong>${fmt(h?.wind)} <small style="display:inline">km/h</small></strong></div><div class="stat"><small>≋ Ráfagas</small><strong>${fmt(h?.gust)} <small style="display:inline">km/h</small></strong></div><div class="stat"><small>◈ Dirección</small><strong>${windLabel(h?.dir)}</strong></div></div><div class="site-reason">${safe(a.reason)}</div><div class="site-bottom"><div class="orientation">⌁ Despegue: ${site.windFromDirections.length?site.windFromDirections.map(windLabel).join(' · '):'Sin configurar'}</div><div class="site-actions"><button class="text-btn" data-action="detail" data-id="${safe(site.id)}">VER MÁS ›</button>${state.token?`<button class="text-btn" data-action="edit" data-id="${safe(site.id)}">✎</button><button class="text-btn danger-btn" data-action="delete" data-id="${safe(site.id)}">✕</button>`:''}</div></div></article>`}
function renderCards(){const sites=visibleSites();$('count').textContent=sites.length;$('cards').innerHTML=sites.length?sites.map(card).join(''):'<div class="empty">No hay despegues para mostrar.</div>'}
// Ícono original de FIX16: Flutter Icons.paragliding es el glifo Material Icons 'paragliding'.
// Usamos el mismo glifo tipográfico, no un dibujo SVG aproximado.
const orangeParaglider='<span class="material-icons apex-original-paraglider" aria-hidden="true">paragliding</span>';
function renderMarkers(){if(!state.map)return;state.markers.forEach(m=>state.map.removeLayer(m));state.markers=[];visibleSites().forEach(s=>{const a=assess(s,hourFor(s));const icon=L.divIcon({className:'',html:`<div class="apex-paraglider ${a.kind}" title="${safe(a.label)}">${orangeParaglider}</div>`,iconSize:[46,46],iconAnchor:[23,23]});const marker=L.marker([s.lat,s.lon],{icon}).addTo(state.map);marker.bindTooltip(s.name,{direction:'top'});marker.on('click',()=>{state.focusSiteId=s.id;updateMapCompass();if(state.token){const popup=`<div class="apex-marker-menu"><strong>${safe(s.name)}</strong><span>${safe(a.label)}</span><div class="apex-marker-actions"><button type="button" data-action="detail" data-id="${safe(s.id)}">Pronóstico</button><button type="button" data-action="edit" data-id="${safe(s.id)}">✎ Editar</button><button type="button" data-action="delete" data-id="${safe(s.id)}">Eliminar</button></div></div>`;marker.bindPopup(popup,{autoPan:false,closeButton:true,maxWidth:290,minWidth:230}).openPopup()}else showDetail(s.id)});state.markers.push(marker)})}
function render(){renderCards();renderMarkers();updateMapCompass();$('addBtn').hidden=!state.token;$('manageBtn').hidden=!state.token;}
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
 ['ESTADO',h=>`<span class="status ${assess(site,h).kind}">${safe(assess(site,h).label)}</span>`],
 ['TEMPERATURA',h=>`${fmt(h.temp,1)} °C`],['SENSACIÓN',h=>`${fmt(h.feels,1)} °C`],
 ['VIENTO 10 m',h=>`${fmt(h.wind)} km/h`],['RÁFAGA',h=>`${fmt(h.gust)} km/h`],
 ['DIRECCIÓN',h=>`${windLabel(h.dir)} · ${fmt(h.dir)}°`],
 ['LLUVIA',h=>`${fmt(h.rain,1)} mm`],['PROB. LLUVIA',h=>`${fmt(h.rainProb)} %`],
 ['NUBOSIDAD',h=>`${fmt(h.cloud)} %`],['NUBE BAJA',h=>`${fmt(h.cloudLow)} %`],
 ['VIENTO ~1500 m',h=>`${fmt(h.wind850)} km/h`],['DIR. ~1500 m',h=>`${windLabel(h.direction850)} · ${fmt(h.direction850)}°`],
 ['CAPE',h=>`${fmt(h.cape)} J/kg`],['HUMEDAD',h=>`${fmt(h.humidity)} %`],
 ['PRESIÓN',h=>`${fmt(h.pressure)} hPa`],['VISIBILIDAD',h=>h.visibility==null?'—':`${fmt(h.visibility/1000,1)} km`]
 ];return `<div class="matrix-scroll"><table class="apex-matrix"><thead><tr><th>VARIABLE / HORA</th>${hours.map(h=>`<th>${safe(h.local.slice(11,16))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><th>${label}</th>${hours.map(h=>`<td>${fn(h)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function showDetail(id,day){const s=state.sites.find(x=>x.id===id);if(!s)return;const all=state.weather.get(id)||[],h=hourFor(s),a=assess(s,h);const days=[...new Set(all.map(x=>x.local.slice(0,10)))].slice(0,5);const chosen=days.includes(day)?day:days[0];const hs=all.filter(x=>x.local.startsWith(chosen||'')).slice(0,24);const current=hs.find(x=>x.ts>=Date.now()-3600000)||hs[0]||h;
 $('detailContent').innerHTML=`<div class="eyebrow">APEX SOCIAL · METEOROLOGÍA DE DESPEGUE</div><h2>${safe(s.name)}</h2><div class="detail-meta"><span>⌖ ${fmt(s.lat,5)}, ${fmt(s.lon,5)}</span><span>Despegue: ${s.windFromDirections.map(windLabel).join(' · ')||'Sin configurar'}</span><span>Horizonte: 5 días</span></div><div class="forecast-overview"><div class="forecast-intro"><div class="status ${a.kind}">${safe(a.label)}</div><p>${safe(a.reason)}</p><div class="overview-metrics"><div><small>VIENTO</small><strong>${fmt(current?.wind)} <small>km/h</small></strong></div><div><small>RÁFAGA</small><strong>${fmt(current?.gust)} <small>km/h</small></strong></div><div><small>TEMPERATURA</small><strong>${fmt(current?.temp,1)} °C</strong></div><div><small>NUBE BAJA</small><strong>${fmt(current?.cloudLow)} %</strong></div></div><p class="source-note">Datos horarios de Open-Meteo. Una fuente de pronóstico: no es el consenso multimodelo de la app iOS.</p></div></div><div class="day-selector">${days.map((d,i)=>`<button class="day-button ${d===chosen?'selected':''}" data-day="${safe(d)}" data-site="${safe(id)}">${i===0?'HOY · ':''}${safe(d.slice(8,10)+'/'+d.slice(5,7))}</button>`).join('')}</div><div class="matrix-header"><strong>PRONÓSTICO HORARIO · 24 HORAS DEL DÍA</strong><span>Todos los horarios y variables juntos · ampliá la ventana para mayor comodidad</span></div>${hs.length?forecastMatrix(s,hs):'<div class="empty">Sin datos meteorológicos para este día.</div>'}<p class="source-note">La brújula de viento y orientaciones está sobre el mapa. Las condiciones reales deben verificarse en el despegue.</p>`;
 if(!$('detailDialog').open)$('detailDialog').showModal();const matrix=$('detailDialog').querySelector('.matrix-scroll');if(matrix)matrix.scrollLeft=0;state.focusSiteId=s.id;updateMapCompass();state.map?.panTo([s.lat,s.lon]);}
const API_URL=(window.APEX_ADMIN_API||'').replace(/\/$/,'');
function openAdmin(){ $('adminPassword').value='';$('adminMessage').textContent=API_URL?'':'Falta configurar la dirección del servidor de administración en config.js.';$('adminDialog').showModal() }
async function api(path,method='GET',body){if(!API_URL)throw Error('Configurá APEX_ADMIN_API en config.js');const response=await fetch(API_URL+path,{method,headers:{'Content-Type':'application/json','X-Apex-Password':state.token},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Error HTTP '+response.status);return data}
async function adminLogin(){const password=$('adminPassword').value; if(!password){$('adminMessage').textContent='Ingresá la contraseña.';return}state.token=password;$('loginBtn').disabled=true;try{await api('/auth');$('adminDialog').close();$('adminPassword').value='';render();toast('Modo edición habilitado · tocá un parapente para editarlo o eliminarlo, o elegí Nuevo despegue')}catch(e){state.token='';$('adminMessage').textContent=e.message}finally{$('loginBtn').disabled=false}}
async function publishSites(next){if(state.pending)return false;state.pending=true;try{await api('/sites','PUT',{sites:next});state.sites=next;render();toast('Guardado en Cloudflare D1. Los cambios ya están disponibles.');return true}catch(e){toast('Error al guardar: '+e.message);return false}finally{state.pending=false}}
function setDraftLocation(lat,lon){$('siteLat').value=Number(lat).toFixed(6);$('siteLon').value=Number(lon).toFixed(6);updateDraftMarker()}
function updateDraftMarker(){if(!state.map)return;const lat=Number($('siteLat').value),lon=Number($('siteLon').value);if(!$('siteLat').value||!$('siteLon').value||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;const icon=L.divIcon({className:'',html:'<div class="apex-windsock" title="Arrastrá para ajustar">🚩<span>⌖</span></div>',iconSize:[44,56],iconAnchor:[22,52]});if(!state.draftMarker){state.draftMarker=L.marker([lat,lon],{icon,draggable:true,zIndexOffset:2000}).addTo(state.map);state.draftMarker.on('dragend',()=>{const c=state.draftMarker.getLatLng();setDraftLocation(c.lat,c.lng)})}else state.draftMarker.setLatLng([lat,lon]);}
function clearDraft(){if(state.draftMarker){state.map.removeLayer(state.draftMarker);state.draftMarker=null}state.pickLocation=false;document.body.classList.remove('picking-location');$('pickBanner').hidden=true}

function renderManage(){const q=$('manageSearch').value.trim().toLocaleLowerCase('es');const sites=state.sites.filter(s=>s.name.toLocaleLowerCase('es').includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'es'));$('manageList').innerHTML=sites.length?sites.map(s=>`<div class="manage-site"><div class="manage-site-name"><strong>${safe(s.name)}</strong><small>${fmt(s.lat,5)}, ${fmt(s.lon,5)} · ${s.windFromDirections?.map(windLabel).join(' / ')||'Sin orientación'}</small></div><div class="manage-site-actions"><button class="ghost" data-manage="edit" data-id="${safe(s.id)}">✎ Editar</button><button class="ghost danger-btn" data-manage="delete" data-id="${safe(s.id)}">Eliminar</button></div></div>`).join(''):'<div class="empty">No hay despegues que coincidan.</div>'}
function openManage(){if(!state.token){openAdmin();return}$('manageSearch').value='';renderManage();$('manageDialog').showModal()}
function openEdit(id){state.map?.closePopup();if(!state.token){openAdmin();return}const s=state.sites.find(x=>x.id===id);state.editing=s?.id||null;state.selectedDirections=[...(s?.windFromDirections||[])];$('editTitle').textContent=s?'Editar despegue':'Nuevo despegue';$('siteName').value=s?.name||'';$('siteLat').value=s?.lat??'';$('siteLon').value=s?.lon??'';$('siteMaxGust').value=s?.maxGust??35;$('siteMaxWind').value=s?.maxWind??30;$('siteTolerance').value=s?.tolerance??30;$('siteNotes').value=s?.notes||'';renderSectors();if(s)updateDraftMarker();$('editDialog').showModal()}
function renderSectors(){$('sectors').innerHTML=sectors.map((s,i)=>`<button type="button" class="sector ${state.selectedDirections.includes(i*22.5)?'selected':''}" data-deg="${i*22.5}">${s}</button>`).join('')}
async function saveEdit(ev){ev.preventDefault();if(!state.token)return;const name=$('siteName').value.trim(),lat=Number($('siteLat').value),lon=Number($('siteLon').value);if(!name||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!state.selectedDirections.length){toast('Completá nombre, coordenadas y orientaciones.');return}const id=state.editing||('site_'+Date.now().toString(36));const old=state.sites.find(x=>x.id===id)||{};const item={...old,id,name,lat,lon,windFromDirections:[...state.selectedDirections].sort((a,b)=>a-b),maxGust:Number($('siteMaxGust').value),maxWind:Number($('siteMaxWind').value),tolerance:Number($('siteTolerance').value),notes:$('siteNotes').value.trim()};const next=state.editing?state.sites.map(s=>s.id===id?item:s):[...state.sites,item];const btn=$('editForm').querySelector('[type=submit]');btn.disabled=true;const ok=await publishSites(next);btn.disabled=false;if(ok){$('editDialog').close();clearDraft();loadWeather();renderManage()}}
async function deleteSite(id){state.map?.closePopup();if(!state.token)return;const s=state.sites.find(x=>x.id===id);if(!s||!confirm(`¿Eliminar «${s.name}»? El mapa permanecerá en su lugar.\nEsta acción se guardará en Cloudflare D1.`))return;const next=state.sites.filter(x=>x.id!==id);if(await publishSites(next)){state.weather.delete(id);renderManage()}}
function startPick(){state.pickLocation=true;$('editDialog').close();$('pickBanner').hidden=false;document.body.classList.add('picking-location');toast('Tocá el mapa donde querés ubicar la manga. No se moverá el mapa automáticamente.')}
function finishPick(){state.pickLocation=false;document.body.classList.remove('picking-location');$('pickBanner').hidden=true;$('editDialog').showModal()}

// FIX16: brújula GEOGRÁFICA en el mapa; independiente del pronóstico modal.
// Leaflet no rota el mapa en esta versión web, por lo que el norte siempre queda arriba.
state.focusSiteId=null;
state.centerWind=null;
state.centerWindTimer=null;
function centerForecastSite(){
  const focus=state.sites.find(s=>s.id===state.focusSiteId);
  if(focus)return focus;
  if(!state.map)return null;
  const c=state.map.getCenter();
  return [...state.sites].sort((a,b)=>(a.lat-c.lat)**2+(a.lon-c.lng)**2-( (b.lat-c.lat)**2+(b.lon-c.lng)**2 ))[0]||null;
}
function mapCompassSvg(site,h){
 const dir=state.centerWind?.dir??h?.dir;
 const valid=site?.windFromDirections||[];
 const arc=(deg,r,width,color,opacity)=>{const a=(deg-width/2)*Math.PI/180,b=(deg+width/2)*Math.PI/180;const p=x=>`${(70+r*Math.sin(x)).toFixed(2)} ${(70-r*Math.cos(x)).toFixed(2)}`;return `<path d="M ${p(a)} A ${r} ${r} 0 0 1 ${p(b)}" fill="none" stroke="${color}" stroke-width="${opacity===.9?5:10}" stroke-linecap="round" opacity="${opacity}"/>`};
 const bands=valid.map(d=>arc(d,58,60,'#36e398',.23)+arc(d,58,30,'#36e398',.9)).join('');
 const labels=sectors.map((label,i)=>{const a=i*22.5*Math.PI/180;const r=i%4===0?43:49;return `<text x="${70+r*Math.sin(a)}" y="${74-r*Math.cos(a)}" fill="${i===0?'#ff792d':'#d6e8fa'}" font-size="${i%4===0?10:6.8}" font-weight="800" text-anchor="middle">${label}</text>`}).join('');
 return `<svg viewBox="0 0 140 140" role="img" aria-label="Brújula geográfica con norte fijo"><circle cx="70" cy="70" r="67" fill="#07182f" stroke="#31516c" stroke-width="2"/>${bands}${labels}${Number.isFinite(dir)?`<g transform="rotate(${dir} 70 70)"><path d="M70 8L63 31L70 26L77 31Z" fill="#ff7b27"/><path d="M70 132L63 109L70 114L77 109Z" fill="#57c3ff"/><path d="M70 30V110" stroke="#ff8935" stroke-width="2"/></g>`:''}<circle cx="70" cy="70" r="10" fill="#102c4c" stroke="#3b6686"/><text x="70" y="73" text-anchor="middle" fill="#fff" font-size="8" font-weight="900">${Number.isFinite(dir)?windLabel(dir):'N↑'}</text></svg>`;
}
function updateMapCompass(){
 const box=$('mapCompass');if(!box)return;
 const site=centerForecastSite(),h=site?hourFor(site):null,w=state.centerWind;
 const dir=w?.dir??h?.dir;
 box.innerHTML=`${mapCompassSvg(site,h)}<div class="map-compass-caption"><strong>VIENTO MAPA · NORTE FIJO</strong><span>${Number.isFinite(dir)?`${windLabel(dir)} ${Math.round(dir)}° → ${windLabel((dir+180)%360)}`:'Dirección —'}</span><span>${Number.isFinite(w?.wind)?Math.round(w.wind):fmt(h?.wind)} km/h · ráf. ${Number.isFinite(w?.gust)?Math.round(w.gust):fmt(h?.gust)} km/h</span><small>${site?safe(site.name)+' · '+site.windFromDirections.map(windLabel).join(' · '):'Seleccioná un despegue'}</small></div>`;
}
function scheduleCenterWind(){
 clearTimeout(state.centerWindTimer);
 state.centerWindTimer=setTimeout(async()=>{
  if(!state.map)return;
  const center=state.map.getCenter();const request=state.centerWindRequest=(state.centerWindRequest||0)+1;
  try{const url=new URL('https://api.open-meteo.com/v1/forecast');
   Object.entries({latitude:center.lat,longitude:center.lng,current:'wind_speed_10m,wind_direction_10m,wind_gusts_10m',wind_speed_unit:'kmh',timezone:'auto'}).forEach(([k,v])=>url.searchParams.set(k,v));
   const response=await fetch(url);if(!response.ok)throw Error('Viento no disponible');
   const c=(await response.json()).current||{};if(request!==state.centerWindRequest)return;
   state.centerWind={wind:Number(c.wind_speed_10m),gust:Number(c.wind_gusts_10m),dir:Number(c.wind_direction_10m)};
   updateMapCompass();
  }catch(_){if(request===state.centerWindRequest){state.centerWind=null;updateMapCompass()}}
 },650);
}
function init(){document.body.classList.add('map-mode');initMap();loadSites();scheduleCenterWind();$('search').addEventListener('input',render);$('filter').addEventListener('change',render);$('refreshBtn').addEventListener('click',()=>loadWeather());$('layerBtn').addEventListener('click',()=>{state.map.removeLayer(state.satellite?state.sat:state.osm);state.satellite=!state.satellite;(state.satellite?state.sat:state.osm).addTo(state.map);$('layerBtn').textContent=state.satellite?'Vista: Satélite':'Vista: Calles';$('layerBtn').title=state.satellite?'Estás viendo Satélite. Clic para cambiar a Calles':'Estás viendo Calles. Clic para cambiar a Satélite'});document.querySelectorAll('.nav[data-view]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b===btn));state.view=btn.dataset.view;document.body.classList.toggle('map-mode',state.view==='map');$('pageTitle').textContent=state.view==='favorites'?'Mis favoritos':state.view==='forecast'?'Pronóstico de vuelo':'Mapa de despegues';$('pageSub').textContent=state.view==='forecast'?'Seleccioná un despegue para consultar las próximas 24 horas':'Explorá lugares, orientaciones y condiciones previstas';render();requestAnimationFrame(()=>state.map?.invalidateSize({pan:false}))}));state.map.on('click',e=>{if(state.pickLocation){setDraftLocation(e.latlng.lat,e.latlng.lng);finishPick()}});$('pickMapBtn').addEventListener('click',startPick);$('pickDoneBtn').addEventListener('click',finishPick);$('siteLat').addEventListener('change',updateDraftMarker);$('siteLon').addEventListener('change',updateDraftMarker);$('editDialog').addEventListener('close',()=>{if(!state.pickLocation)clearDraft()});$('adminBtn').addEventListener('click',()=>state.token?(state.token='',clearDraft(),render(),toast('Administración cerrada')):openAdmin());$('addBtn').addEventListener('click',()=>openEdit(null));$('manageBtn').addEventListener('click',openManage);$('manageAdd').addEventListener('click',()=>{$('manageDialog').close();openEdit(null)});$('manageSearch').addEventListener('input',renderManage);$('manageList').addEventListener('click',async e=>{const b=e.target.closest('[data-manage]');if(!b)return;const id=b.dataset.id;if(b.dataset.manage==='edit'){$('manageDialog').close();openEdit(id)}else await deleteSite(id)});$('loginBtn').addEventListener('click',adminLogin);$('editForm').addEventListener('submit',saveEdit);$('sectors').addEventListener('click',e=>{const btn=e.target.closest('[data-deg]');if(!btn)return;const deg=Number(btn.dataset.deg);state.selectedDirections=state.selectedDirections.includes(deg)?state.selectedDirections.filter(x=>x!==deg):[...state.selectedDirections,deg];renderSectors()});document.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(close){$(close.dataset.close).close();return}const btn=e.target.closest('[data-action]');if(!btn)return;const {action,id}=btn.dataset;if(action==='favorite'){state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);localStorage.setItem('apex_favs',JSON.stringify([...state.favorites]));renderCards()}if(action==='detail')showDetail(id);if(action==='edit')openEdit(id);if(action==='delete')deleteSite(id)});}
init();

// Selector de días del pronóstico ampliado
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-day][data-site]');if(b)showDetail(b.dataset.site,b.dataset.day)});

// Cada apertura o restauración de página comienza en Satélite.
window.addEventListener('pageshow',()=>{if(!state.map||!state.sat)return;if(state.osm&&state.map.hasLayer(state.osm))state.map.removeLayer(state.osm);if(!state.map.hasLayer(state.sat))state.sat.addTo(state.map);state.satellite=true;const btn=document.getElementById('layerBtn');if(btn){btn.textContent='Vista: Satélite';btn.title='Estás viendo Satélite. Clic para cambiar a Calles';}});
