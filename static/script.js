function renderLucideIcons(root) {
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
    window.lucide.createIcons(root ? { attrs: {}, nameAttr: 'data-lucide' } : undefined);
}

function icon(name, className) {
    return '<i data-lucide="' + escHtml(name) + '"'
        + (className ? ' class="' + escHtml(className) + '"' : '')
        + ' aria-hidden="true"></i>';
}

document.addEventListener('DOMContentLoaded', function () {
    renderLucideIcons();
});

var map = L.map('map', { zoomControl: false }).setView([-13.5, -54.5], 4);

var hydro = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri, USGS, NOAA', maxZoom: 19 }
);
var satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri', maxZoom: 19 }
);
var street = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: 'OSM', maxZoom: 19 }
);
var labels = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    { maxZoom: 19 }
);

hydro.addTo(map);
labels.addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(map);

var CoordControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        var container = L.DomUtil.create('div', 'coord-display leaflet-control');
        container.innerHTML = icon('locate-fixed')
                            + '<span id="map-coords">0,000 0,000 Graus</span>';
        renderLucideIcons(container);
        return container;
    }
});
map.addControl(new CoordControl());

var _lastMoveTime = 0;
map.on('mousemove', function (e) {
    var now = Date.now();
    if (now - _lastMoveTime < 50) return;
    _lastMoveTime = now;
    var lat = e.latlng.lat.toFixed(3).replace('.', ',');
    var lng = e.latlng.lng.toFixed(3).replace('.', ',');
    var coordSpan = document.getElementById('map-coords');
    if (coordSpan) coordSpan.innerText = lng + ' ' + lat + ' Graus';
});

document.getElementById('map').style.cursor = 'pointer';

function trocarBasemap(tipo) {
    if (tipo === 'hydro') {
        if (!map.hasLayer(hydro)) map.addLayer(hydro);
        if (map.hasLayer(satellite)) map.removeLayer(satellite);
        if (map.hasLayer(street)) map.removeLayer(street);
        if (!map.hasLayer(labels)) map.addLayer(labels);
    } else if (tipo === 'sat') {
        if (map.hasLayer(hydro)) map.removeLayer(hydro);
        if (!map.hasLayer(satellite)) map.addLayer(satellite);
        if (!map.hasLayer(labels)) map.addLayer(labels);
        if (map.hasLayer(street)) map.removeLayer(street);
    } else {
        if (map.hasLayer(hydro)) map.removeLayer(hydro);
        if (!map.hasLayer(street)) map.addLayer(street);
        if (map.hasLayer(satellite)) map.removeLayer(satellite);
        if (map.hasLayer(labels)) map.removeLayer(labels);
    }
}

function startLoading() { document.getElementById('map').classList.add('map-loading'); }
function stopLoading()  { document.getElementById('map').classList.remove('map-loading'); }

function showToast(msg, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = msg;
    container.appendChild(toast);

    void toast.offsetWidth;
    toast.classList.add('show');

    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 300);
    }, duration);
}

function switchTab(t) {
    var p = document.getElementById('main-panel');
    var clickedNav = document.getElementById('nav-' + t);
    var isAlreadyActive = clickedNav && clickedNav.classList.contains('active');

    if (isAlreadyActive && p.style.display !== 'none') {
        p.style.display = 'none';
        return;
    }

    p.style.display = 'flex';

    document.querySelectorAll('.panel-body').forEach(function (e) {
        e.classList.add('hidden');
    });

    document.querySelectorAll('.nav-item:not(#nav-manual)').forEach(function (e) {
        e.classList.remove('active');
    });

    document.getElementById('view-' + t).classList.remove('hidden');
    if (clickedNav) clickedNav.classList.add('active');
}

function toggleManual() {
    var panel = document.getElementById('manual-panel');
    var btn   = document.getElementById('nav-manual');
    var opening = !panel.classList.contains('open');
    panel.classList.toggle('open', opening);
    btn.classList.toggle('active', opening);
}

