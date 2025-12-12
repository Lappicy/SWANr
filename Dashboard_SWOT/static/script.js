// MAPA
var map = L.map('map', { zoomControl: false }).setView([-14.235, -51.925], 4); 
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });
var labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png');
satellite.addTo(map); labels.addTo(map);

// CAMADAS
var layerControl = L.control.layers({"Satélite": satellite}, {"Rótulos": labels}, {position: 'topright', collapsed:true}).addTo(map);
const activeLayers = {};

function toggleCamada(checkbox, nomeArquivo, nomeExibicao, cor, tipo) {
    if (!checkbox.checked) {
        if (activeLayers[nomeArquivo]) map.removeLayer(activeLayers[nomeArquivo]);
        return;
    }
    if (activeLayers[nomeArquivo]) {
        map.addLayer(activeLayers[nomeArquivo]);
        return;
    }
    document.getElementById('map').style.cursor = 'wait';
    checkbox.disabled = true;
    fetch(`/camadas/${nomeArquivo}`).then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(data => {
        var layer = L.geoJSON(data, {
            style: function (f) { return { color: cor, weight: 1.5, opacity: 0.8, fillOpacity: 0.1 }; },
            pointToLayer: function (f, l) { return L.circleMarker(l, { radius: 4, fillColor: cor, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.9 }); },
            onEachFeature: function (f, l) {
                if (f.properties) {
                    let html = `<div class="custom-popup-header">${nomeExibicao}</div><table class="custom-popup-table">`;
                    for (const [key, value] of Object.entries(f.properties)) {
                        if (key !== 'fid' && key !== 'geom') html += `<tr><td class="custom-popup-key">${key}</td><td class="custom-popup-value">${value}</td></tr>`;
                    }
                    html += `</table>`;
                    const id = `zoom-${Math.random().toString(36).substr(2, 9)}`;
                    html += `<div class="custom-popup-footer"><a href="#" id="${id}" class="btn-zoom-feature">Zoom para</a></div>`;
                    l.bindPopup(html);
                    l.on('popupopen', function() {
                        const btn = document.getElementById(id);
                        if(btn) btn.onclick = function(e) {
                            e.preventDefault();
                            if (l.getBounds) map.fitBounds(l.getBounds()); else map.setView(l.getLatLng(), 12);
                            l.closePopup();
                        };
                    });
                }
            }
        });
        activeLayers[nomeArquivo] = layer;
        map.addLayer(layer);
        checkbox.disabled = false;
        document.getElementById('map').style.cursor = '';
    })
    .catch(e => { alert("Erro ao carregar camada."); checkbox.checked = false; checkbox.disabled = false; document.getElementById('map').style.cursor = ''; });
}

// UI
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({metric: true, imperial: false, position: 'bottomright'}).addTo(map);
var CoordsControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function (map) { this._div = L.DomUtil.create('div', 'leaflet-control-coordinates'); this._div.innerHTML = "Lat: 0.000 | Lon: 0.000"; return this._div; },
    update: function (lat, lng) { this._div.innerHTML = `Lat: ${lat.toFixed(4)} | Lon: ${lng.toFixed(4)}`; }
});
new CoordsControl().addTo(map);
map.on('mousemove', function(e) { document.querySelector('.leaflet-control-coordinates').innerHTML = `Lat: ${e.latlng.lat.toFixed(4)} | Lon: ${e.latlng.lng.toFixed(4)}`; });

