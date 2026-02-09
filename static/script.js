var map = L.map('map', { zoomControl: false }).setView([-14.235, -51.925], 4); 
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
var street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OSM' });
var labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png');

satellite.addTo(map); labels.addTo(map);
L.control.layers({ "Satélite": satellite, "Ruas": street }, { "Rótulos": labels }, { position: 'topright' }).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

function startLoading() { document.getElementById('map').classList.add('map-loading'); }
function stopLoading() { document.getElementById('map').classList.remove('map-loading'); }

function switchTab(t) {
    document.querySelectorAll('.panel-body').forEach(e => e.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach(e => e.classList.remove('active'));
    document.getElementById('view-'+t).classList.remove('hidden');
    if(t=='swot') document.getElementById('tab-swot').classList.add('active');
    if(t=='camadas') document.getElementById('tab-camadas').classList.add('active');
    if(t=='referencias') document.getElementById('tab-referencias').classList.add('active');
    if(t=='resultados') document.getElementById('tab-resultados').classList.add('active');
}

function toggleSubproducts() {
    document.querySelectorAll('.sub-opts').forEach(e => e.classList.add('hidden'));
    document.querySelectorAll('.sub-opts select').forEach(s => s.disabled = true);
    
    const p = document.getElementById('produto').value;
    let divId = '';
    if (p === 'RiverSP') divId = 'sub-river';
    else if (p === 'LakeSP') divId = 'sub-lake';
    else if (p === 'Raster') divId = 'sub-raster';

    if(divId) {
        const d = document.getElementById(divId);
        d.classList.remove('hidden');
        d.querySelectorAll('select').forEach(s => s.disabled = false);
    }
}

function togglePanel() {
    const b = document.querySelector('.panel-body:not(.hidden)');
    const p = document.getElementById('main-panel');
    if(b.style.display !== 'none'){ b.style.display = 'none'; p.style.height = 'auto'; } 
    else { b.style.display = 'flex'; p.style.removeProperty('height'); }
}

function validarDatas() {
    const s = document.getElementById('start_date');
    const e = document.getElementById('end_date');
    const msg = document.getElementById('date-msg');
    const min = new Date('2022-02-15T00:00:00');
    const calValEnd = new Date('2023-07-26T23:59:59');

    let d1 = s.value ? new Date(s.value+'T00:00:00') : null;
    let d2 = e.value ? new Date(e.value+'T00:00:00') : null;

    msg.classList.add('hidden');
    if ((d1 && d1 < min) || (d2 && d2 < min)) {
        alert("O satélite não estava lançado/disponível antes de 15/02/2022.");
        if(d1<min) s.value=""; if(d2<min) e.value=""; return;
    }
    if ((d1 && d1 <= calValEnd) || (d2 && d2 <= calValEnd)) {
        msg.innerText = "⚠️ Esse período engloba a fase de Cal/Val.";
        msg.classList.remove('hidden');
    }
}

var drawnItems = new L.FeatureGroup(); map.addLayer(drawnItems);
var uploadedLayer = null;
var stateLayer = null;
var activeLayers = {}; 

var drawControl = new L.Control.Draw({
    draw: { polygon: false, polyline: false, circle: false, marker: false, circlemarker: false, rectangle: { shapeOptions: { color: '#0079c1' } } },
    edit: { featureGroup: drawnItems, remove: true },
    position: 'topright'
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (e) {
    limparTudoMenos('draw');
    drawnItems.addLayer(e.layer);
    updateCoords(e.layer.getBounds());
});
map.on(L.Draw.Event.DELETED, function() { updateCoords(null); });

function limparTudoMenos(tipo) {
    if(tipo !== 'draw') drawnItems.clearLayers();
    if(tipo !== 'upload') {
        if(uploadedLayer) map.removeLayer(uploadedLayer);
        document.getElementById('uploadedShapeName').value = "";
        document.getElementById('shapeStatus').innerText = "";
        document.getElementById('userShapeInput').value = "";
    }
    if(tipo !== 'state') {
        if(stateLayer) map.removeLayer(stateLayer);
        document.getElementById('brazil_states').value = "";
    }
}

function updateCoords(b) {
    if(!b) { ['lat_min','lat_max','lon_min','lon_max'].forEach(id=>document.getElementById(id).value=''); return; }
    document.getElementById('lat_min').value = b.getSouth().toFixed(4);
    document.getElementById('lat_max').value = b.getNorth().toFixed(4);
    document.getElementById('lon_min').value = b.getWest().toFixed(4);
    document.getElementById('lon_max').value = b.getEast().toFixed(4);
}

async function uploadShape() {
    const file = document.getElementById('userShapeInput').files[0];
    if (!file) return;
    limparTudoMenos('upload');
    startLoading();
    document.getElementById('shapeStatus').innerText = "Enviando...";
    const fd = new FormData(); fd.append('file', file);
    try {
        const r = await fetch('/upload_user_shape', { method: 'POST', body: fd });
        const d = await r.json();
        if(d.error) throw d.error;
        document.getElementById('uploadedShapeName').value = d.filename;
        document.getElementById('shapeStatus').innerText = "OK: " + d.filename;
        uploadedLayer = L.geoJSON(JSON.parse(d.geojson), { style: {color: 'orange', dashArray: '5,5'} }).addTo(map);
        map.fitBounds(uploadedLayer.getBounds());
        updateCoords(uploadedLayer.getBounds());
    } catch(e) { alert(e); document.getElementById('shapeStatus').innerText = "Erro"; }
    finally { stopLoading(); }
}

function aplicarFiltroEstado() {
    const uf = document.getElementById('brazil_states').value;
    limparTudoMenos('state');
    if(!uf) { updateCoords(null); return; }
    startLoading();
    fetch(`/limites/ibge/${uf}`).then(r=>r.json()).then(d=>{
        if(d.error) throw d.error;
        stateLayer = L.geoJSON(d.geojson, {style: {color: '#0079c1', weight: 1}}).addTo(map);
        const b = d.bbox; 
        const bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
        map.fitBounds(bounds);
        updateCoords(bounds);
    }).catch(e=>alert(e)).finally(()=>stopLoading());
}

function toggleCamada(checkbox, nomeArquivo, nomeExibicao, cor, tipo) {
    if (!checkbox.checked) {
        if (activeLayers[nomeArquivo]) map.removeLayer(activeLayers[nomeArquivo]);
        return;
    }
    if (activeLayers[nomeArquivo]) { map.addLayer(activeLayers[nomeArquivo]); return; }
    startLoading(); checkbox.disabled = true;
    fetch(`/camadas/${nomeArquivo}`).then(r => r.json()).then(data => {
        var layer = L.geoJSON(data, {
            style: function (f) { return { color: cor, weight: 3, opacity: 0.8, fillOpacity: 0.1 }; },
            pointToLayer: function (f, latlng) { return L.circleMarker(latlng, { radius: 5, fillColor: cor, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.9 }); },
            onEachFeature: function (f, layer) {
                if (f.properties) {
                    let html = `<div class="custom-popup-header">${nomeExibicao}</div><table class="custom-popup-table">`;
                    for (const [key, value] of Object.entries(f.properties)) html += `<tr><td class="custom-popup-key">${key}</td><td class="custom-popup-value">${value}</td></tr>`;
                    html += `</table>`; layer.bindPopup(html);
                }
            }
        });
        activeLayers[nomeArquivo] = layer; map.addLayer(layer); checkbox.disabled = false; stopLoading();
    }).catch(e => { alert("Erro camada."); checkbox.checked = false; checkbox.disabled = false; stopLoading(); });
}

function buscarDados() {
    const p = document.getElementById('produto').value;
    if(!p) { alert("Selecione um produto"); return; }
    
    switchTab('resultados');
    const list = document.getElementById('results-list');
    list.innerHTML = "";
    list.classList.add('hidden');
    
    document.getElementById('results-meta').classList.add('hidden');
    const btnDown = document.getElementById('btn-download-selected');
    if(btnDown) btnDown.classList.add('hidden');
    
    const loader = document.getElementById('progress-container');
    loader.classList.remove('hidden');
    const bar = document.getElementById('progress-fill');
    bar.style.width = "0%";
    bar.classList.remove('progress-filling');
    void bar.offsetWidth; 
    bar.classList.add('progress-filling');

    const formData = new FormData(document.getElementById('searchForm'));
    fetch('/buscar_dados', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(Object.fromEntries(formData))
    }).then(r=>r.json()).then(d=>{
        loader.classList.add('hidden');
        list.classList.remove('hidden');
        
        if(d.status !== 'success' || d.results.length === 0) { 
            list.innerHTML = "<p style='text-align:center; padding:20px;'>Nada encontrado.</p>"; 
            return; 
        }
        
        // CALCULO DO TOTAL DE MB
        let totalBytes = 0;
        d.results.forEach(f => {
            if (f.size && f.size !== "N/A") {
                // Remove " MB" e converte
                totalBytes += parseFloat(f.size);
            }
        });
        
        document.getElementById('total-count').innerText = d.results.length;
        document.getElementById('total-size').innerText = totalBytes.toFixed(2) + " MB";
        document.getElementById('results-meta').classList.remove('hidden');
        if(btnDown) btnDown.classList.remove('hidden');
        
        // Reseta checkbox "Selecionar Todos"
        const selectAll = document.getElementById('select-all');
        if(selectAll) selectAll.checked = false;
        
        const shapeName = document.getElementById('uploadedShapeName').value;
        
        d.results.forEach(f => {
            const item = document.createElement('div');
            item.className = 'result-item';
            
            let acaoBotao = "";
            let textoBotao = "";
            let corBotao = "";
            
            if(shapeName) {
                textoBotao = "✂️ Recortar e Baixar";
                acaoBotao = `onclick="baixarRecortado('${f.download_link}')"`;
                corBotao = "color: #e66a00;";
            } else {
                textoBotao = "⬇️ Baixar Original";
                acaoBotao = `onclick="window.open('${f.download_link}', '_blank')"`;
                corBotao = "color: #0079c1;";
            }

            let html = `
                <div class="result-info">
                    <input type="checkbox" value="${f.download_link}" onclick="verificarSelecao()"> 
                    <div class="result-text">
                        <div class="result-filename" title="${f.filename}">${f.filename}</div>
                        <div class="result-size">${f.size}</div>
                    </div>
                </div>
                <button class="btn-text btn-action" style="${corBotao}" ${acaoBotao}>${textoBotao}</button>
            `;
            item.innerHTML = html;
            list.appendChild(item);
        });
        verificarSelecao();
    }).catch(e=>{
        console.error(e);
        loader.classList.add('hidden');
        list.classList.remove('hidden');
        list.innerHTML="<p style='text-align:center; color:red;'>Erro na busca.</p>";
    });
}

function verificarSelecao() {
    const cbs = document.querySelectorAll('.result-item input:checked');
    const btn = document.querySelector('.btn-aneel.download');
    if(btn) btn.disabled = (cbs.length === 0);
}

function toggleSelectAll() {
    const sa = document.getElementById('select-all');
    if(!sa) return;
    const state = sa.checked;
    const checkboxes = document.querySelectorAll('.result-item input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = state);
    verificarSelecao();
}

function baixarSelecionados() {
    const cbs = document.querySelectorAll('.result-item input:checked');
    if(cbs.length === 0) return;
    
    const shapeName = document.getElementById('uploadedShapeName').value;
    if(shapeName) {
        if(!confirm(`Você selecionou ${cbs.length} arquivos para recorte. Isso pode demorar.\n\nDeseja continuar?`)) return;
        const links = Array.from(cbs).map(c => c.value);
        processarFilaDownloads(links);
        return;
    }

    const btn = document.querySelector('.btn-aneel.download');
    if(btn) btn.disabled = true;
    
    const arquivos = Array.from(cbs).map(c => c.value);
    
    fetch('/baixar_selecionados', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({arquivos: arquivos})
    }).then(r=>r.json()).then(d=>{
        alert(d.message);
        if(btn) btn.disabled = false;
    }).catch(e => { alert("Erro no download"); if(btn) btn.disabled = false; });
}

async function processarFilaDownloads(links) {
    for (const url of links) {
        await baixarRecortado(url);
    }
}

async function baixarRecortado(url) {
    const shape = document.getElementById('uploadedShapeName').value;
    let btn = event ? event.target : null;
    let txtOriginal = "";
    if(btn && btn.tagName === 'BUTTON') { txtOriginal = btn.innerText; btn.innerText = "⏳"; btn.disabled=true; }

    try {
        const r = await fetch('/download_cropped', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({granule_url: url, shape_filename: shape})
        });
        if(r.ok) {
            const blob = await r.blob();
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(blob);
            let ext = ".geojson";
            const u = url.toLowerCase();
            if(u.endsWith('.zip')) ext = ".zip"; else if(u.endsWith('.nc')) ext = ".nc"; else if(u.endsWith('.gpkg')) ext = ".gpkg";
            a.download = `recortado_${Math.floor(Math.random()*1000)}${ext}`;
            a.click();
            if(btn) btn.innerText = "✅";
        } else {
            const err = await r.json(); 
            if(btn) { alert("Erro: " + err.error); btn.innerText = "❌"; }
        }
    } catch(e) { if(btn) { alert("Erro conexão"); btn.innerText = "❌"; } }
    finally { if(btn) setTimeout(()=> { btn.innerText=txtOriginal; btn.disabled=false; }, 3000); }
}