function resetarConsulta() {
    document.getElementById('searchForm').reset();
    limparArea();
    toggleSubproducts();
    document.getElementById('date-msg').classList.add('hidden');
    document.getElementById('results-list').innerHTML = '';
    document.getElementById('results-meta').classList.add('hidden');
    document.getElementById('btn-download-selected').classList.add('hidden');
    document.getElementById('nav-resultados').classList.add('disabled');
    switchTab('swot');
}

function toggleSubproducts() {
    document.querySelectorAll('.sub-opts').forEach(function (e) { e.classList.add('hidden'); });
    document.querySelectorAll('.sub-opts select').forEach(function (s) { s.disabled = true; });

    var p = document.getElementById('produto').value;
    var divId = '';
    if (p === 'RiverSP') divId = 'sub-river';
    else if (p === 'LakeSP') divId = 'sub-lake';
    else if (p === 'Raster') divId = 'sub-raster';

    if (divId) {
        var d = document.getElementById(divId);
        d.classList.remove('hidden');
        d.querySelectorAll('select').forEach(function (s) { s.disabled = false; });
    }
}

function validarDatas() {
    var s   = document.getElementById('start_date');
    var e   = document.getElementById('end_date');
    var msg = document.getElementById('date-msg');
    var min = new Date('2022-02-15T00:00:00');
    var calValEnd = new Date('2023-07-26T23:59:59');

    var d1 = s.value ? new Date(s.value + 'T00:00:00') : null;
    var d2 = e.value ? new Date(e.value + 'T00:00:00') : null;

    msg.classList.add('hidden');
    msg.style.color = '#856404';
    msg.style.backgroundColor = '#fff3cd';
    msg.style.borderColor = '#ffeeba';

    if ((d1 && d1 < min) || (d2 && d2 < min)) {
        showToast('⚠️ O satélite não estava disponível antes de 15/02/2022.', 'warning');
        if (d1 && d1 < min) s.value = '';
        if (d2 && d2 < min) e.value = '';
        return;
    }

    if (d1 && d2 && d1 > d2) {
        msg.innerHTML = '❌ <strong>Erro:</strong> Data inicial deve ser anterior à data final.';
        msg.style.color = '#721c24';
        msg.style.backgroundColor = '#f8d7da';
        msg.style.borderColor = '#f5c6cb';
        msg.classList.remove('hidden');
        e.value = '';
        return;
    }

    if ((d1 && d1 <= calValEnd) || (d2 && d2 <= calValEnd)) {
        msg.innerText = '⚠️ Esse período engloba a fase de Cal/Val.';
        msg.classList.remove('hidden');
    }
}

var drawnItems  = new L.FeatureGroup(); map.addLayer(drawnItems);
var uploadedLayer = null;
var stateLayer    = null;
var activeLayers  = {};

