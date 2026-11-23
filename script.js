/* GARAGEM ABERTA — filtros multicategorias, fichas, comparação e suporte a fotos */
const DATA_URL = 'dados/carros.json';
let vehicles = [], selected = new Set(), view = 'grid';
const $ = s => document.querySelector(s);
const norm = s => (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fmt = v => v === null || v === undefined || v === '' ? '—' : v;
const nfmt = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const MAIN_LABELS = { motos: 'Motos', carros: 'Carros', vans_utilitarios: 'Vans e utilitários', caminhoes: 'Caminhões' };

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    vehicles = Array.isArray(data) ? data : (data.veiculos || []);
    populate(); stats(); render(); initCascadeSearch();
  } catch (error) {
    $('#cards').innerHTML = '<p class="erro">Não foi possível carregar o catálogo. Confira se a pasta <b>dados</b> e o arquivo <b>carros.json</b> estão no mesmo projeto e abra pelo servidor local (não pelo file://).</p>';
    $('#resultCount').textContent = 'Falha ao carregar dados';
    console.error(error);
  }
}
function stats() {
  $('#totalCars').textContent = vehicles.length.toLocaleString('pt-BR');
  $('#totalBrands').textContent = new Set(vehicles.map(v => v.marca).filter(Boolean)).size;
  const years = vehicles.map(v => Number(v.ano)).filter(Number.isFinite);
  $('#totalYears').textContent = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—';
}
function addOptions(selector, values) {
  const element = $(selector); if (!element) return;
  [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))]
    .sort((a,b) => String(a).localeCompare(String(b), 'pt-BR'))
    .forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; element.append(option); });
}
function populate() {
  addOptions('#brand', vehicles.map(v => v.marca));
  addOptions('#category', vehicles.map(v => v.categoria));
  addOptions('#fuel', vehicles.map(v => v.combustivel));
  addOptions('#year', vehicles.map(v => v.ano));
}
function filtered() {
  const q = norm($('#q').value), main = $('#mainCategory')?.value || '', brand = $('#brand').value;
  const category = $('#category').value, origin = $('#origin')?.value || '', fuel = $('#fuel').value;
  const year = $('#year').value, sort = $('#sort').value;
  const result = vehicles.filter(v => {
    const haystack = norm([v.marca,v.modelo,v.versao,v.motor,v.ano,v.categoria,v.categoria_principal,v.origem,v.combustivel].join(' '));
    return (!q || haystack.includes(q)) && (!main || v.categoria_principal === main) &&
      (!brand || v.marca === brand) && (!category || v.categoria === category) &&
      (!origin || v.origem === origin) && (!fuel || v.combustivel === fuel) && (!year || String(v.ano) === year);
  });
  result.sort((a,b) => sort === 'yearDesc' ? (Number(b.ano)||0)-(Number(a.ano)||0) :
    sort === 'yearAsc' ? (Number(a.ano)||0)-(Number(b.ano)||0) :
    sort === 'brand' ? String(a.marca||'').localeCompare(String(b.marca||''),'pt-BR') :
    `${a.marca||''} ${a.modelo||''}`.localeCompare(`${b.marca||''} ${b.modelo||''}`,'pt-BR'));
  return result;
}
function esc(value) { return String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// FOTOS — prioriza imagem cadastrada no JSON. Na busca automática, considera
// marca + modelo + ano + versão, pontua a correspondência e impede reutilizar
// a mesma foto em registros diferentes. Se não houver correspondência segura,
// mantém o espaço sem foto em vez de exibir um veículo aleatório.
const photoCache = new Map();
const photoQueue = [];
const claimedPhotoUrls = new Map();
let photoWorkers = 0;
function photoMarkup(vehicle, detail = false) {
  const url = vehicle.imagem_url || vehicle.foto_url || vehicle.imagem || '';
  const alt = `${vehicle.marca || ''} ${vehicle.modelo || ''} ${vehicle.ano || ''}`.trim();
  const boxClass = detail ? 'vehiclePhoto detailPhoto' : 'vehiclePhoto';
  if (!url) return `<div class="${boxClass} noPhoto" data-auto-photo="${esc(vehicle.id || '')}" aria-label="Foto específica não encontrada"></div>`;
  const credit = vehicle.imagem_credito || vehicle.foto_credito || '';
  const license = vehicle.imagem_licenca || vehicle.foto_licenca || '';
  const source = vehicle.imagem_fonte || vehicle.foto_fonte || '';
  const attribution = [credit, license, source].filter(Boolean).join(' · ');
  return `<div class="${boxClass}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('noPhoto');this.remove()"></div>${attribution ? `<div class="imageCredit">Foto: ${esc(attribution)}</div>` : ''}`;
}
function cleanMeta(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function photoKey(vehicle) {
  return [vehicle.id, vehicle.marca, vehicle.modelo, vehicle.ano, vehicle.versao].map(v => norm(v || '')).join('|');
}
function photoWords(value) {
  return norm(value).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
function scoreCommonsCandidate(page, vehicle) {
  const info = page.imageinfo?.[0];
  if (!info?.thumburl) return null;
  const meta = info.extmetadata || {};
  const title = cleanMeta(page.title || '').replace(/^File:/i, ' ');
  const description = cleanMeta(meta.ImageDescription?.value || '');
  const searchableTitle = norm(title);
  const searchableAll = norm(`${title} ${description}`);
  const modelWords = photoWords(vehicle.modelo || '');
  const brandWords = photoWords(vehicle.marca || '');
  if (!modelWords.length || !modelWords.every(word => searchableTitle.includes(word))) return null;
  const brandInTitle = brandWords.length && brandWords.every(word => searchableTitle.includes(word));
  const brandInMetadata = brandWords.length && brandWords.every(word => searchableAll.includes(word));
  // Modelo deve aparecer no próprio nome do arquivo; marca, ano e versão
  // refinam a escolha quando a fonte disponibiliza esses dados.
  let score = 100 + (brandInTitle ? 30 : brandInMetadata ? 15 : 0);
  const year = String(vehicle.ano || '').trim();
  const yearMatch = !!year && new RegExp(`(^|\\D)${year}(\\D|$)`).test(searchableAll);
  if (yearMatch) score += 20;
  const versionWords = photoWords(vehicle.versao || '').filter(w => w.length > 2 && !/^\d+(\.\d+)?$/.test(w));
  const versionMatches = versionWords.filter(word => searchableAll.includes(word)).length;
  score += Math.min(15, versionMatches * 5);
  // Prefere arquivos que pareçam fotografias do veículo, não logotipos ou desenhos.
  if (/logo|emblem|badge|manual|brochure|diagram|drawing|render|toy|miniature/.test(searchableTitle)) score -= 80;
  if (/photo|photograph|automobile|vehicle|car|truck|motorcycle|van/.test(searchableAll)) score += 2;
  return {
    url: info.thumburl,
    title: page.title,
    page: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || '').replace(/ /g, '_'))}`,
    author: cleanMeta(meta.Artist?.value || meta.Credit?.value || ''),
    license: cleanMeta(meta.LicenseShortName?.value || 'Consultar licença'),
    score,
    yearMatch
  };
}
async function requestCommonsCandidates(query) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6', gsrlimit: '30', prop: 'imageinfo',
    iiprop: 'url|extmetadata', iiurlwidth: '1000', format: 'json', origin: '*'
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
  if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
  const data = await response.json();
  return Object.values(data.query?.pages || {});
}
async function searchCommonsPhoto(vehicle) {
  const key = photoKey(vehicle);
  if (photoCache.has(key)) return photoCache.get(key);
  const model = String(vehicle.modelo || '').trim();
  const brand = String(vehicle.marca || '').trim();
  if (!model || !brand) { photoCache.set(key, null); return null; }
  try {
    // Busca mais específica primeiro. A segunda consulta amplia resultados,
    // mas continua exigindo o nome do modelo no título do arquivo.
    const queries = [
      `"${brand} ${model}" ${vehicle.ano || ''} ${vehicle.versao || ''}`,
      `"${brand} ${model}"`
    ];
    let candidates = [];
    for (const query of queries) {
      const pages = await requestCommonsCandidates(query);
      candidates = pages.map(page => scoreCommonsCandidate(page, vehicle)).filter(Boolean);
      if (candidates.length) break;
    }
    candidates.sort((a, b) => b.score - a.score);
    // Reserva uma URL para cada registro. Isso evita que cards diferentes
    // recebam a mesma foto quando há outras imagens disponíveis do modelo.
    const found = candidates.find(item => {
      const owner = claimedPhotoUrls.get(item.url);
      return !owner || owner === key;
    }) || null;
    if (found) claimedPhotoUrls.set(found.url, key);
    photoCache.set(key, found);
    return found;
  } catch (error) {
    console.warn('Não foi possível buscar foto no Wikimedia Commons:', vehicle.marca, vehicle.modelo, error);
    photoCache.set(key, null);
    return null;
  }
}
function applyPhotoToBoxes(vehicle, photo) {
  if (!photo) return;
  const selector = `.vehiclePhoto[data-auto-photo="${CSS.escape(String(vehicle.id || ''))}"]`;
  document.querySelectorAll(selector).forEach(box => {
    box.classList.remove('noPhoto');
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = `${vehicle.marca} ${vehicle.modelo} ${vehicle.ano || ''}`;
    img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.onerror = () => { box.classList.add('noPhoto'); img.remove(); };
    box.replaceChildren(img);
    const credit = document.createElement('div'); credit.className = 'imageCredit';
    const link = document.createElement('a'); link.href = photo.page; link.target = '_blank'; link.rel = 'noopener';
    const matchText = photo.yearMatch ? 'ano identificado no arquivo' : 'ano/versão não confirmados';
    link.textContent = `Foto: ${photo.author || 'autor informado na fonte'} · ${photo.license} · Wikimedia Commons`;
    credit.append(link);
    const note = document.createElement('span'); note.textContent = ` · ${matchText}`; credit.append(note);
    box.insertAdjacentElement('afterend', credit);
  });
}
function pumpPhotoQueue() {
  while (photoWorkers < 3 && photoQueue.length) {
    const task = photoQueue.shift(); photoWorkers++;
    searchCommonsPhoto(task.vehicle).then(photo => applyPhotoToBoxes(task.vehicle, photo))
      .finally(() => { photoWorkers--; pumpPhotoQueue(); });
  }
}
function hydratePhotos(root = document) {
  const queued = new Set();
  root.querySelectorAll('.vehiclePhoto[data-auto-photo]').forEach(box => {
    const id = box.getAttribute('data-auto-photo');
    const vehicle = vehicles.find(item => String(item.id || '') === id);
    if (!vehicle || vehicle.imagem_url || vehicle.foto_url || vehicle.imagem) return;
    const key = photoKey(vehicle);
    if (queued.has(key)) return;
    queued.add(key);
    if (photoCache.has(key)) applyPhotoToBoxes(vehicle, photoCache.get(key));
    else photoQueue.push({ vehicle });
  });
  pumpPhotoQueue();
}
function render() {
  const result = filtered();
  $('#resultCount').textContent = `${result.length.toLocaleString('pt-BR')} versão(s) encontrada(s)`;
  $('#cards').className = 'cards ' + (view === 'list' ? 'list' : '');
  $('#empty').hidden = result.length > 0;
  $('#cards').innerHTML = result.slice(0,300).map(vehicle => {
    const index = vehicles.indexOf(vehicle);
    const consumption = vehicle.combustivel === 'Elétrico' ? `${nfmt(vehicle.cidade_km_lequivalente)} km/le` : vehicle.cidade ? `${nfmt(vehicle.cidade)} km/l` : '—';
    return `<article class="vehicle" data-open="${index}">${photoMarkup(vehicle)}<div class="vehicleTop"><span class="make">${esc(vehicle.marca)}</span><span class="year">${esc(vehicle.ano)}</span></div><h3>${esc(vehicle.modelo)}</h3><div class="version">${esc(vehicle.versao || 'Versão não informada')}</div><div class="chips"><span class="chip">${esc(MAIN_LABELS[vehicle.categoria_principal] || vehicle.categoria || 'Categoria n/i')}</span><span class="chip">${esc(vehicle.origem === 'nacional' ? 'Nacional' : vehicle.origem === 'importado' ? 'Importado' : 'Origem não informada')}</span><span class="chip">${esc(vehicle.combustivel || 'Combustível n/i')}</span>${vehicle.status_dados === 'demonstracao_nao_validado' ? '<span class="chip demoChip">EXEMPLO</span>' : ''}</div><div class="specMini"><div><span>Motor</span><b>${esc(vehicle.motor || '—')}</b></div><div><span>Potência</span><b>${esc(fmt(vehicle.potencia))}${vehicle.potencia ? ' cv' : ''}</b></div><div><span>Consumo cidade</span><b>${esc(consumption)}</b></div></div><div class="vehicleActions"><span class="detailsLink">VER FICHA COMPLETA →</span><label class="compareCheck" onclick="event.stopPropagation()"><input type="checkbox" data-select="${index}" ${selected.has(index) ? 'checked' : ''}> Comparar</label></div></article>`;
  }).join('');
  if (result.length > 300) $('#resultCount').textContent += ' · exibindo os primeiros 300 resultados';
  updateCompare();
  hydratePhotos($('#cards'));
}
function detail(vehicle) {
  const fields = [
    ['Ano-modelo',vehicle.ano],['Categoria principal',MAIN_LABELS[vehicle.categoria_principal] || 'Não informada'],['Categoria',vehicle.categoria],
    ['Origem',vehicle.origem === 'nacional' ? 'Nacional' : vehicle.origem === 'importado' ? 'Importado' : 'Não informada'],
    ['Combustível',vehicle.combustivel],['Motor',vehicle.motor],['Potência',vehicle.potencia ? `${vehicle.potencia} cv` : null],
    ['Torque',vehicle.torque ? `${vehicle.torque} kgfm` : null],['Câmbio',vehicle.cambio],['Tração',vehicle.tracao],
    ['Cilindrada',vehicle.cilindrada ? `${vehicle.cilindrada} cc` : null],['Comprimento',vehicle.comprimento ? `${nfmt(vehicle.comprimento)} mm` : null],
    ['Largura',vehicle.largura ? `${nfmt(vehicle.largura)} mm` : null],['Altura',vehicle.altura ? `${nfmt(vehicle.altura)} mm` : null],
    ['Entre-eixos',vehicle.entreeixos ? `${nfmt(vehicle.entreeixos)} mm` : null],['Porta-malas',vehicle.portamalas ? `${nfmt(vehicle.portamalas)} litros` : null],
    ['Peso',vehicle.peso ? `${nfmt(vehicle.peso)} kg` : null],['Consumo cidade',vehicle.cidade ? `${nfmt(vehicle.cidade)} km/l` : null],
    ['Consumo estrada',vehicle.estrada ? `${nfmt(vehicle.estrada)} km/l` : null],
    ['Eficiência elétrica cidade',vehicle.cidade_km_lequivalente ? `${nfmt(vehicle.cidade_km_lequivalente)} km/le` : null],
    ['Eficiência elétrica estrada',vehicle.estrada_km_lequivalente ? `${nfmt(vehicle.estrada_km_lequivalente)} km/le` : null],
    ['Autonomia elétrica',vehicle.autonomia_eletrica_km ? `${nfmt(vehicle.autonomia_eletrica_km)} km` : null],
    ['Carga útil',vehicle.carga_util ? `${nfmt(vehicle.carga_util)} kg` : null],['Capacidade',vehicle.capacidade]
  ];
  $('#modalBody').innerHTML = `<div class="detailHead"><span class="make">${esc(vehicle.marca)} · ${esc(vehicle.ano)}</span><h2>${esc(vehicle.modelo)}</h2><p>${esc(vehicle.versao)}</p></div>${photoMarkup(vehicle,true)}<div class="detailGrid">${fields.map(([label,value]) => `<div class="detailItem"><span>${esc(label)}</span><b>${esc(fmt(value))}</b></div>`).join('')}</div><p class="sourceNote"><b>Fonte técnica:</b> ${esc(vehicle.fonte || 'Fonte não informada')} ${vehicle.url_fonte ? `<br><a href="${esc(vehicle.url_fonte)}" target="_blank" rel="noopener">Consultar fonte ↗</a>` : ''}<br><b>Status:</b> ${esc(vehicle.status_dados || 'Não classificado')}. ${vehicle.status_dados === 'demonstracao_nao_validado' ? '<b>ATENÇÃO: registro demonstrativo, não utilizar como especificação técnica validada.</b>' : 'Campos sem confirmação permanecem sem preenchimento.'}</p>`;
  openModal();
  hydratePhotos($('#modalBody'));
}
function openModal() { $('#modal').classList.add('open'); $('#modal').setAttribute('aria-hidden','false'); }
function closeModal() { $('#modal').classList.remove('open'); $('#modal').setAttribute('aria-hidden','true'); }
function updateCompare() {
  $('#compareCount').textContent = selected.size;
  $('#compareText').textContent = `${selected.size} veículo(s) selecionado(s)`;
  $('#compareBar').hidden = selected.size === 0;
}
function compare() {
  if (selected.size < 2) { alert('Selecione pelo menos 2 veículos.'); return; }
  const chosen = [...selected].map(index => vehicles[index]);
  const keys = [['Marca','marca'],['Modelo','modelo'],['Versão','versao'],['Ano','ano'],['Categoria principal','categoria_principal'],['Categoria','categoria'],['Origem','origem'],['Combustível','combustivel'],['Motor','motor'],['Cilindrada (cc)','cilindrada'],['Potência (cv)','potencia'],['Torque (kgfm)','torque'],['Câmbio','cambio'],['Tração','tracao'],['Comprimento (mm)','comprimento'],['Largura (mm)','largura'],['Altura (mm)','altura'],['Entre-eixos (mm)','entreeixos'],['Porta-malas (L)','portamalas'],['Peso (kg)','peso'],['Consumo cidade','cidade'],['Consumo estrada','estrada']];
  $('#modalBody').innerHTML = `<div class="detailHead"><p class="eyebrow">COMPARATIVO</p><h2>Compare os veículos</h2><p>Campos sem dados disponíveis aparecem como —.</p></div><div style="overflow:auto;margin-top:20px"><table class="compareTable"><thead><tr><th>Especificação</th>${chosen.map(v => `<th>${esc(v.marca+' '+v.modelo+' '+v.versao)}</th>`).join('')}</tr></thead><tbody>${keys.map(([label,key]) => `<tr><th>${label}</th>${chosen.map(v => `<td>${esc(fmt(key === 'categoria_principal' ? MAIN_LABELS[v[key]] : v[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  openModal();
}
['#q','#mainCategory','#brand','#category','#origin','#fuel','#year','#sort'].forEach(selector => { const element = $(selector); if (element) element.addEventListener(selector === '#q' ? 'input' : 'change', render); });
$('#clearFilters').onclick = () => { ['#q','#mainCategory','#brand','#category','#origin','#fuel','#year'].forEach(selector => { if ($(selector)) $(selector).value = ''; }); $('#sort').value = 'name'; render(); };
$('#cards').addEventListener('click', event => { if (event.target.closest('[data-select]')) return; const card = event.target.closest('[data-open]'); if (card) detail(vehicles[Number(card.dataset.open)]); });
$('#cards').addEventListener('change', event => {
  if (!event.target.matches('[data-select]')) return;
  const index = Number(event.target.dataset.select);
  if (event.target.checked) { if (selected.size >= 3) { event.target.checked = false; alert('É possível comparar até 3 veículos por vez.'); return; } selected.add(index); }
  else selected.delete(index);
  updateCompare();
});
document.querySelectorAll('[data-close]').forEach(element => element.onclick = closeModal);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
$('#doCompare').onclick = compare; $('#compareTop').onclick = compare;
$('#clearCompare').onclick = () => { selected.clear(); render(); };
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button)); render(); });

// Busca guiada em quatro etapas: tipo -> marca -> modelo -> ano.
const CASCADE_LABELS = {motos:'Moto',carros:'Carro',vans_utilitarios:'Van / utilitário',caminhoes:'Caminhão'};
function setSelectOptions(select, values, placeholder) {
  select.innerHTML = '';
  const first = document.createElement('option'); first.value = ''; first.textContent = placeholder; select.append(first);
  values.forEach(value => { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value); select.append(option); });
}
function cascadeResetFrom(level) {
  const order = ['searchBrand','searchModel','searchYear'];
  const placeholders = ['Selecione primeiro o tipo','Selecione primeiro a marca','Selecione primeiro o modelo'];
  const start = Math.max(0, level - 1);
  for (let i=start;i<order.length;i++) { const el = document.getElementById(order[i]); setSelectOptions(el,[],placeholders[i]); el.disabled = true; }
  updateCascadeActions();
}
function initCascadeSearch() {
  const type = $('#searchType'), brand = $('#searchBrand'), model = $('#searchModel'), year = $('#searchYear');
  if (!type || !brand || !model || !year) return;
  const types = [...new Set(vehicles.map(v=>v.categoria_principal).filter(Boolean))].sort((a,b)=>(CASCADE_LABELS[a]||a).localeCompare(CASCADE_LABELS[b]||b,'pt-BR'));
  setSelectOptions(type,types.map(value=>({value,label:CASCADE_LABELS[value]||MAIN_LABELS[value]||value})).map(x=>x.value), 'Selecione o tipo');
  [...type.options].forEach(option=>{ if(option.value) option.textContent=CASCADE_LABELS[option.value]||MAIN_LABELS[option.value]||option.value; });
  type.addEventListener('change',()=>{
    cascadeResetFrom(1);
    if(!type.value){updateCascadeActions();return;}
    const brands=[...new Set(vehicles.filter(v=>v.categoria_principal===type.value).map(v=>v.marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    setSelectOptions(brand,brands,'Selecione a marca'); brand.disabled=false; updateCascadeActions();
  });
  brand.addEventListener('change',()=>{
    cascadeResetFrom(2);
    if(!brand.value){updateCascadeActions();return;}
    const models=[...new Set(vehicles.filter(v=>v.categoria_principal===type.value&&v.marca===brand.value).map(v=>v.modelo).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    setSelectOptions(model,models,'Selecione o modelo'); model.disabled=false; updateCascadeActions();
  });
  model.addEventListener('change',()=>{
    cascadeResetFrom(3);
    if(!model.value){updateCascadeActions();return;}
    const years=[...new Set(vehicles.filter(v=>v.categoria_principal===type.value&&v.marca===brand.value&&v.modelo===model.value).map(v=>v.ano).filter(v=>v!==null&&v!==undefined&&v!==''))].sort((a,b)=>Number(b)-Number(a));
    setSelectOptions(year,years,'Selecione o ano'); year.disabled=false; updateCascadeActions();
  });
  year.addEventListener('change',updateCascadeActions);
  $('#viewTech').addEventListener('click',()=>{const vehicle=getCascadeVehicle();if(vehicle)detail(vehicle);});
  $('#compareVehicle').addEventListener('click',()=>{
    const vehicle=getCascadeVehicle(); if(!vehicle)return;
    const index=vehicles.indexOf(vehicle); if(!selected.has(index) && selected.size>=3){alert('É possível comparar até 3 veículos por vez. Limpe a comparação para começar outra.');return;} selected.add(index); updateCompare();
    const count=selected.size;
    if(count>=2){compare();$('#cascadeHint').textContent=`${count} veículos adicionados à comparação.`;}
    else { $('#cascadeHint').textContent='Primeiro veículo adicionado. Selecione outro veículo e clique em “Comparar Veículo”.'; resetCascadeAfterCompare(); }
  });
  updateCascadeActions();
}
function getCascadeMatches(){
  const type=$('#searchType')?.value,brand=$('#searchBrand')?.value,model=$('#searchModel')?.value,year=$('#searchYear')?.value;
  if(!type||!brand||!model||!year)return [];
  return vehicles.filter(v=>v.categoria_principal===type&&v.marca===brand&&v.modelo===model&&String(v.ano)===String(year));
}
function getCascadeVehicle(){const matches=getCascadeMatches();return matches.sort((a,b)=>String(a.versao||'').localeCompare(String(b.versao||''),'pt-BR'))[0]||null;}
function updateCascadeActions(){
  const ready=getCascadeMatches().length>0;
  $('#viewTech').disabled=!ready; $('#compareVehicle').disabled=!ready;
  if(!ready) $('#cascadeHint').textContent='Preencha as quatro opções para liberar as ações.';
  else {const count=getCascadeMatches().length;$('#cascadeHint').textContent=count>1?`${count} versões encontradas para este ano; será aberta a primeira versão em ordem alfabética.`:'Veículo selecionado. Escolha uma das ações.';}
}
function resetCascadeAfterCompare(){
  $('#searchType').value=''; cascadeResetFrom(1); $('#searchBrand').disabled=true; $('#searchModel').disabled=true; $('#searchYear').disabled=true; updateCascadeActions();
  $('#cascadeHint').textContent='Veículo adicionado. Selecione o próximo para completar a comparação.';
}
init();
