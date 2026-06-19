var map = L.map('map', { zoomControl: false }).setView([-14.235, -51.925], 4); 
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
var street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OSM' });
var labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png');

satellite.addTo(map); labels.addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(map);

var CoordControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        var container = L.DomUtil.create('div', 'coord-display leaflet-control');
        container.innerHTML = '<span class="material-symbols-outlined">filter_center_focus</span><span id="map-coords">0,000 0,000 Graus</span>';
        return container;
    }
});
map.addControl(new CoordControl());

map.on('mousemove', function(e) {
    const lat = e.latlng.lat.toFixed(3).replace('.', ',');
    const lng = e.latlng.lng.toFixed(3).replace('.', ',');
    const coordSpan = document.getElementById('map-coords');
    if(coordSpan) coordSpan.innerText = `${lng} ${lat} Graus`;
});

function trocarBasemap(tipo) {
    if(tipo === 'sat') {
        map.addLayer(satellite);
        map.addLayer(labels);
        map.removeLayer(street);
    } else {
        map.addLayer(street);
        map.removeLayer(satellite);
        map.removeLayer(labels);
    }
}

document.getElementById('map').style.cursor = 'pointer';

function startLoading() { document.getElementById('map').classList.add('map-loading'); }
function stopLoading() { document.getElementById('map').classList.remove('map-loading'); }

function switchTab(t) {
    const p = document.getElementById('main-panel');
    const clickedNav = document.getElementById('nav-'+t);
    const isAlreadyActive = clickedNav && clickedNav.classList.contains('active');

    if (isAlreadyActive && p.style.display !== 'none') {
        p.style.display = 'none';
        return; 
    }

    p.style.display = 'flex'; 
    p.style.removeProperty('height');

    document.querySelectorAll('.panel-body').forEach(e => {
        e.classList.add('hidden');
        e.style.display = ''; 
    });
    
    document.querySelectorAll('.nav-item:not(#nav-manual)').forEach(e => e.classList.remove('active'));
    
    document.getElementById('view-'+t).classList.remove('hidden');
    if(clickedNav) clickedNav.classList.add('active');
}

function toggleManual() {
    const panel = document.getElementById('manual-panel');
    const btn = document.getElementById('nav-manual');
    
    if(panel.classList.contains('open')) {
        panel.classList.remove('open');
        btn.classList.remove('active');
    } else {
        panel.classList.add('open');
        btn.classList.add('active');
    }
}

function resetarConsulta() {
    document.getElementById('searchForm').reset();
    limparArea();
    toggleSubproducts();
    document.getElementById('date-msg').classList.add('hidden');
    document.getElementById('results-list').innerHTML = "";
    document.getElementById('results-meta').classList.add('hidden');
    document.getElementById('btn-download-selected').classList.add('hidden');
    document.getElementById('nav-resultados').classList.add('disabled');
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
        uploadedLayer = L.geoJSON(JSON.parse(d.geojson), { interactive: false, style: {color: 'orange', dashArray: '5,5'} }).addTo(map);
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
            alert("Erro do Sistema: " + d.error);
            throw d.error;
        }
        stateLayer = L.geoJSON(d.geojson, { interactive: false, style: {color: '#0079c1', weight: 2, fillOpacity: 0.1}}).addTo(map);
        const b = d.bbox; 
        const bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
        map.fitBounds(bounds);
        updateCoords(bounds);
    }).catch(e=>console.error(e)).finally(()=>stopLoading());
}