var drawControl = new L.Control.Draw({
    draw: {
        polygon: false, polyline: false, circle: false,
        marker: false, circlemarker: false,
        rectangle: { shapeOptions: { color: '#0079c1' } }
    },
    edit: { featureGroup: drawnItems, remove: true },
    position: 'topright'
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (e) {
    limparTudoMenos('draw');
    drawnItems.addLayer(e.layer);
    updateCoords(e.layer.getBounds());
});
map.on(L.Draw.Event.DELETED, function () { updateCoords(null); });

function limparArea() {
    limparTudoMenos('reset');
    updateCoords(null);
}

function limparTudoMenos(tipo) {
    if (tipo !== 'draw') drawnItems.clearLayers();
    if (tipo !== 'upload') {
        if (uploadedLayer) { map.removeLayer(uploadedLayer); uploadedLayer = null; }
        document.getElementById('uploadedShapeName').value = '';
        document.getElementById('shapeStatus').innerText = '';
        document.getElementById('userShapeInput').value = '';
    }
    if (tipo !== 'state') {
        if (stateLayer) { map.removeLayer(stateLayer); stateLayer = null; }
        document.getElementById('brazil_states').value = '';
    }
}

function updateCoords(b) {
    if (!b) {
        ['lat_min', 'lat_max', 'lon_min', 'lon_max'].forEach(function (id) {
            document.getElementById(id).value = '';
        });
        return;
    }
    document.getElementById('lat_min').value = b.getSouth().toFixed(4);
    document.getElementById('lat_max').value = b.getNorth().toFixed(4);
    document.getElementById('lon_min').value = b.getWest().toFixed(4);
    document.getElementById('lon_max').value = b.getEast().toFixed(4);
}

async function uploadShape() {
    var file = document.getElementById('userShapeInput').files[0];
    if (!file) return;
    limparTudoMenos('upload');
    startLoading();
    document.getElementById('shapeStatus').innerText = 'Enviando...';
    var fd = new FormData();
    fd.append('file', file);
    try {
        var r = await fetch('/upload_user_shape', { method: 'POST', body: fd });
        var d = await r.json();
        if (d.error) throw new Error(d.error);
        document.getElementById('uploadedShapeName').value = d.filename;
        document.getElementById('shapeStatus').innerText = 'OK: ' + d.filename;
        uploadedLayer = L.geoJSON(JSON.parse(d.geojson), {
            interactive: false,
            style: { color: 'orange', dashArray: '5,5' }
        }).addTo(map);
        map.fitBounds(uploadedLayer.getBounds());
        updateCoords(uploadedLayer.getBounds());
    } catch (e) {
        showToast('❌ Erro ao enviar arquivo: ' + e.message, 'error', 6000);
        document.getElementById('shapeStatus').innerText = 'Erro';
    } finally {
        stopLoading();
    }
}

function aplicarFiltroEstado() {
    var uf = document.getElementById('brazil_states').value;
    if (stateLayer) { map.removeLayer(stateLayer); stateLayer = null; }
    limparTudoMenos('state');
    if (!uf) { updateCoords(null); return; }
    startLoading();

    fetch('/limites/estado/' + uf)
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.error) {
                showToast('Erro: ' + d.error, 'error');
                return;
            }
            stateLayer = L.geoJSON(d.geojson, {
                interactive: false,
                style: { color: '#0079c1', weight: 2, fillOpacity: 0.1 }
            }).addTo(map);
            var b = d.bbox;
            var bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
            map.fitBounds(bounds);
            updateCoords(bounds);
        })
        .catch(function (e) { showToast('Erro ao carregar estado.', 'error'); console.error(e); })
        .finally(stopLoading);
}

function toggleCamada(checkbox, nomeArquivo, nomeExibicao, cor, tipo) {
    if (!checkbox.checked) {
        if (activeLayers[nomeArquivo]) {
            map.removeLayer(activeLayers[nomeArquivo]);
            activeLayers[nomeArquivo].clearLayers();
            delete activeLayers[nomeArquivo];
        }
        return;
    }

    startLoading();
    checkbox.disabled = true;

    fetch('/camadas/' + nomeArquivo)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) throw new Error(data.error);
            var layer = L.geoJSON(data, {
                customTitle: nomeExibicao,
                interactive: true,
                style: function () {
                    return { color: cor, weight: 3, opacity: 0.8, fillOpacity: 0.1 };
                },
                pointToLayer: function (f, latlng) {
                    return L.circleMarker(latlng, {
                        radius: 5, fillColor: cor, color: '#fff',
                        weight: 1, opacity: 1, fillOpacity: 0.9
                    });
                }
            });
            activeLayers[nomeArquivo] = layer;
            map.addLayer(layer);
        })
        .catch(function (e) {
            showToast('Erro ao carregar camada: ' + e.message, 'error');
            checkbox.checked = false;
        })
        .finally(function () { checkbox.disabled = false; stopLoading(); });
}

