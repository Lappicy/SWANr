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

function resetarConsulta() {
    document.getElementById('searchForm').reset();
    limparArea();
    toggleSubproducts();
    document.getElementById('date-msg').classList.add('hidden');
    document.getElementById('results-list').innerHTML = "";
    document.getElementById('results-meta').classList.add('hidden');
    document.getElementById('btn-download-selected').classList.add('hidden');
    document.getElementById('tab-resultados').classList.add('disabled');
    switchTab('swot');
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
    msg.style.color = "#856404"; 
    msg.style.backgroundColor = "#fff3cd";
    msg.style.borderColor = "#ffeeba";

    if ((d1 && d1 < min) || (d2 && d2 < min)) {
        alert("O satélite não estava lançado/disponível antes de 15/02/2022.");
        if(d1<min) s.value=""; if(d2<min) e.value=""; return;
    }

    if (d1 && d2 && d1 > d2) {
        msg.innerHTML = "❌ <strong>Erro:</strong> A data está invertida. A data inicial deve ser anterior à data final.";
        msg.style.color = "#721c24";
        msg.style.backgroundColor = "#f8d7da";
        msg.style.borderColor = "#f5c6cb";
        msg.classList.remove('hidden');
        e.value = ""; 
        return;
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

function limparArea() {
    limparTudoMenos('reset'); 
    updateCoords(null);
}

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
    
    if (stateLayer) {
        map.removeLayer(stateLayer);
        stateLayer = null;
    }

    limparTudoMenos('state');
    if(!uf) { updateCoords(null); return; }
    startLoading();
    
    fetch(`/limites/estado/${uf}`).then(r=>r.json()).then(d=>{
        if(d.error) {
            alert("Erro do Sistema: " + d.error + "\n\n(Verifique se você colocou o arquivo BR_UF_2024 na pasta 'camadas').");
            throw d.error;
        }
        stateLayer = L.geoJSON(d.geojson, {style: {color: '#0079c1', weight: 2, fillOpacity: 0.1}}).addTo(map);
        const b = d.bbox; 
        const bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
        map.fitBounds(bounds);
        updateCoords(bounds);
    }).catch(e=>console.error(e)).finally(()=>stopLoading());
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
                    let html = `<div class="custom-popup-wrapper">
                                    <div class="custom-popup-header">${nomeExibicao}</div>
                                    <table class="custom-popup-table">`;
                                    
                    for (const [key, value] of Object.entries(f.properties)) {
                        let valDisplay = (value === null || value === '') ? '-' : value;
                        html += `<tr><td class="custom-popup-key">${key}</td><td class="custom-popup-value">${valDisplay}</td></tr>`;
                    }
                    html += `</table></div>`;
                    
                    let alturaMax = window.innerHeight * 0.6;
                    layer.bindPopup(html, { maxHeight: alturaMax, maxWidth: 300 });
                }
            }
        });
        activeLayers[nomeArquivo] = layer; map.addLayer(layer); checkbox.disabled = false; stopLoading();
    }).catch(e => { alert("Erro camada."); checkbox.checked = false; checkbox.disabled = false; stopLoading(); });
}