var drawnItems = new L.FeatureGroup(); map.addLayer(drawnItems);
var drawControl = new L.Control.Draw({
    draw: { polygon: false, polyline: false, circle: false, marker: false, circlemarker: false, rectangle: { shapeOptions: { color: '#0079c1', weight: 2 } } },
    edit: { featureGroup: drawnItems, remove: true },
    position: 'topright'
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (e) {
    drawnItems.clearLayers(); drawnItems.addLayer(e.layer);
    var bounds = e.layer.getBounds();
    atualizarInputsCoords(bounds);
    map.fitBounds(bounds);
    document.getElementById('brazil_states').value = ""; 
});
map.on(L.Draw.Event.DELETED, function() {
    limparInputsCoords();
    document.getElementById('brazil_states').value = "";
});

function atualizarInputsCoords(bounds) {
    document.getElementById('lat_min').value = bounds.getSouthWest().lat.toFixed(4);
    document.getElementById('lat_max').value = bounds.getNorthEast().lat.toFixed(4);
    document.getElementById('lon_min').value = bounds.getSouthWest().lng.toFixed(4);
    document.getElementById('lon_max').value = bounds.getNorthEast().lng.toFixed(4);
}
function limparInputsCoords() {
    ['lat_min', 'lat_max', 'lon_min', 'lon_max'].forEach(id => document.getElementById(id).value = '');
}

var currentStateLayer = null;
function aplicarFiltroEstado() {
    const uf = document.getElementById('brazil_states').value;
    if (!uf) {
        if (currentStateLayer) map.removeLayer(currentStateLayer);
        drawnItems.clearLayers();
        limparInputsCoords();
        return;
    }
    document.getElementById('map').style.cursor = 'wait';
    fetch(`/limites/ibge/${uf}`).then(r=>r.json()).then(data => {
        if(data.error) { alert("Erro IBGE."); return; }
        drawnItems.clearLayers();
        if (currentStateLayer) map.removeLayer(currentStateLayer);
        if(data.geojson) currentStateLayer = L.geoJSON(data.geojson, {style: {color: "#00FF00", weight: 3, fillOpacity: 0.05}}).addTo(map);
        
        const b = data.bbox;
        const sw = L.latLng(b[1], b[0]); const ne = L.latLng(b[3], b[2]);
        const bounds = L.latLngBounds(sw, ne);
        drawnItems.addLayer(L.rectangle(bounds, {color: "#0079c1", weight: 1, dashArray: '5, 5', fillOpacity: 0}));
        
        map.fitBounds(bounds);
        document.getElementById('lon_min').value = b[0]; document.getElementById('lat_min').value = b[1];
        document.getElementById('lon_max').value = b[2]; document.getElementById('lat_max').value = b[3];
        document.getElementById('map').style.cursor = '';
    }).catch(e=> { console.error(e); document.getElementById('map').style.cursor = ''; });
}

function switchTab(t) {
    document.querySelectorAll('.panel-body').forEach(e => e.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach(e => e.classList.remove('active'));
    document.getElementById('tab-'+t).classList.add('active');
    document.getElementById('view-'+t).classList.remove('hidden');
}

function togglePanel() {
    const b = document.querySelector('.panel-body:not(.hidden)');
    const p = document.getElementById('main-panel');
    if(b.style.display!=='none'){b.style.display='none'; p.style.height='auto';} else {b.style.display='flex'; p.style.removeProperty('height');}
}

function toggleFilters() {
    const p = document.getElementById('produto').value;
    document.querySelectorAll('.filter-group').forEach(e => e.classList.add('hidden'));
    document.getElementById('filters-container').classList.add('hidden');
    document.getElementById('btn-container').classList.add('hidden');
    const l = document.getElementById('label-aoi');
    if (p) {
        document.getElementById('filters-container').classList.remove('hidden');
        document.getElementById('btn-container').classList.remove('hidden');
        document.getElementById('aoi-section').classList.remove('hidden');
        if (p === 'RiverSP' || p === 'LakeSP') {
             l.innerHTML = '4. Área de Interesse <span style="font-weight:normal; color:#666;">(Opcional)</span>'; l.style.color = "#444";
             if (p === 'RiverSP') document.getElementById('filters-RiverSP').classList.remove('hidden');
             if (p === 'LakeSP') document.getElementById('filters-LakeSP').classList.remove('hidden');
             document.getElementById('orbit-filters').classList.remove('hidden');
        } else if (p === 'PIXC' || p === 'Raster') {
            l.innerHTML = '4. Área de Interesse <span style="font-weight:bold;">(Obrigatório)</span>'; l.style.color = "#d9534f";
            if(p === 'Raster') document.getElementById('filters-Raster').classList.remove('hidden');
        }
    }
}

function formatBytes(bytes) {
    if (!+bytes) return '0 Bytes';
    const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function buscarDados() {
    const p = document.getElementById('produto').value;
    if (!p) { alert("Selecione um produto."); return; }
    if(!document.getElementById('start_date').value || !document.getElementById('end_date').value) { alert("Preencha as datas."); return; }
    if ((p === 'PIXC' || p === 'Raster') && !document.getElementById('lat_min').value) { alert("Desenhe a área."); return; }

    switchTab('resultados');
    const list = document.getElementById('results-list');
    list.innerHTML = '<p style="padding:20px; text-align:center;">⏳ Buscando...</p>';
    document.getElementById('results-meta').classList.add('hidden');
    document.querySelector('.btn-aneel.download').disabled = true;

    fetch('/buscar_dados', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(document.getElementById('searchForm')).entries()))
    })
    .then(r => r.json())
    .then(resp => {
        list.innerHTML = '';
        if(resp.status === 'success') {
            if(resp.results.length === 0) { list.innerHTML = '<p style="padding:20px; text-align:center;">Nenhum dado encontrado.</p>'; return; }
            let totalBytes = 0; resp.results.forEach(i => totalBytes += (i.size_bytes || 0));
            document.getElementById('total-count').innerText = `${resp.results.length} arquivos`;
            document.getElementById('total-size').innerText = formatBytes(totalBytes);
            document.getElementById('results-meta').classList.remove('hidden');
            document.getElementById('select-all').checked = false;
            resp.results.forEach(i => {
                const div = document.createElement('div'); div.className = 'result-item';
                div.innerHTML = `<input type="checkbox" value="${i.download_link}" onclick="verificarSelecao()"> 
                                 <div style="width:100%"><div style="font-weight:600; font-size:0.8rem; word-break:break-all;">${i.filename}</div>
                                 <div style="color:#28a745; font-size:0.75rem;">${i.size}</div></div>`;
                list.appendChild(div);
            });
        } else list.innerHTML = `<p style="color:red; padding:10px;">Erro: ${resp.message}</p>`;
    }).catch(e => list.innerHTML = '<p style="color:red; padding:10px;">Erro de conexão.</p>');
}