function buscarDados() {
    var p = document.getElementById('produto').value;
    if (!p) { showToast('Selecione um produto antes de consultar.', 'warning'); return; }

    var sDate = document.getElementById('start_date').value;
    var eDate = document.getElementById('end_date').value;
    if (!sDate || !eDate) {
        showToast('Preencha a Data Inicial e a Data Final.', 'warning');
        return;
    }
    if (new Date(sDate) > new Date(eDate)) {
        showToast('As datas estão invertidas. Corrija o período.', 'warning');
        return;
    }

    switchTab('resultados');
    var list = document.getElementById('results-list');
    list.innerHTML = '';
    list.classList.add('hidden');
    document.getElementById('results-meta').classList.add('hidden');

    var btnDown = document.getElementById('btn-download-selected');
    if (btnDown) btnDown.classList.add('hidden');

    document.getElementById('nav-resultados').classList.remove('disabled');

    var loader = document.getElementById('progress-container');
    var bar    = document.getElementById('progress-fill');
    loader.classList.remove('hidden');
    bar.style.width = '0%';
    bar.classList.remove('progress-filling');
    void bar.offsetWidth;
    bar.classList.add('progress-filling');

    var formData = new FormData(document.getElementById('searchForm'));
    var reqData  = Object.fromEntries(formData);
    reqData['shape_filename'] = document.getElementById('uploadedShapeName').value;
    reqData['state_uf']       = document.getElementById('brazil_states').value;

    fetch('/buscar_dados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqData)
    })
    .then(function (r) {
        if (!r.ok) throw new Error('Falha do Servidor (' + r.status + '). A NASA pode estar demorando a responder.');
        return r.json();
    })
    .then(function (d) {
        bar.classList.remove('progress-filling');
        bar.style.width = '100%';
        loader.classList.add('hidden');
        list.classList.remove('hidden');

        if (d.status !== 'success' || !d.results || d.results.length === 0) {
            list.innerHTML = "<p style='text-align:center; padding:20px; color:#00509e;'>Nenhum resultado encontrado.</p>";
            return;
        }

        var totalBytes = 0;
        d.results.forEach(function (f) {
            if (f.size && f.size !== 'N/A') totalBytes += parseFloat(f.size);
        });

        document.getElementById('total-count').innerText = d.results.length;
        document.getElementById('total-size').innerText  = totalBytes.toFixed(2) + ' MB';
        document.getElementById('results-meta').classList.remove('hidden');

        var shapeName = document.getElementById('uploadedShapeName').value;
        var stateUF   = document.getElementById('brazil_states').value;
        var latMinVal = document.getElementById('lat_min').value;
        var willCrop  = shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== '';

        if (btnDown) {
            btnDown.classList.remove('hidden');
            btnDown.disabled = true;
            if (willCrop) {
                btnDown.innerHTML = icon('scissors') + ' Recortar e Baixar Selecionados';
                btnDown.style.backgroundColor = '#e66a00';
            } else {
                btnDown.innerHTML = icon('download') + ' Baixar Originais Selecionados';
                btnDown.style.backgroundColor = '#00509e';
            }
            renderLucideIcons(btnDown);
        }

        var selectAll = document.getElementById('select-all');
        if (selectAll) selectAll.checked = false;

        d.results.forEach(function (f, index) {
            var item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML =
                '<div class="result-info">'
                + '<input type="checkbox" value="' + escHtml(f.download_link) + '" id="cb-' + index + '" onclick="verificarSelecao()">'
                + '<div class="result-text">'
                + '<div class="result-filename" title="' + escHtml(f.filename) + '">' + escHtml(f.filename) + '</div>'
                + '<div class="result-size">' + escHtml(String(f.size)) + ' MB'
                + '<span id="status-' + index + '" style="margin-left:10px; font-weight:bold;"></span>'
                + '</div></div></div>';
            list.appendChild(item);
        });
        verificarSelecao();
    })
    .catch(function (e) {
        console.error(e);
        loader.classList.add('hidden');
        list.classList.remove('hidden');
            list.innerHTML =
            '<div style="padding:15px; text-align:center; color:#721c24; background:#f8d7da; border:1px solid #f5c6cb; border-radius:5px; margin:10px;">'
            + icon('circle-alert')
            + '<b>Erro na busca!</b><br><span style="font-size:0.85rem;">' + escHtml(e.message) + '</span></div>';
        renderLucideIcons(list);
    });
}

function verificarSelecao() {
    var cbs = document.querySelectorAll('.result-item input:checked');
    var btn = document.querySelector('.btn-aneel.download');
    if (btn) btn.disabled = (cbs.length === 0);
}