// ==========================================
// FUNÇÕES DE BUSCA E RESULTADOS ATUALIZADAS
// ==========================================
function buscarDados() {
    const p = document.getElementById('produto').value;
    if(!p) { alert("Selecione um produto antes de consultar."); return; }
    
    const sDate = document.getElementById('start_date').value;
    const eDate = document.getElementById('end_date').value;
    
    if(!sDate || !eDate) {
        alert("Por favor, preencha a Data Inicial e a Data Final.");
        return;
    }
    if(new Date(sDate) > new Date(eDate)) {
        alert("As datas estão invertidas. Corrija o período antes de consultar.");
        return;
    }
    
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
        
        let totalBytes = 0;
        d.results.forEach(f => { if (f.size && f.size !== "N/A") { totalBytes += parseFloat(f.size); } });
        
        document.getElementById('total-count').innerText = d.results.length;
        document.getElementById('total-size').innerText = totalBytes.toFixed(2) + " MB";
        document.getElementById('results-meta').classList.remove('hidden');
        
        // --- NOVA LÓGICA DO BOTÃO DE RECORTE ---
        const shapeName = document.getElementById('uploadedShapeName').value;
        const stateUF = document.getElementById('brazil_states').value;
        // Identifica se recorta: Se tiver um upload, OU se tiver um estado selecionado que NÃO seja "BR"
        const willCrop = shapeName || (stateUF && stateUF !== 'BR');
        
        if(btnDown) {
            btnDown.classList.remove('hidden');
            if(willCrop) {
                btnDown.innerHTML = '<span class="material-symbols-outlined">content_cut</span> Recortar e Baixar Selecionados';
                btnDown.style.backgroundColor = '#e66a00';
            } else {
                btnDown.innerHTML = '<span class="material-symbols-outlined">download</span> Baixar Originais Selecionados';
                btnDown.style.backgroundColor = '#0079c1';
            }
        }
        // ---------------------------------------
        
        const selectAll = document.getElementById('select-all');
        if(selectAll) selectAll.checked = false;
        
        d.results.forEach((f, index) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            
            let html = `
                <div class="result-info">
                    <input type="checkbox" value="${f.download_link}" id="cb-${index}" onclick="verificarSelecao()"> 
                    <div class="result-text">
                        <div class="result-filename" title="${f.filename}">${f.filename}</div>
                        <div class="result-size">
                            ${f.size} MB
                            <span id="status-${index}" style="margin-left:10px; font-weight:bold;"></span>
                        </div>
                    </div>
                </div>
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

// ==========================================
// GERENCIADOR DE DOWNLOADS E RECORTES
// ==========================================
function baixarSelecionados() {
    const cbs = document.querySelectorAll('.result-item input:checked');
    if(cbs.length === 0) return;
    
    const shapeName = document.getElementById('uploadedShapeName').value;
    const stateUF = document.getElementById('brazil_states').value;
    const willCrop = shapeName || (stateUF && stateUF !== 'BR');
    const btn = document.querySelector('.btn-aneel.download');
    
    if(willCrop) {
        if(!confirm(`Você selecionou ${cbs.length} arquivos para recorte.\n\nO sistema vai baixar, recortar e salvar um por um no seu computador. Isso pode demorar.\n\nDeseja continuar?`)) return;
        
        btn.disabled = true;
        const textoOriginal = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Processando Recortes...';
        
        const tarefas = Array.from(cbs).map(c => ({
            url: c.value,
            statusId: c.id.replace('cb-', 'status-'),
            shape: shapeName,
            state: (stateUF !== 'BR') ? stateUF : ''
        }));
        
        processarFilaDownloads(tarefas, btn, textoOriginal);
        return;
    }

    if(btn) {
        btn.disabled = true;
        const textoOriginal = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Baixando...';
        
        const arquivos = Array.from(cbs).map(c => c.value);
        
        fetch('/baixar_selecionados', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({arquivos: arquivos})
        }).then(r=>r.json()).then(d=>{
            alert(d.message);
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }).catch(e => { 
            alert("Erro no download"); 
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        });
    }
}

async function processarFilaDownloads(tarefas, btn, textoOriginal) {
    for (const t of tarefas) { await baixarRecortado(t.url, t.statusId, t.shape, t.state); }
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
    alert("Processamento concluído!");
}

async function baixarRecortado(url, statusId, shape, stateUF) {
    const statusSpan = document.getElementById(statusId);

    if(statusSpan) {
        statusSpan.innerText = "⏳ Recortando...";
        statusSpan.style.color = "#e66a00";
    }

    try {
        const reqBody = { granule_url: url };
        if (shape) reqBody.shape_filename = shape;
        if (stateUF) reqBody.state_uf = stateUF;

        const r = await fetch('/download_cropped', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqBody)
        });
        
        if(r.ok) {
            const blob = await r.blob();
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(blob);
            
            let nomeOriginal = url.split('/').pop().split('?')[0];
            let nomeSemExtensao = nomeOriginal.substring(0, nomeOriginal.lastIndexOf('.')) || nomeOriginal;

            let ext = ".geojson";
            const u = url.toLowerCase();
            if(u.includes('.zip')) ext = ".zip"; 
            else if(u.includes('.nc')) ext = ".nc"; 
            else if(u.includes('.gpkg')) ext = ".gpkg";
            
            a.download = `recorte_${nomeSemExtensao}${ext}`;

            a.click();
            
            if(statusSpan) { statusSpan.innerText = "✅ Salvo"; statusSpan.style.color = "green"; }
        } else {
            const err = await r.json(); 
            if(statusSpan) { statusSpan.innerText = "❌ Falha"; statusSpan.style.color = "red"; statusSpan.title = err.error || "Erro desconhecido"; }
        }
    } catch(e) { 
        if(statusSpan) { statusSpan.innerText = "❌ Sem Conexão"; statusSpan.style.color = "red"; } 
    } 
}

// =========================================
//  LÓGICA DO POP-UP (MODAL)
// =========================================
function toggleModalButton() {
    const check = document.getElementById('check-terms');
    const btn = document.getElementById('btn-modal-ok');
    btn.disabled = !check.checked;
}

function closeModal() {
    const modal = document.getElementById('intro-modal');
    modal.classList.add('hidden');
}