function toggleCamada(checkbox, nomeArquivo, nomeExibicao, cor, tipo) {
    if (!checkbox.checked) {
        if (activeLayers[nomeArquivo]) {
            map.removeLayer(activeLayers[nomeArquivo]);
            delete activeLayers[nomeArquivo]; 
        }
        return;
    }
    if (activeLayers[nomeArquivo]) { map.addLayer(activeLayers[nomeArquivo]); return; }
    startLoading(); checkbox.disabled = true;
    
    fetch(`/camadas/${nomeArquivo}`).then(r => r.json()).then(data => {
        var layer = L.geoJSON(data, {
            customTitle: nomeExibicao,
            interactive: false,
            style: function (f) { return { color: cor, weight: 3, opacity: 0.8, fillOpacity: 0.1 }; },
            pointToLayer: function (f, latlng) { 
                return L.circleMarker(latlng, { radius: 5, fillColor: cor, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.9, interactive: false }); 
            }
        });
        activeLayers[nomeArquivo] = layer; map.addLayer(layer); checkbox.disabled = false; stopLoading();
    }).catch(e => { alert("Erro camada."); checkbox.checked = false; checkbox.disabled = false; stopLoading(); });
}

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
    
    document.getElementById('nav-resultados').classList.remove('disabled');
    
    const loader = document.getElementById('progress-container');
    loader.classList.remove('hidden');
    const bar = document.getElementById('progress-fill');
    bar.style.width = "0%";
    bar.classList.remove('progress-filling');
    void bar.offsetWidth; 
    bar.classList.add('progress-filling');

    const formData = new FormData(document.getElementById('searchForm'));
    const reqData = Object.fromEntries(formData);
    reqData['shape_filename'] = document.getElementById('uploadedShapeName').value;
    reqData['state_uf'] = document.getElementById('brazil_states').value;

    fetch('/buscar_dados', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(reqData)
    }).then(async r => {
        if (!r.ok) {
            let text = await r.text();
            throw new Error(`Falha do Servidor (${r.status}): A área pode ser muito complexa ou a NASA está demorando a responder.`);
        }
        return r.json();
    }).then(d=>{
        loader.classList.add('hidden');
        list.classList.remove('hidden');
        
        if(d.status !== 'success' || !d.results || d.results.length === 0) { 
            list.innerHTML = "<p style='text-align:center; padding:20px; color:#00509e;'>Nada encontrado.</p>"; 
            return; 
        }
        
        let totalBytes = 0;
        d.results.forEach(f => { if (f.size && f.size !== "N/A") { totalBytes += parseFloat(f.size); } });
        
        document.getElementById('total-count').innerText = d.results.length;
        document.getElementById('total-size').innerText = totalBytes.toFixed(2) + " MB";
        document.getElementById('results-meta').classList.remove('hidden');
        
        const shapeName = document.getElementById('uploadedShapeName').value;
        const stateUF = document.getElementById('brazil_states').value;
        const latMinVal = document.getElementById('lat_min').value;
        const willCrop = shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== "";
        
        if(btnDown) {
            btnDown.classList.remove('hidden');
            if(willCrop) {
                btnDown.innerHTML = '<span class="material-symbols-outlined">content_cut</span> Recortar e Baixar Selecionados';
                btnDown.style.backgroundColor = '#e66a00';
            } else {
                btnDown.innerHTML = '<span class="material-symbols-outlined">download</span> Baixar Originais Selecionados';
                btnDown.style.backgroundColor = '#00509e';
            }
        }
        
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
        list.innerHTML=`<div style="padding:15px; text-align:center; color:#721c24; background-color:#f8d7da; border: 1px solid #f5c6cb; border-radius: 5px; margin: 10px;">
                        <span class="material-symbols-outlined" style="font-size:30px; margin-bottom:5px;">error</span><br>
                        <b>Erro na busca!</b><br><span style="font-size:0.85rem;">${e.message}</span>
                        </div>`;
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
    const stateUF = document.getElementById('brazil_states').value;
    const latMinVal = document.getElementById('lat_min').value;
    const willCrop = shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== "";
    const btn = document.querySelector('.btn-aneel.download');
    
    let totalSizeMB = 0;
    cbs.forEach(cb => {
        const sizeDiv = cb.closest('.result-info').querySelector('.result-size');
        if (sizeDiv) {
            const text = sizeDiv.innerText || sizeDiv.textContent;
            const match = text.match(/([\d.]+)\s*MB/);
            if (match && match[1]) {
                totalSizeMB += parseFloat(match[1]);
            }
        }
    });

    let sizeDisplay = "";
    if (totalSizeMB >= 1024) {
        sizeDisplay = (totalSizeMB / 1024).toFixed(2) + " GB";
    } else {
        sizeDisplay = totalSizeMB.toFixed(2) + " MB";
    }

    if(willCrop) {
        alert(`Você selecionou ${cbs.length} arquivos com ${sizeDisplay}.\nO sistema irá recortar para sua Área de Interesse e compactar tudo em um único arquivo .ZIP`);
        
        btn.disabled = true;
        const textoOriginal = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Preparando...';
        
        const prod = document.getElementById('produto').value;
        let sub = "Dados";
        if (prod === 'RiverSP') sub = document.querySelector('#sub-river select[name="subproduto"]').value;
        else if (prod === 'LakeSP') sub = document.querySelector('#sub-lake select[name="subproduto"]').value;
        else if (prod === 'Raster') sub = document.querySelector('#sub-raster select[name="resolucao"]').value;
        else if (prod === 'PIXC') sub = "Nuvem";

        let areaNome = "AreaLivre";
        if (shapeName) {
            areaNome = shapeName.split('.').slice(0, -1).join('.'); 
            areaNome = areaNome.replace(/[^a-zA-Z0-9_-]/g, ''); 
        } else if (stateUF && stateUF !== 'BR') {
            areaNome = stateUF;
        }

        const dataHoje = new Date().toISOString().split('T')[0]; 
        const nomeFinalZip = `SWOT_${prod}_${sub}_${areaNome}_${dataHoje}`;

        const tarefas = Array.from(cbs).map(c => ({
            url: c.value,
            statusId: c.id.replace('cb-', 'status-'),
            shape: shapeName,
            state: (stateUF !== 'BR') ? stateUF : '',
            lon_min: document.getElementById('lon_min').value,
            lat_min: document.getElementById('lat_min').value,
            lon_max: document.getElementById('lon_max').value,
            lat_max: document.getElementById('lat_max').value
        }));
        
        processarFilaDownloads(tarefas, btn, textoOriginal, nomeFinalZip);
        return;
    }

    if(btn) {
        alert(`Você selecionou ${cbs.length} arquivos com ${sizeDisplay}.\nO sistema irá baixar os arquivos originais!`);

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

function baixarBlob(blob, nome) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
}

async function processarFilaDownloads(tarefas, btn, textoOriginal, nomeFinalZip) {
    let fileHandle = null;

    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: `${nomeFinalZip}.zip`,
                types: [{
                    description: 'Arquivo Compactado ZIP',
                    accept: {'application/zip': ['.zip']},
                }],
            });
        } catch (saveErr) {
            if (saveErr.name !== 'AbortError') console.error(saveErr);
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
            return; 
        }
    } else {
        alert("Atenção: Seu navegador não suporta escolha de pasta. O arquivo irá para 'Downloads'.");
    }

    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Processando Recortes...';

    let zip = new JSZip();
    let relatorio = "========================================\n";
    relatorio += "   RELATÓRIO DE DOWNLOAD - SWOT NASA    \n";
    relatorio += "========================================\n";
    relatorio += "Data da consulta: " + new Date().toLocaleString() + "\n";
    relatorio += "Total de arquivos processados: " + tarefas.length + "\n\n";

    let contagens = { salvos: 0, vazios: 0, erros: 0 };

    for (const t of tarefas) { 
        let resultado = await baixarRecortado(t.url, t.statusId, t.shape, t.state, t.lon_min, t.lat_min, t.lon_max, t.lat_max); 
        let nomeArquivo = t.url.split('/').pop().split('?')[0];
        
        relatorio += `> Arquivo: ${nomeArquivo}\n`;
        relatorio += `  Status:  ${resultado.msg}\n\n`;
        
        if(resultado.tipo === 'salvo') {
            contagens.salvos++;
            if (resultado.blob && resultado.nomeFinal) {
                zip.file(resultado.nomeFinal, resultado.blob);
            }
        }
        else if(resultado.tipo === 'vazio') contagens.vazios++;
        else contagens.erros++;
    }
    
    relatorio += "========================================\n";
    relatorio += `RESUMO:\n- Baixados com sucesso: ${contagens.salvos}\n- Sem sobreposição: ${contagens.vazios}\n- Falhas no processamento: ${contagens.erros}\n`;

    zip.file("Relatorio_SWOT.txt", relatorio);
    btn.innerHTML = '<span class="material-symbols-outlined">inventory_2</span> Salvando ZIP...';

    try {
        const content = await zip.generateAsync({type:"blob"});
        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            alert("Processamento concluído!\nArquivo ZIP salvo com sucesso na pasta escolhida.");
        } else {
            baixarBlob(content, `${nomeFinalZip}.zip`);
        }
    } catch (e) {
        alert("Erro ao finalizar a gravação do arquivo ZIP.");
        console.error(e);
    }

    btn.disabled = false;
    btn.innerHTML = textoOriginal;
}