function toggleSelectAll() {
    var sa = document.getElementById('select-all');
    if (!sa) return;
    var state = sa.checked;
    document.querySelectorAll('.result-item input[type="checkbox"]').forEach(function (cb) {
        cb.checked = state;
    });
    verificarSelecao();
}

function baixarSelecionados() {
    var cbs = document.querySelectorAll('.result-item input:checked');
    if (cbs.length === 0) return;

    var shapeName = document.getElementById('uploadedShapeName').value;
    var stateUF   = document.getElementById('brazil_states').value;
    var latMinVal = document.getElementById('lat_min').value;
    var willCrop  = shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== '';
    var btn       = document.querySelector('.btn-aneel.download');

    var totalSizeMB = 0;
    cbs.forEach(function (cb) {
        var sizeDiv = cb.closest('.result-info').querySelector('.result-size');
        if (sizeDiv) {
            var match = (sizeDiv.innerText || sizeDiv.textContent).match(/([\d.]+)\s*MB/);
            if (match) totalSizeMB += parseFloat(match[1]);
        }
    });
    var sizeDisplay = totalSizeMB >= 1024
        ? (totalSizeMB / 1024).toFixed(2) + ' GB'
        : totalSizeMB.toFixed(2) + ' MB';

    if (willCrop) {
        showToast(
            cbs.length + ' arquivo(s) selecionado(s) — ' + sizeDisplay
            + '. Processando recortes e gerando ZIP...',
            'info', 5000
        );

        btn.disabled = true;
        var textoOriginal = btn.innerHTML;
        btn.innerHTML = icon('hourglass') + ' Preparando...';
        renderLucideIcons(btn);

        var prod = document.getElementById('produto').value;
        var sub  = 'Dados';
        if (prod === 'RiverSP') sub = document.querySelector('#sub-river select[name="subproduto"]').value;
        else if (prod === 'LakeSP') sub = document.querySelector('#sub-lake select[name="subproduto"]').value;
        else if (prod === 'Raster') sub = document.querySelector('#sub-raster select[name="resolucao"]').value;
        else if (prod === 'PIXC') sub = 'Nuvem';

        var areaNome = 'AreaLivre';
        if (shapeName) {
            areaNome = shapeName.split('.').slice(0, -1).join('.').replace(/[^a-zA-Z0-9_-]/g, '');
        } else if (stateUF && stateUF !== 'BR') {
            areaNome = stateUF;
        }

        var dataHoje    = new Date().toISOString().split('T')[0];
        var nomeFinalZip = 'SWOT_' + prod + '_' + sub + '_' + areaNome + '_' + dataHoje;

        var tarefas = Array.from(cbs).map(function (c) {
            return {
                url:      c.value,
                statusId: c.id.replace('cb-', 'status-'),
                shape:    shapeName,
                state:    (stateUF !== 'BR') ? stateUF : '',
                lon_min:  document.getElementById('lon_min').value,
                lat_min:  document.getElementById('lat_min').value,
                lon_max:  document.getElementById('lon_max').value,
                lat_max:  document.getElementById('lat_max').value
            };
        });

        processarFilaDownloads(tarefas, btn, textoOriginal, nomeFinalZip);
        return;
    }

    showToast(cbs.length + ' arquivo(s) — ' + sizeDisplay + '. Iniciando download...', 'info', 4000);
    btn.disabled = true;
    var textoOriginal = btn.innerHTML;
    btn.innerHTML = icon('hourglass') + ' Baixando...';
    renderLucideIcons(btn);

    var arquivos = Array.from(cbs).map(function (c) { return c.value; });

    fetch('/baixar_selecionados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivos: arquivos })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
        showToast(d.message, d.status === 'success' ? 'success' : 'error', 6000);
    })
    .catch(function () { showToast('Erro no download. Verifique o servidor.', 'error'); })
    .finally(function () { btn.disabled = false; btn.innerHTML = textoOriginal; });
}