function verificarSelecao() {
    document.querySelector('.btn-aneel.download').disabled = (document.querySelectorAll('.result-item input:checked').length === 0);
}
function toggleSelectAll() {
    const m = document.getElementById('select-all');
    document.querySelectorAll('.result-item input').forEach(cb => cb.checked = m.checked);
    verificarSelecao();
}
function baixarSelecionados() {
    const cbs = document.querySelectorAll('.result-item input:checked');
    if (cbs.length === 0) return;
    const btn = document.querySelector('.btn-aneel.download');
    btn.disabled = true;
    document.getElementById('progress-container').classList.remove('hidden');
    document.getElementById('progress-text').innerText = "Iniciando download...";
    document.getElementById('progress-fill').style.width = "20%";
    
    fetch('/baixar_selecionados', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({arquivos: Array.from(cbs).map(c => c.value)})
    })
    .then(r => r.json())
    .then(d => {
        document.getElementById('progress-fill').style.width = "100%";
        document.getElementById('progress-text').innerText = "Concluído!";
        setTimeout(() => {
             document.getElementById('progress-container').classList.add('hidden');
             document.getElementById('progress-fill').style.width = "0%";
             btn.disabled = false;
             alert(d.message);
        }, 1000);
    }).catch(e => { alert("Erro."); btn.disabled = false; });
}