async function baixarRecortado(url, statusId, shape, stateUF, lon_min, lat_min, lon_max, lat_max) {
    const statusSpan = document.getElementById(statusId);

    if(statusSpan) {
        statusSpan.innerText = "⏳ Recortando...";
        statusSpan.style.color = "#e66a00";
    }

    try {
        const reqBody = { granule_url: url };
        if (shape) reqBody.shape_filename = shape;
        if (stateUF) reqBody.state_uf = stateUF;
        if (lon_min !== "") {
            reqBody.lon_min = lon_min;
            reqBody.lat_min = lat_min;
            reqBody.lon_max = lon_max;
            reqBody.lat_max = lat_max;
        }

        const r = await fetch('/download_cropped', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(reqBody)
        });
        
        if(r.ok) {
            const contentType = r.headers.get("content-type");
            
            if (contentType && contentType.includes("application/json")) {
                const data = await r.json();
                if (data.status === 'no_data') {
                    if(statusSpan) { 
                        statusSpan.innerText = "⚠️ Sem sobreposição"; 
                        statusSpan.style.color = "#856404"; 
                        statusSpan.title = "Sem sobreposição na área de interesse";
                    }
                    return { tipo: 'vazio', msg: 'Sem sobreposição na área de interesse.' };
                }
            }
            
            const blob = await r.blob();
            
            let nomeOriginal = url.split('/').pop().split('?')[0];
            let nomeSemExtensao = nomeOriginal.substring(0, nomeOriginal.lastIndexOf('.')) || nomeOriginal;

            let ext = ".geojson";
            const u = url.toLowerCase();
            if(u.includes('.zip')) ext = ".zip"; 
            else if(u.includes('.nc')) ext = ".nc"; 
            else if(u.includes('.gpkg')) ext = ".gpkg";
            
            if(statusSpan) { statusSpan.innerText = "✅ Salvo"; statusSpan.style.color = "green"; }
            
            return { 
                tipo: 'salvo', 
                msg: 'Recorte efetuado e salvo com sucesso.', 
                blob: blob, 
                nomeFinal: `recorte_${nomeSemExtensao}${ext}`
            };
            
        } else {
            const err = await r.json(); 
            const erroMsg = err.error || "Erro desconhecido";
            
            if (erroMsg.toLowerCase().includes('sobreposição') || erroMsg.toLowerCase().includes('sobreposicao')) {
                if(statusSpan) { 
                    statusSpan.innerText = "⚠️ Sem sobreposição"; 
                    statusSpan.style.color = "#856404"; 
                    statusSpan.title = "Sem sobreposição na área de interesse";
                }
                return { tipo: 'vazio', msg: 'Sem sobreposição na área de interesse.' };
            }

            if(statusSpan) { statusSpan.innerText = "❌ Falha"; statusSpan.style.color = "red"; statusSpan.title = erroMsg; }
            return { tipo: 'erro', msg: `Falha no processamento: ${erroMsg}` };
        }
    } catch(e) { 
        if(statusSpan) { statusSpan.innerText = "❌ Sem Conexão"; statusSpan.style.color = "red"; } 
        return { tipo: 'erro', msg: 'Falha de comunicação com o servidor durante o download.' };
    } 
}