async function processarFilaDownloads(tarefas, btn, textoOriginal, nomeFinalZip) {
    var fileHandle = null;

    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: nomeFinalZip + '.zip',
                types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }]
            });
        } catch (saveErr) {
            if (saveErr.name !== 'AbortError') console.error(saveErr);
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
            return;
        }
    } else {
        showToast('Navegador sem suporte a escolha de pasta. O arquivo irá para "Downloads".', 'warning', 5000);
    }

    btn.innerHTML = icon('hourglass') + ' Processando (0/' + tarefas.length + ')...';
    renderLucideIcons(btn);

    var zip      = new JSZip();
    var contagens = { salvos: 0, vazios: 0, erros: 0 };
    var relatorio = '========================================\n'
                  + '   RELATÓRIO DE DOWNLOAD - SWOT NASA    \n'
                  + '========================================\n'
                  + 'Data: ' + new Date().toLocaleString() + '\n'
                  + 'Total de arquivos: ' + tarefas.length + '\n\n';

    var resultados = new Array(tarefas.length);

    var CONCORRENCIA = 3;
    var proxIdx = 0;
    var concluidos = 0;

    async function worker() {
        while (proxIdx < tarefas.length) {
            var i = proxIdx++;
            var t = tarefas[i];
            resultados[i] = await baixarRecortado(
                t.url, t.statusId, t.shape, t.state,
                t.lon_min, t.lat_min, t.lon_max, t.lat_max
            );
            concluidos++;
            btn.innerHTML = icon('hourglass') + ' Processando ('
                          + concluidos + '/' + tarefas.length + ')...';
            renderLucideIcons(btn);
        }
    }

    var workers = [];
    for (var w = 0; w < Math.min(CONCORRENCIA, tarefas.length); w++) workers.push(worker());
    await Promise.all(workers);

    resultados.forEach(function (resultado, i) {
        var nomeArquivo = tarefas[i].url.split('/').pop().split('?')[0];
        relatorio += '> ' + nomeArquivo + '\n  Status: ' + resultado.msg + '\n\n';
        if (resultado.tipo === 'salvo') {
            contagens.salvos++;
            if (resultado.blob && resultado.nomeFinal) zip.file(resultado.nomeFinal, resultado.blob);
        } else if (resultado.tipo === 'vazio') {
            contagens.vazios++;
        } else {
            contagens.erros++;
        }
    });

    relatorio += '========================================\n'
              + 'RESUMO:\n'
              + '- Baixados: ' + contagens.salvos + '\n'
              + '- Sem sobreposição: ' + contagens.vazios + '\n'
              + '- Falhas: ' + contagens.erros + '\n';
    zip.file('Relatorio_SWOT.txt', relatorio);

    btn.innerHTML = icon('package') + ' Salvando ZIP...';
    renderLucideIcons(btn);

    try {
        var content = await zip.generateAsync({ type: 'blob' });
        if (fileHandle) {
            var writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            showToast('✅ ZIP salvo com sucesso! Baixados: ' + contagens.salvos + ', Sem dados: ' + contagens.vazios, 'success', 7000);
        } else {
            baixarBlob(content, nomeFinalZip + '.zip');
        }
    } catch (e) {
        showToast('Erro ao gravar o arquivo ZIP.', 'error');
        console.error(e);
    }

    btn.disabled = false;
    btn.innerHTML = textoOriginal;
}

async function baixarRecortado(url, statusId, shape, stateUF, lon_min, lat_min, lon_max, lat_max) {
    var statusSpan = document.getElementById(statusId);
    if (statusSpan) { statusSpan.innerText = '⏳ Recortando...'; statusSpan.style.color = '#e66a00'; }

    var controller = new AbortController();
    var timeout    = setTimeout(function () { controller.abort(); }, 3 * 60 * 1000);

    try {
        var reqBody = { granule_url: url };
        if (shape)    reqBody.shape_filename = shape;
        if (stateUF)  reqBody.state_uf = stateUF;
        if (lon_min !== '') {
            reqBody.lon_min = lon_min; reqBody.lat_min = lat_min;
            reqBody.lon_max = lon_max; reqBody.lat_max = lat_max;
        }

        var r = await fetch('/download_cropped', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (r.ok) {
            var contentType = r.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                var data = await r.json();
                if (data.status === 'no_data') {
                    if (statusSpan) {
                        statusSpan.innerText = '⚠️ Sem sobreposição';
                        statusSpan.style.color = '#856404';
                        statusSpan.title = 'Sem sobreposição na área de interesse';
                    }
                    return { tipo: 'vazio', msg: 'Sem sobreposição na área de interesse.' };
                }
            }

            var blob = await r.blob();
            var nomeOriginal    = url.split('/').pop().split('?')[0];
            var nomeSemExtensao = nomeOriginal.substring(0, nomeOriginal.lastIndexOf('.')) || nomeOriginal;
            var ext = '.geojson';
            var u   = url.toLowerCase();
            if (u.includes('.zip')) ext = '.zip';
            else if (u.includes('.nc')) ext = '.nc';
            else if (u.includes('.gpkg')) ext = '.gpkg';

            if (statusSpan) { statusSpan.innerText = '✅ Salvo'; statusSpan.style.color = 'green'; }
            return { tipo: 'salvo', msg: 'Recorte efetuado com sucesso.', blob: blob, nomeFinal: 'recorte_' + nomeSemExtensao + ext };

        } else {
            var err    = await r.json().catch(function () { return {}; });
            var erroMsg = err.error || 'Erro desconhecido';
            if (statusSpan) { statusSpan.innerText = '❌ Falha'; statusSpan.style.color = 'red'; statusSpan.title = erroMsg; }
            return { tipo: 'erro', msg: 'Falha: ' + erroMsg };
        }
    } catch (e) {
        clearTimeout(timeout);
        var msg = e.name === 'AbortError'
            ? 'Timeout: servidor demorou mais de 3 minutos.'
            : 'Falha de comunicação com o servidor.';
        if (statusSpan) { statusSpan.innerText = '❌ ' + (e.name === 'AbortError' ? 'Timeout' : 'Sem Conexão'); statusSpan.style.color = 'red'; }
        return { tipo: 'erro', msg: msg };
    }
}