map.on('click', function(e) {
    if (Object.keys(activeLayers).length === 0) return;

    const clickPt = turf.point([e.latlng.lng, e.latlng.lat]);
    let foundFeatures = [];
    
    let toleranceKm = 2000 / Math.pow(2, map.getZoom()); 

    for (const [layerKey, layerGroup] of Object.entries(activeLayers)) {
        layerGroup.eachLayer(function(layer) {
            if (!layer.feature || !layer.feature.geometry) return;

            let geom = layer.feature.geometry;
            let isInside = false;

            try {
                let type = geom.type;
                
                if (type === 'Point') {
                    let coords = geom.coordinates;
                    if (turf.distance(clickPt, turf.point([coords[0], coords[1]]), {units: 'kilometers'}) <= toleranceKm) isInside = true;
                
                } else if (type === 'MultiPoint') {
                    geom.coordinates.forEach(coord => {
                        if (turf.distance(clickPt, turf.point([coord[0], coord[1]]), {units: 'kilometers'}) <= toleranceKm) isInside = true;
                    });
                
                } else if (type === 'LineString' || type === 'MultiLineString') {
                    try {
                        if (turf.pointToLineDistance(clickPt, layer.feature, {units: 'kilometers'}) <= toleranceKm) isInside = true;
                    } catch(errLine) {
                        let coords = type === 'LineString' ? [geom.coordinates] : geom.coordinates;
                        for (let line of coords) {
                            for (let coord of line) {
                                if (turf.distance(clickPt, turf.point([coord[0], coord[1]]), {units: 'kilometers'}) <= toleranceKm) {
                                    isInside = true; break;
                                }
                            }
                            if(isInside) break;
                        }
                    }
                
                } else if (type === 'Polygon' || type === 'MultiPolygon') {
                    isInside = turf.booleanPointInPolygon(clickPt, layer.feature);
                    if (!isInside) {
                        try {
                            let lines = turf.polygonToLine(layer.feature);
                            if (lines.type === 'FeatureCollection') {
                                lines.features.forEach(l => {
                                    if (turf.pointToLineDistance(clickPt, l, {units: 'kilometers'}) <= toleranceKm) isInside = true;
                                });
                            } else {
                                if (turf.pointToLineDistance(clickPt, lines, {units: 'kilometers'}) <= toleranceKm) isInside = true;
                            }
                        } catch(err2) { } 
                    }
                }
            } catch(err) { 
                console.warn("Geometria ignorada:", err); 
            }

            if (isInside) {
                foundFeatures.push({
                    title: layerGroup.options.customTitle || layerKey,
                    props: layer.feature.properties
                });
            }
        });
    }

    if (foundFeatures.length > 0) {
        showMultiPopup(foundFeatures, e.latlng);
    }
});