function baixarBlob(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = nome;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

map.on('click', function (e) {
    var visibleLayerKeys = Object.keys(activeLayers).filter(function (key) {
        return activeLayers[key] && map.hasLayer(activeLayers[key]);
    });
    if (visibleLayerKeys.length === 0) return;

    var clickPt     = turf.point([e.latlng.lng, e.latlng.lat]);
    var foundFeatures = [];
    var toleranceKm = 2000 / Math.pow(2, map.getZoom());

    visibleLayerKeys.forEach(function (layerKey) {
        var layerGroup = activeLayers[layerKey];
        layerGroup.eachLayer(function (layer) {
            if (!layer.feature || !layer.feature.geometry) return;
            var geom    = layer.feature.geometry;
            var isInside = false;

            try {
                var type = geom.type;
                if (type === 'Point') {
                    var c = geom.coordinates;
                    if (turf.distance(clickPt, turf.point([c[0], c[1]]), { units: 'kilometers' }) <= toleranceKm)
                        isInside = true;

                } else if (type === 'MultiPoint') {
                    geom.coordinates.forEach(function (coord) {
                        if (turf.distance(clickPt, turf.point([coord[0], coord[1]]), { units: 'kilometers' }) <= toleranceKm)
                            isInside = true;
                    });

                } else if (type === 'LineString' || type === 'MultiLineString') {
                    try {
                        if (turf.pointToLineDistance(clickPt, layer.feature, { units: 'kilometers' }) <= toleranceKm)
                            isInside = true;
                    } catch (errLine) {
                        var coords = type === 'LineString' ? [geom.coordinates] : geom.coordinates;
                        outer: for (var li = 0; li < coords.length; li++) {
                            for (var pi = 0; pi < coords[li].length; pi++) {
                                if (turf.distance(clickPt, turf.point([coords[li][pi][0], coords[li][pi][1]]), { units: 'kilometers' }) <= toleranceKm) {
                                    isInside = true; break outer;
                                }
                            }
                        }
                    }

                } else if (type === 'Polygon' || type === 'MultiPolygon') {
                    isInside = turf.booleanPointInPolygon(clickPt, layer.feature);
                    if (!isInside) {
                        try {
                            var lines = turf.polygonToLine(layer.feature);
                            var lineFeats = lines.type === 'FeatureCollection' ? lines.features : [lines];
                            lineFeats.forEach(function (l) {
                                if (turf.pointToLineDistance(clickPt, l, { units: 'kilometers' }) <= toleranceKm)
                                    isInside = true;
                            });
                        } catch (err2) {}
                    }
                }
            } catch (err) {
                console.warn('Geometria ignorada no click:', err);
            }

            if (isInside) {
                foundFeatures.push({
                    title: layerGroup.options.customTitle || layerKey,
                    layerKey: layerKey,
                    props: layer.feature.properties
                });
            }
        });
    });

    if (foundFeatures.length > 0) showMultiPopup(foundFeatures, e.latlng);
});

function showMultiPopup(features, latlng) {
    var popupId = 'layer-popup-' + Date.now();
    var html = '<div class="layer-popup" id="' + popupId + '">';

    if (features.length === 1) {
        html += buildFeatureTable(features[0].title, features[0].props, 1, 1);
    } else {
        html += '<div class="layer-popup-toolbar">';
        html += '<label class="layer-popup-select-label" for="' + popupId + '-select">Camada</label>';
        html += '<select class="layer-popup-select" id="' + popupId + '-select" onchange="switchLayerPopup(\'' + popupId + '\', this.value)">';
        features.forEach(function (f, idx) {
            html += '<option value="' + idx + '">' + escHtml(f.title) + (features.length > 1 ? ' #' + (idx + 1) : '') + '</option>';
        });
        html += '</select></div>';
        html += '<div class="layer-popup-tabs" role="tablist">';
        features.forEach(function (f, idx) {
            html += '<button type="button" class="multi-tab-btn' + (idx === 0 ? ' active' : '') + '"'
                  + ' data-popup-id="' + popupId + '" data-idx="' + idx + '" onclick="switchLayerPopup(\'' + popupId + '\', ' + idx + ')">'
                  + escHtml(f.title) + '</button>';
        });
        html += '</div><div class="layer-popup-contents">';
        features.forEach(function (f, idx) {
            html += '<div class="multi-tab-pane' + (idx === 0 ? ' active' : '') + '" data-popup-id="' + popupId + '" data-idx="' + idx + '">';
            html += buildFeatureTable(f.title, f.props, idx + 1, features.length);
            html += '</div>';
        });
        html += '</div>';
    }

    html += '</div>';
    L.popup({
        className: 'layer-data-popup',
        minWidth: 300,
        maxWidth: Math.min(520, Math.max(320, window.innerWidth - 40)),
        maxHeight: Math.max(220, window.innerHeight - 120),
        autoPanPadding: [24, 80]
    }).setLatLng(latlng).setContent(html).openOn(map);
}

function buildFeatureTable(title, props, index, total) {
    var html = '<div class="custom-popup-header"><span>' + escHtml(title) + '</span>';
    if (total > 1) html += '<small>' + index + '/' + total + '</small>';
    html += '</div>';
    html += '<table class="custom-popup-table">';
    for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var value      = props[key];
        var valDisplay = (value === null || value === '') ? '-' : escHtml(String(value));
        html += '<tr>'
              + '<td class="custom-popup-key">'
              + escHtml(key) + '</td>'
              + '<td class="custom-popup-value">'
              + valDisplay + '</td></tr>';
    }
    html += '</table>';
    return html;
}

window.switchLayerPopup = function (popupId, activeIdx) {
    activeIdx = parseInt(activeIdx, 10);
    var popup = document.getElementById(popupId);
    if (!popup || Number.isNaN(activeIdx)) return;

    popup.querySelectorAll('.multi-tab-btn').forEach(function (btn) {
        var isActive = parseInt(btn.getAttribute('data-idx'), 10) === activeIdx;
        btn.classList.toggle('active', isActive);
    });
    popup.querySelectorAll('.multi-tab-pane').forEach(function (pane) {
        var isActive = parseInt(pane.getAttribute('data-idx'), 10) === activeIdx;
        pane.classList.toggle('active', isActive);
    });
    var select = popup.querySelector('.layer-popup-select');
    if (select) select.value = String(activeIdx);
};