function showMultiPopup(features, latlng) {
    let html = `<div style="min-width: 260px; max-width: 320px;">`;

    if (features.length === 1) {
        html += buildFeatureTable(features[0].title, features[0].props);
    } else {
        html += `<div style="display:flex; overflow-x:auto; border-bottom:2px solid #00509e; margin-bottom:10px; padding-bottom:5px; gap:6px;">`;
        features.forEach((f, idx) => {
            let bg = idx === 0 ? '#00509e' : '#f1f1f1';
            let color = idx === 0 ? '#fff' : '#333';
            html += `<button class="multi-tab-btn" data-idx="${idx}" onclick="switchTabPopup(${idx})" style="flex-shrink:0; padding:4px 8px; border:1px solid #ddd; border-radius:4px; background:${bg}; color:${color}; font-size:11px; cursor:pointer; font-weight:bold; transition: 0.2s;">${f.title}</button>`;
        });
        html += `</div>`;

        html += `<div id="multi-popup-contents">`;
        features.forEach((f, idx) => {
            let display = idx === 0 ? 'block' : 'none';
            html += `<div class="multi-tab-pane" id="pane-${idx}" style="display:${display};">`;
            html += buildFeatureTable(f.title, f.props);
            html += `</div>`;
        });
        html += `</div>`;
    }

    html += `</div>`;
    
    L.popup({maxHeight: window.innerHeight * 0.5}).setLatLng(latlng).setContent(html).openOn(map);
}

function buildFeatureTable(title, props) {
    let html = `<div style="font-weight:bold; color:#00509e; margin-bottom:10px; border-bottom:1px solid #ddd; padding-bottom:5px;">${title}</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:11px;">`;
    for (const [key, value] of Object.entries(props)) {
        let valDisplay = (value === null || value === '') ? '-' : value;
        html += `<tr><td style="padding:4px 2px; border-bottom:1px solid #eee; font-weight:600; color:#555; vertical-align:top;">${key}</td><td style="padding:4px 2px; border-bottom:1px solid #eee; word-break:break-all;">${valDisplay}</td></tr>`;
    }
    html += `</table>`;
    return html;
}

window.switchTabPopup = function(activeIdx) {
    document.querySelectorAll('.multi-tab-btn').forEach(btn => {
        if (parseInt(btn.getAttribute('data-idx')) === activeIdx) {
            btn.style.background = '#00509e';
            btn.style.color = '#fff';
            btn.style.borderColor = '#00509e';
        } else {
            btn.style.background = '#f1f1f1';
            btn.style.color = '#333';
            btn.style.borderColor = '#ddd';
        }
    });
    document.querySelectorAll('.multi-tab-pane').forEach((pane, idx) => {
        pane.style.display = (idx === activeIdx) ? 'block' : 'none';
    });
};