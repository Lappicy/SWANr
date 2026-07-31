var map = L.map('map', {
    zoomControl: false,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    minZoom: 2
});
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

satellite.addTo(map);
labels.addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(map);
map.fitBounds([[-57, -84], [14, -32]], { padding: [24, 24] });

var CoordControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        var container = L.DomUtil.create('div', 'coord-display leaflet-control');
        container.innerHTML = '<i data-lucide="crosshair"></i><span id="map-coords">0,000 0,000 Graus</span>';
        return container;
    }
});

map.addControl(new CoordControl());
renderIcons();

[
    ['referencePolygonsPane', 430],
    ['operaTilesPane', 438],
    ['swotTilesPane', 440],
    ['swordReachesPane', 452],
    ['stationPointsPane', 450],
    ['swordNodesPane', 458],
    ['orbitLinesPane', 460],
    ['searchHighlightPane', 470]
].forEach(function (definition) {
    var pane = map.createPane(definition[0]);
    pane.style.zIndex = String(definition[1]);
    pane.style.pointerEvents = 'auto';
});

var stationRenderer = L.canvas({
    pane: 'stationPointsPane',
    padding: 0.5,
    tolerance: 5
});

var operaTileRenderer = L.canvas({
    pane: 'operaTilesPane',
    padding: 0.5,
    tolerance: 3
});

var swordReachRenderer = L.canvas({
    pane: 'swordReachesPane',
    padding: 0.5,
    tolerance: 4
});

var swordNodeRenderer = L.canvas({
    pane: 'swordNodesPane',
    padding: 0.5,
    tolerance: 4
});

var lastMoveTime = 0;
var drawnItems = new L.FeatureGroup();
var uploadedLayer = null;
var stateLayer = null;
var activeLayers = {};
var layerSearchResults = [];
var pendingLayerFocus = null;
var searchHighlightLayer = null;
var currentSearchSource = 'SWOT';
var earthdataCredentialsConfigured = false;
var pendingDownloadRequest = null;
var operaSubproductDescriptions = {
    WTR: 'Classe temática completa: água, não água e classes auxiliares de superfície.',
    BWTR: 'Mapa binário simplificado, separando água e não água.',
    CONF: 'Camada de confiança da classificação, útil para filtrar pixels menos seguros.',
    DIAG: 'Diagnóstico dos testes positivos usados na detecção de água.',
    WTR2: 'Alternativa menos mascarada, mantendo mais pixels candidatos a água.'
};

map.addLayer(drawnItems);

var drawControl = new L.Control.Draw({
    draw: {
        polygon: false,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: { shapeOptions: { color: '#1677b8' } }
    },
    edit: { featureGroup: drawnItems, remove: true },
    position: 'topright'
});

map.addControl(drawControl);

map.on('mousemove', function (e) {
    var now = Date.now();
    if (now - lastMoveTime < 50) return;
    lastMoveTime = now;

    var lat = e.latlng.lat.toFixed(3).replace('.', ',');
    var lng = e.latlng.lng.toFixed(3).replace('.', ',');
    var coordSpan = document.getElementById('map-coords');
    if (coordSpan) coordSpan.innerText = lng + ' ' + lat + ' Graus';
});

map.on(L.Draw.Event.CREATED, function (e) {
    limparTudoMenos('draw');
    drawnItems.addLayer(e.layer);
    updateCoords(e.layer.getBounds());
});

map.on(L.Draw.Event.DELETED, function () {
    updateCoords(null);
});

function renderIcons() {
    if (window.lucide) window.lucide.createIcons();
}

function toggleLayerGroupButton(button) {
    var group = button && button.closest('.layer-group');
    if (!group) return;
    var collapsed = group.classList.toggle('collapsed');
    button.setAttribute('aria-expanded', String(!collapsed));
    renderIcons();
}

function icon(name) {
    return '<i data-lucide="' + name + '"></i>';
}

function setButton(button, iconName, text) {
    if (!button) return;
    button.innerHTML = icon(iconName) + '<span>' + escHtml(text) + '</span>';
    renderIcons();
}

function startLoading() {
    document.getElementById('map').classList.add('map-loading');
}

function stopLoading() {
    document.getElementById('map').classList.remove('map-loading');
}

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
        setTimeout(function () { toast.remove(); }, 250);
    }, duration);
}

function trocarBasemap(tipo) {
    if (tipo === 'sat') {
        if (!map.hasLayer(satellite)) map.addLayer(satellite);
        if (!map.hasLayer(labels)) map.addLayer(labels);
        if (map.hasLayer(street)) map.removeLayer(street);
        return;
    }

    if (!map.hasLayer(street)) map.addLayer(street);
    if (map.hasLayer(satellite)) map.removeLayer(satellite);
    if (map.hasLayer(labels)) map.removeLayer(labels);
}

function refreshMapLayout() {
    window.setTimeout(function () {
        map.invalidateSize({ pan: false });
    }, 250);
}

function switchTab(t, forceOpen) {
    var panel = document.getElementById('main-panel');
    var clickedNav = document.getElementById('nav-' + t);
    var isAlreadyActive = clickedNav && clickedNav.classList.contains('active');
    var isCollapsed = document.body.classList.contains('panel-collapsed');

    if (isAlreadyActive && !isCollapsed && !forceOpen) {
        document.body.classList.add('panel-collapsed');
        refreshMapLayout();
        return;
    }

    panel.style.display = 'flex';
    document.body.classList.remove('panel-collapsed');

    document.querySelectorAll('.panel-body').forEach(function (view) {
        view.classList.add('hidden');
    });

    document.querySelectorAll('.nav-item[data-tab]').forEach(function (item) {
        item.classList.remove('active');
    });

    var view = document.getElementById('view-' + t);
    if (view) view.classList.remove('hidden');
    if (clickedNav) clickedNav.classList.add('active');
    refreshMapLayout();
}

function resetarConsulta() {
    currentSearchSource = 'SWOT';
    document.getElementById('searchForm').reset();
    limparArea();
    toggleDataSource();
    toggleSubproducts();
    document.getElementById('date-msg').classList.add('hidden');
    document.getElementById('results-list').innerHTML = '';
    document.getElementById('results-meta').classList.add('hidden');
    document.getElementById('btn-download-selected').classList.add('hidden');
    document.getElementById('nav-resultados').classList.add('disabled');
    switchTab('swot', true);
}

function selectedDataSource() {
    var select = document.getElementById('data_source');
    return select ? select.value : 'SWOT';
}

function setControlsDisabled(container, disabled) {
    if (!container) return;
    container.querySelectorAll('input, select, textarea, button').forEach(function (control) {
        control.disabled = disabled;
    });
}

function updateOperaSubproductHelp() {
    var select = document.getElementById('opera_subproduto');
    var help = document.getElementById('opera-subproduct-help');
    if (!select || !help) return;
    var value = select.value || 'WTR';
    help.innerHTML = '<strong>' + escHtml(value) + '</strong> — ' + escHtml(operaSubproductDescriptions[value] || '');
}

function refreshCredentialStatus() {
    var status = document.getElementById('credential-status');
    if (!status) return;
    if (selectedDataSource() === 'ANA') {
        status.classList.remove('missing');
        status.classList.add('ready');
        status.textContent = 'Consulta via Hidroweb/ANA; credenciais Earthdata não são necessárias.';
        return;
    }
    status.classList.toggle('ready', Boolean(earthdataCredentialsConfigured));
    status.classList.toggle('missing', !earthdataCredentialsConfigured);
    status.textContent = earthdataCredentialsConfigured
        ? 'Credenciais Earthdata configuradas.'
        : 'Busca disponível; configure as credenciais Earthdata para baixar.';
}

function toggleDataSource() {
    var source = selectedDataSource();
    var swotFields = document.getElementById('swot-product-fields');
    var operaFields = document.getElementById('opera-product-fields');
    var anaFields = document.getElementById('ana-product-fields');
    var operaFinalizing = document.getElementById('opera-finalizing');
    var periodBlock = document.querySelector('.query-period-block');
    var swotIdentification = document.querySelector('.swot-identification-block');
    var anaAdditional = document.querySelector('.ana-additional-block');
    var queryButton = document.getElementById('btn-container');
    var operaQueryButton = document.querySelector('.opera-query-button-block');
    var startDate = document.getElementById('start_date');
    var endDate = document.getElementById('end_date');
    var dateMsg = document.getElementById('date-msg');
    var isSwot = source === 'SWOT';
    var isOpera = source === 'OPERA';
    var isAna = source === 'ANA';

    if (swotFields) swotFields.classList.toggle('hidden', !isSwot);
    if (operaFields) operaFields.classList.toggle('hidden', !isOpera);
    if (anaFields) anaFields.classList.toggle('hidden', !isAna);
    if (operaFinalizing) operaFinalizing.classList.add('hidden');
    if (periodBlock) periodBlock.classList.remove('hidden');
    if (swotIdentification) swotIdentification.classList.toggle('hidden', !isSwot);
    if (anaAdditional) anaAdditional.classList.toggle('hidden', !isAna);
    if (queryButton) queryButton.classList.toggle('hidden', isOpera);
    if (operaQueryButton) operaQueryButton.classList.toggle('hidden', !isOpera);

    setControlsDisabled(swotFields, !isSwot);
    setControlsDisabled(operaFields, !isOpera);
    setControlsDisabled(anaFields, !isAna);
    if (anaAdditional) setControlsDisabled(anaAdditional, !isAna);
    if (swotIdentification) setControlsDisabled(swotIdentification, !isSwot);
    var dataSourceSelect = document.getElementById('data_source');
    if (dataSourceSelect) dataSourceSelect.disabled = false;
    if (startDate) startDate.min = isSwot ? '2022-02-15' : '';
    if (endDate) endDate.min = isSwot ? '2022-02-15' : '';
    if (dateMsg && !isSwot) {
        dateMsg.classList.add('hidden');
        dateMsg.textContent = '';
    }

    toggleSubproducts();
    updateOperaSubproductHelp();
    validarDatas();
    refreshCredentialStatus();
    renderIcons();
    refreshMapLayout();
}

function toggleSubproducts() {
    document.querySelectorAll('.sub-opts').forEach(function (el) {
        el.classList.add('hidden');
    });
    document.querySelectorAll('.sub-opts select').forEach(function (select) {
        select.disabled = true;
    });

    if (selectedDataSource() !== 'SWOT') return;

    var product = document.getElementById('produto').value;
    var divId = '';

    if (product === 'RiverSP') divId = 'sub-river';
    if (product === 'LakeSP') divId = 'sub-lake';
    if (product === 'Raster') divId = 'sub-raster';

    if (!divId) return;

    var target = document.getElementById(divId);
    target.classList.remove('hidden');
    target.querySelectorAll('select').forEach(function (select) {
        select.disabled = false;
    });
}

function validarDatas() {
    var start = document.getElementById('start_date');
    var end = document.getElementById('end_date');
    var msg = document.getElementById('date-msg');
    var min = new Date('2022-02-15T00:00:00');
    var calValEnd = new Date('2023-07-26T23:59:59');
    var d1 = start.value ? new Date(start.value + 'T00:00:00') : null;
    var d2 = end.value ? new Date(end.value + 'T00:00:00') : null;

    msg.classList.add('hidden');
    msg.textContent = '';
    msg.style.color = '#7a5200';
    msg.style.backgroundColor = '#fff6df';
    msg.style.borderColor = '#f4d58d';

    if (selectedDataSource() === 'SWOT' && ((d1 && d1 < min) || (d2 && d2 < min))) {
        showToast('O satélite não estava disponível antes de 15/02/2022.', 'warning');
        if (d1 && d1 < min) start.value = '';
        if (d2 && d2 < min) end.value = '';
        return;
    }

    if (d1 && d2 && d1 > d2) {
        msg.textContent = 'Data inicial deve ser anterior à data final.';
        msg.style.color = '#7d1b25';
        msg.style.backgroundColor = '#fff0f2';
        msg.style.borderColor = '#facbd2';
        msg.classList.remove('hidden');
        end.value = '';
        return;
    }

    if (selectedDataSource() === 'SWOT' && ((d1 && d1 <= calValEnd) || (d2 && d2 <= calValEnd))) {
        msg.textContent = 'Esse período engloba a fase de Cal/Val.';
        msg.classList.remove('hidden');
    }
}

function limparArea() {
    limparTudoMenos('reset');
    updateCoords(null);
    if (window.Shiny) {
        Shiny.setInputValue('clear_server_area', Date.now(), { priority: 'event' });
    }
}

function limparTudoMenos(tipo) {
    if (tipo !== 'draw') drawnItems.clearLayers();

    if (tipo !== 'upload') {
        if (uploadedLayer) {
            map.removeLayer(uploadedLayer);
            uploadedLayer = null;
        }
        document.getElementById('uploadedShapeName').value = '';
        document.getElementById('shapeStatus').innerText = '';
        document.getElementById('userShapeInput').value = '';
    }

    if (tipo !== 'state') {
        if (stateLayer) {
            map.removeLayer(stateLayer);
            stateLayer = null;
        }
        document.getElementById('brazil_states').value = '';
    }
}

function updateCoords(bounds) {
    if (!bounds) {
        ['lat_min', 'lat_max', 'lon_min', 'lon_max'].forEach(function (id) {
            document.getElementById(id).value = '';
        });
        return;
    }

    document.getElementById('lat_min').value = bounds.getSouth().toFixed(4);
    document.getElementById('lat_max').value = bounds.getNorth().toFixed(4);
    document.getElementById('lon_min').value = bounds.getWest().toFixed(4);
    document.getElementById('lon_max').value = bounds.getEast().toFixed(4);
}

function uploadShape() {
    var file = document.getElementById('userShapeInput').files[0];
    if (!file) return;

    limparTudoMenos('upload');
    startLoading();
    document.getElementById('shapeStatus').innerText = 'Enviando e lendo arquivo...';
}

function aplicarFiltroEstado() {
    var uf = document.getElementById('brazil_states').value;

    if (stateLayer) {
        map.removeLayer(stateLayer);
        stateLayer = null;
    }

    limparTudoMenos('state');
    if (!uf) updateCoords(null);
    else startLoading();
    Shiny.setInputValue('state_request', uf, { priority: 'event' });
}

function toggleCamada(checkbox, nomeArquivo, nomeExibicao, cor, tipo) {
    if (!checkbox.checked) {
        if (activeLayers[nomeArquivo]) map.removeLayer(activeLayers[nomeArquivo]);
        Shiny.setInputValue('layer_request', { name: nomeArquivo, enabled: false, nonce: Date.now() }, { priority: 'event' });
        return;
    }

    if (activeLayers[nomeArquivo]) {
        map.addLayer(activeLayers[nomeArquivo]);
        if (activeLayers[nomeArquivo].bringToFront) activeLayers[nomeArquivo].bringToFront();
        return;
    }

    startLoading();
    checkbox.disabled = true;

    Shiny.setInputValue(
        'layer_request',
        { name: nomeArquivo, enabled: true, title: nomeExibicao, color: cor, kind: tipo, nonce: Date.now() },
        { priority: 'event' }
    );
}

function runLayerSearch() {
    var input = document.getElementById('layer-search-input');
    var results = document.getElementById('layer-search-results');
    var query = input ? input.value.trim() : '';
    if (!query) {
        results.innerHTML = '<div class="layer-search-status">Digite uma sigla, nome ou código.</div>';
        return;
    }
    results.innerHTML = '<div class="layer-search-status">Pesquisando nas camadas...</div>';
    Shiny.setInputValue(
        'layer_search_request',
        { query: query, nonce: Date.now() },
        { priority: 'event' }
    );
}

function layerSearchIcon(layerName) {
    if (layerName === 'limites_BR') return 'map';
    if (layerName === 'Estacoes_hidrometeorologicas_ANA') return 'map-pin';
    if (layerName === 'SNIRH_OttobaciaNv1') return 'droplets';
    if (layerName === 'SWOT_orbits_BR') return 'orbit';
    if (layerName === 'SWOT_tiles_BR') return 'grid-3x3';
    if (layerName === 'OPERA_tiles') return 'blocks';
    if (layerName === 'SWORD_reaches_v17b') return 'route';
    if (layerName === 'SWORD_nodes_v17b') return 'circle-dot';
    return 'locate-fixed';
}

function renderLayerSearchResults(data) {
    var container = document.getElementById('layer-search-results');
    if (!container) return;
    layerSearchResults = data.results || [];

    if (data.status !== 'success') {
        container.innerHTML = '<div class="layer-search-status error">'
            + escHtml(data.message || 'Não foi possível pesquisar as camadas.')
            + '</div>';
        return;
    }
    if (!layerSearchResults.length) {
        container.innerHTML = '<div class="layer-search-status">Nenhum item encontrado para “'
            + escHtml(data.query || '')
            + '”.</div>';
        return;
    }

    container.innerHTML = '';
    layerSearchResults.forEach(function (result, index) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-search-result';
        button.innerHTML = icon(layerSearchIcon(result.layer_name))
            + '<span class="layer-search-result-copy"><strong>'
            + escHtml(result.title)
            + '</strong><small>'
            + escHtml(result.subtitle || '')
            + '</small></span>'
            + icon('chevron-right');
        button.addEventListener('click', function () {
            focusLayerSearchResult(layerSearchResults[index]);
        });
        container.appendChild(button);
    });
    renderIcons();
}

function featureSearchValue(feature, field) {
    var props = feature && feature.properties ? feature.properties : {};
    if (field === '__search_key') {
        return [props.Pass, props.Tile, props.Scene].join('|');
    }
    return String(props[field] === undefined || props[field] === null ? '' : props[field]);
}

function focusLayerSearchResult(result) {
    pendingLayerFocus = result;
    var checkbox = document.querySelector('[data-layer="' + result.layer_name + '"]');
    if (!checkbox) return;

    if (!checkbox.checked) {
        checkbox.checked = true;
        toggleCamada(
            checkbox,
            checkbox.getAttribute('data-layer'),
            checkbox.getAttribute('data-title'),
            checkbox.getAttribute('data-color'),
            checkbox.getAttribute('data-kind')
        );
        return;
    }
    if (activeLayers[result.layer_name]) {
        applyLayerSearchFocus(result);
    }
}

function applyLayerSearchFocus(result) {
    var group = activeLayers[result.layer_name];
    if (!group) return;
    var target = null;
    group.eachLayer(function (layer) {
        if (target || !layer.feature) return;
        if (featureSearchValue(layer.feature, result.match_field) === String(result.match_value)) {
            target = layer;
        }
    });

    if (searchHighlightLayer) {
        map.removeLayer(searchHighlightLayer);
        searchHighlightLayer = null;
    }

    var bbox = result.bbox || [];
    var bounds = bbox.length === 4
        ? L.latLngBounds([bbox[1], bbox[0]], [bbox[3], bbox[2]])
        : null;

    if (target && target.getLatLng) {
        var point = target.getLatLng();
        map.setView(point, Math.max(map.getZoom(), 11));
        searchHighlightLayer = L.circleMarker(point, {
            pane: 'searchHighlightPane',
            radius: 11,
            color: '#ffffff',
            weight: 4,
            opacity: 1,
            fillColor: '#ff8a00',
            fillOpacity: 0.85,
            interactive: false
        }).addTo(map);
    } else if (target && target.feature) {
        searchHighlightLayer = L.geoJSON(target.feature, {
            pane: 'searchHighlightPane',
            interactive: false,
            style: {
                color: '#ff8a00',
                weight: 5,
                opacity: 1,
                fillColor: '#ffb347',
                fillOpacity: 0.08
            }
        }).addTo(map);
        if (searchHighlightLayer.getBounds().isValid()) {
            map.fitBounds(searchHighlightLayer.getBounds(), { padding: [55, 55], maxZoom: 10 });
        }
    } else if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [55, 55], maxZoom: 10 });
    }

    if (target && target.feature) {
        var popupLocation = target.getLatLng
            ? target.getLatLng()
            : (target.getBounds ? target.getBounds().getCenter() : bounds.getCenter());
        L.popup({ maxHeight: window.innerHeight * 0.5 })
            .setLatLng(popupLocation)
            .setContent(buildFeatureTable(result.title, target.feature.properties || {}))
            .openOn(map);
    }
    pendingLayerFocus = null;
    showToast('Item localizado no mapa.', 'success', 3000);

    window.setTimeout(function () {
        if (searchHighlightLayer) {
            map.removeLayer(searchHighlightLayer);
            searchHighlightLayer = null;
        }
    }, 9000);
}

function setQueryProgressState(data) {
    data = data || {};
    if (data.source && currentSearchSource && data.source !== currentSearchSource) return;

    var loader = document.getElementById('progress-container');
    var bar = document.getElementById('progress-fill');
    var barBg = document.querySelector('.progress-bar-bg');
    var percentText = document.getElementById('progress-percent');
    var loaderMessage = document.getElementById('loader-message');
    var loaderDetail = document.getElementById('loader-detail');
    if (!loader || !bar) return;

    var percent = Number(data.percent);
    if (!Number.isFinite(percent)) percent = 0;
    percent = Math.max(0, Math.min(100, Math.round(percent)));

    loader.classList.remove('hidden');
    bar.classList.remove('progress-filling');
    bar.style.width = percent + '%';
    if (barBg) barBg.setAttribute('aria-valuenow', String(percent));
    if (percentText) percentText.textContent = percent + '%';
    if (loaderMessage && data.message) loaderMessage.textContent = data.message;
    if (loaderDetail) loaderDetail.textContent = data.detail || 'Aguardando resposta do servidor...';
}

function buscarDados() {
    var source = selectedDataSource();
    currentSearchSource = source;

    var product = source === 'ANA'
        ? document.getElementById('ana_produto').value
        : (source === 'OPERA'
            ? document.getElementById('opera_produto').value
            : document.getElementById('produto').value);
    var startDate = document.getElementById('start_date').value;
    var endDate = document.getElementById('end_date').value;

    if (!product) {
        showToast('Selecione um produto antes de consultar.', 'warning');
        return;
    }

    if (!startDate || !endDate) {
        showToast('Preencha a data inicial e a data final.', 'warning');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        showToast('As datas estão invertidas. Corrija o período.', 'warning');
        return;
    }

    switchTab('resultados', true);
    updateResultsContext(source);

    var list = document.getElementById('results-list');
    var loader = document.getElementById('progress-container');
    var bar = document.getElementById('progress-fill');
    var btnDown = document.getElementById('btn-download-selected');
    var loaderMessage = document.getElementById('loader-message');

    list.innerHTML = '';
    list.classList.add('hidden');
    document.getElementById('results-meta').classList.add('hidden');
    if (btnDown) btnDown.classList.add('hidden');
    document.getElementById('nav-resultados').classList.remove('disabled');

    setQueryProgressState({
        source: source,
        percent: 3,
        message: source === 'ANA'
            ? 'Buscando na ANA...'
            : (source === 'OPERA' ? 'Preparando OPERA...' : 'Buscando na NASA...'),
        detail: 'Enviando solicitação ao servidor...'
    });

    var formData = new FormData(document.getElementById('searchForm'));
    var reqData = Object.fromEntries(formData);
    delete reqData.userShapeInput;
    reqData.shape_filename = document.getElementById('uploadedShapeName').value;
    reqData.state_uf = document.getElementById('brazil_states').value;
    reqData.nonce = Date.now();
    Shiny.setInputValue('search_request', reqData, { priority: 'event' });
}

function updateResultsContext(source) {
    var kicker = document.getElementById('results-kicker');
    var description = document.getElementById('results-description');
    var label = document.getElementById('total-label');
    if (source === 'ANA') {
        if (kicker) kicker.textContent = 'Hidroweb / ANA';
        if (description) description.textContent = 'Selecione as estações que deseja exportar em TXT.';
        if (label) label.textContent = 'estações';
        return;
    }
    if (source === 'OPERA') {
        if (kicker) kicker.textContent = 'OPERA / DSWx';
        if (description) description.textContent = 'Selecione os arquivos OPERA baixados para gerar o ZIP.';
        if (label) label.textContent = 'arquivos';
        return;
    }
    if (kicker) kicker.textContent = 'Catálogo Earthdata';
    if (description) description.textContent = 'Selecione os arquivos que deseja baixar ou recortar pela área definida.';
    if (label) label.textContent = 'arquivos';
}

function renderResults(results, source) {
    source = source || currentSearchSource || selectedDataSource();
    updateResultsContext(source);
    var list = document.getElementById('results-list');
    var btnDown = document.getElementById('btn-download-selected');
    var totalBytes = 0;

    results.forEach(function (file) {
        if (file.size && file.size !== 'N/A') totalBytes += parseFloat(file.size) || 0;
    });

    document.getElementById('total-count').innerText = results.length;
    document.getElementById('total-size').innerText = totalBytes.toFixed(2) + ' MB';
    document.getElementById('results-meta').classList.remove('hidden');

    var shapeName = document.getElementById('uploadedShapeName').value;
    var stateUF = document.getElementById('brazil_states').value;
    var latMinVal = document.getElementById('lat_min').value;
    var willCrop = source === 'SWOT' && (shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== '');

    btnDown.classList.remove('hidden');
    btnDown.disabled = true;
    btnDown.style.backgroundColor = willCrop ? '#d36b00' : '#1677b8';
    if (source === 'ANA') {
        setButton(btnDown, 'download', 'Baixar Estações Selecionadas');
    } else if (source === 'OPERA') {
        setButton(btnDown, 'download', 'Baixar Arquivos OPERA Selecionados');
    } else {
        setButton(btnDown, willCrop ? 'scissors' : 'download', willCrop ? 'Recortar e Baixar Selecionados' : 'Baixar Originais Selecionados');
    }

    var selectAll = document.getElementById('select-all');
    if (selectAll) selectAll.checked = false;

    results.forEach(function (file, index) {
        var item = document.createElement('div');
        item.className = 'result-item';

        var info = document.createElement('div');
        info.className = 'result-info';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = file.download_link;
        checkbox.id = 'cb-' + index;
        checkbox.addEventListener('change', verificarSelecao);

        var text = document.createElement('div');
        text.className = 'result-text';

        var filename = document.createElement('div');
        filename.className = 'result-filename';
        filename.title = file.filename;
        filename.textContent = file.filename;

        var size = document.createElement('div');
        size.className = 'result-size';
        size.innerHTML = escHtml(String(file.size)) + ' MB <span id="status-' + index + '"></span>';

        text.appendChild(filename);
        text.appendChild(size);
        info.appendChild(checkbox);
        info.appendChild(text);
        item.appendChild(info);
        list.appendChild(item);
    });

    verificarSelecao();
}

function verificarSelecao() {
    var selected = document.querySelectorAll('.result-item input:checked');
    var btn = document.querySelector('.btn-aneel.download');
    if (btn) btn.disabled = selected.length === 0;
}

function toggleSelectAll() {
    var selectAll = document.getElementById('select-all');
    if (!selectAll) return;

    document.querySelectorAll('.result-item input[type="checkbox"]').forEach(function (checkbox) {
        checkbox.checked = selectAll.checked;
    });
    verificarSelecao();
}

function safeDownloadPart(value, fallback) {
    var cleaned = String(value || fallback || 'SWANr')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned || fallback || 'SWANr';
}

function buildSuggestedDownloadName(request) {
    request = request || {};
    var date = new Date().toISOString().slice(0, 10);
    if (request.data_source === 'OPERA') {
        return [
            'OPERA',
            safeDownloadPart(request.product, 'Produto'),
            safeDownloadPart(request.subproduct, 'Dados'),
            safeDownloadPart(request.area_name, 'Area'),
            date
        ].join('_') + '.zip';
    }
    return 'SWANr_download_' + date + '.zip';
}

async function saveLinkWithPicker(link, suggestedName) {
    var handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }]
    });
    var response = await fetch(link.href, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Falha ao gerar o ZIP.');
    var writable = await handle.createWritable();
    if (response.body && response.body.pipeTo) {
        await response.body.pipeTo(writable);
    } else {
        await writable.write(await response.blob());
        await writable.close();
    }
}

function baixarSelecionados() {
    var cbs = document.querySelectorAll('.result-item input:checked');
    if (cbs.length === 0) return;

    var source = currentSearchSource || selectedDataSource();
    var shapeName = document.getElementById('uploadedShapeName').value;
    var stateUF = document.getElementById('brazil_states').value;
    var latMinVal = document.getElementById('lat_min').value;
    var willCrop = source === 'SWOT' && (shapeName || (stateUF && stateUF !== 'BR') || latMinVal !== '');
    var btn = document.querySelector('.btn-aneel.download');
    var totalSizeMB = 0;

    cbs.forEach(function (checkbox) {
        var sizeDiv = checkbox.closest('.result-info').querySelector('.result-size');
        var match = sizeDiv && (sizeDiv.innerText || sizeDiv.textContent).match(/([\d.]+)\s*MB/);
        if (match) totalSizeMB += parseFloat(match[1]);
    });

    var sizeDisplay = totalSizeMB >= 1024
        ? (totalSizeMB / 1024).toFixed(2) + ' GB'
        : totalSizeMB.toFixed(2) + ' MB';

    showToast(
        cbs.length + (source === 'ANA' ? ' estação(ões), ' : ' arquivo(s), ') + sizeDisplay + (willCrop ? '. Preparando recortes...' : '. Preparando download...'),
        'info',
        5000
    );
    btn.disabled = true;
    var originalText = btn.innerHTML;
    setButton(
        btn,
        'loader-circle',
        source === 'ANA' || source === 'OPERA'
            ? 'Gerando ZIP...'
            : (willCrop ? 'Recortando...' : 'Baixando...')
    );

    var product = source === 'ANA'
        ? document.getElementById('ana_produto').value
        : (source === 'OPERA'
            ? document.getElementById('opera_produto').value
            : document.getElementById('produto').value);
    var request = {
        data_source: source,
        urls: Array.from(cbs).map(function (checkbox) { return checkbox.value; }),
        crop: Boolean(willCrop),
        product: product,
        subproduct: getSelectedSubproduct(product),
        area_name: getAreaName(shapeName, stateUF),
        shape_filename: shapeName,
        state_uf: stateUF,
        lon_min: document.getElementById('lon_min').value,
        lat_min: document.getElementById('lat_min').value,
        lon_max: document.getElementById('lon_max').value,
        lat_max: document.getElementById('lat_max').value,
        nonce: Date.now()
    };
    pendingDownloadRequest = request;

    Shiny.setInputValue('download_request', request, { priority: 'event' });
    if (!(source === 'OPERA' && window.showSaveFilePicker)) {
        setTimeout(function () {
            btn.disabled = false;
            btn.innerHTML = originalText;
            renderIcons();
        }, 1800);
    }
}

function getSelectedSubproduct(product) {
    if ((currentSearchSource || selectedDataSource()) === 'ANA') {
        var anaSub = document.getElementById('ana_subproduto');
        return anaSub ? anaSub.value : 'vazao_diaria';
    }
    if ((currentSearchSource || selectedDataSource()) === 'OPERA') {
        var operaSub = document.getElementById('opera_subproduto');
        return operaSub ? operaSub.value : 'WTR';
    }
    if (product === 'RiverSP') return document.querySelector('#sub-river select[name="subproduto"]').value;
    if (product === 'LakeSP') return document.querySelector('#sub-lake select[name="subproduto"]').value;
    if (product === 'Raster') return document.querySelector('#sub-raster select[name="resolucao"]').value;
    if (product === 'PIXC') return 'Nuvem';
    return 'Dados';
}

function getAreaName(shapeName, stateUF) {
    if (shapeName) return shapeName.split('.').slice(0, -1).join('.').replace(/[^a-zA-Z0-9_-]/g, '') || 'Area';
    if (stateUF && stateUF !== 'BR') return stateUF;
    return 'AreaLivre';
}

async function processarFilaDownloads(tarefas, btn, textoOriginal, nomeFinalZip) {
    var fileHandle = null;

    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: nomeFinalZip + '.zip',
                types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }]
            });
        } catch (error) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
            renderIcons();
            return;
        }
    } else {
        showToast('O navegador salvará o arquivo na pasta Downloads.', 'warning', 5000);
    }

    setButton(btn, 'loader-circle', 'Processando (0/' + tarefas.length + ')...');

    var zip = new JSZip();
    var counts = { salvos: 0, vazios: 0, erros: 0 };
    var report = '========================================\n'
        + 'RELATÓRIO DE DOWNLOAD - SWOT NASA\n'
        + '========================================\n'
        + 'Data: ' + new Date().toLocaleString() + '\n'
        + 'Total de arquivos: ' + tarefas.length + '\n\n';
    var results = new Array(tarefas.length);
    var concurrency = 3;
    var nextIndex = 0;
    var finished = 0;

    async function worker() {
        while (nextIndex < tarefas.length) {
            var i = nextIndex++;
            var task = tarefas[i];
            results[i] = await baixarRecortado(task.url, task.statusId, task.shape, task.state, task.lon_min, task.lat_min, task.lon_max, task.lat_max);
            finished++;
            setButton(btn, 'loader-circle', 'Processando (' + finished + '/' + tarefas.length + ')...');
        }
    }

    var workers = [];
    for (var w = 0; w < Math.min(concurrency, tarefas.length); w++) workers.push(worker());
    await Promise.all(workers);

    results.forEach(function (result, i) {
        var fileName = tarefas[i].url.split('/').pop().split('?')[0];
        report += '> ' + fileName + '\n  Status: ' + result.msg + '\n\n';

        if (result.tipo === 'salvo') {
            counts.salvos++;
            if (result.blob && result.nomeFinal) zip.file(result.nomeFinal, result.blob);
        } else if (result.tipo === 'vazio') {
            counts.vazios++;
        } else {
            counts.erros++;
        }
    });

    report += '========================================\n'
        + 'RESUMO:\n'
        + '- Baixados: ' + counts.salvos + '\n'
        + '- Sem sobreposição: ' + counts.vazios + '\n'
        + '- Falhas: ' + counts.erros + '\n';
    zip.file('Relatorio_SWOT.txt', report);

    setButton(btn, 'archive', 'Salvando ZIP...');

    try {
        var content = await zip.generateAsync({ type: 'blob' });
        if (fileHandle) {
            var writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            showToast('ZIP salvo com sucesso. Baixados: ' + counts.salvos + ', sem dados: ' + counts.vazios + '.', 'success', 7000);
        } else {
            baixarBlob(content, nomeFinalZip + '.zip');
        }
    } catch (error) {
        showToast('Erro ao gravar o arquivo ZIP.', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = textoOriginal;
    renderIcons();
}

async function baixarRecortado(url, statusId, shape, stateUF, lonMin, latMin, lonMax, latMax) {
    var statusSpan = document.getElementById(statusId);
    if (statusSpan) {
        statusSpan.innerText = 'Recortando...';
        statusSpan.style.color = '#d36b00';
    }

    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 3 * 60 * 1000);

    try {
        var reqBody = { granule_url: url };
        if (shape) reqBody.shape_filename = shape;
        if (stateUF) reqBody.state_uf = stateUF;
        if (lonMin !== '') {
            reqBody.lon_min = lonMin;
            reqBody.lat_min = latMin;
            reqBody.lon_max = lonMax;
            reqBody.lat_max = latMax;
        }

        var response = await fetch('/download_cropped', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
            var contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                var data = await response.json();
                if (data.status === 'no_data') {
                    if (statusSpan) {
                        statusSpan.innerText = 'Sem sobreposição';
                        statusSpan.style.color = '#7a5200';
                        statusSpan.title = 'Sem sobreposição na área de interesse';
                    }
                    return { tipo: 'vazio', msg: 'Sem sobreposição na área de interesse.' };
                }
            }

            var blob = await response.blob();
            var originalName = url.split('/').pop().split('?')[0];
            var nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            var ext = '.geojson';
            var lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('.zip')) ext = '.zip';
            if (lowerUrl.includes('.nc')) ext = '.nc';
            if (lowerUrl.includes('.gpkg')) ext = '.gpkg';

            if (statusSpan) {
                statusSpan.innerText = 'Salvo';
                statusSpan.style.color = '#16834a';
            }
            return { tipo: 'salvo', msg: 'Recorte efetuado com sucesso.', blob: blob, nomeFinal: 'recorte_' + nameWithoutExt + ext };
        }

        var err = await response.json().catch(function () { return {}; });
        var errorMessage = err.error || 'Erro desconhecido';
        if (statusSpan) {
            statusSpan.innerText = 'Falha';
            statusSpan.style.color = '#c92a3a';
            statusSpan.title = errorMessage;
        }
        return { tipo: 'erro', msg: 'Falha: ' + errorMessage };
    } catch (error) {
        clearTimeout(timeout);
        var msg = error.name === 'AbortError'
            ? 'Timeout: servidor demorou mais de 3 minutos.'
            : 'Falha de comunicação com o servidor.';
        if (statusSpan) {
            statusSpan.innerText = error.name === 'AbortError' ? 'Timeout' : 'Sem conexão';
            statusSpan.style.color = '#c92a3a';
        }
        return { tipo: 'erro', msg: msg };
    }
}

function baixarBlob(blob, nome) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = nome;
    anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

map.on('click', function (e) {
    if (Object.keys(activeLayers).length === 0) return;

    var clickPoint = turf.point([e.latlng.lng, e.latlng.lat]);
    var foundGroups = [];
    var toleranceKm = 2000 / Math.pow(2, map.getZoom());

    Object.keys(activeLayers).forEach(function (layerKey) {
        var layerGroup = activeLayers[layerKey];
        if (!layerGroup || !map.hasLayer(layerGroup)) return;

        var group = {
            key: layerKey,
            title: layerGroup.options.customTitle || layerKey,
            features: []
        };

        layerGroup.eachLayer(function (layer) {
            if (!layer.feature || !layer.feature.geometry) return;
            if (featureMatchesClick(layer.feature, clickPoint, toleranceKm)) {
                var props = layer.feature.properties || {};
                group.features.push({
                    label: featureOptionLabel(props, group.features.length + 1),
                    props: props
                });
            }
        });

        if (group.features.length > 0) foundGroups.push(group);
    });

    if (foundGroups.length > 0) showMultiPopup(foundGroups, e.latlng);
});

function featureMatchesClick(feature, clickPoint, toleranceKm) {
    var geom = feature.geometry;
    var type = geom.type;

    try {
        if (type === 'Point') return pointNear(clickPoint, geom.coordinates, toleranceKm);
        if (type === 'MultiPoint') {
            return geom.coordinates.some(function (coord) {
                return pointNear(clickPoint, coord, toleranceKm);
            });
        }
        if (type === 'LineString' || type === 'MultiLineString') return lineNear(clickPoint, feature, geom, toleranceKm);
        if (type === 'Polygon' || type === 'MultiPolygon') return polygonNear(clickPoint, feature, toleranceKm);
    } catch (error) {
        return false;
    }

    return false;
}

function pointNear(clickPoint, coord, toleranceKm) {
    return turf.distance(clickPoint, turf.point([coord[0], coord[1]]), { units: 'kilometers' }) <= toleranceKm;
}

function lineNear(clickPoint, feature, geom, toleranceKm) {
    try {
        return turf.pointToLineDistance(clickPoint, feature, { units: 'kilometers' }) <= toleranceKm;
    } catch (error) {
        var coords = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
        return coords.some(function (line) {
            return line.some(function (coord) {
                return pointNear(clickPoint, coord, toleranceKm);
            });
        });
    }
}

function polygonNear(clickPoint, feature, toleranceKm) {
    if (turf.booleanPointInPolygon(clickPoint, feature)) return true;

    try {
        var lines = turf.polygonToLine(feature);
        var lineFeatures = lines.type === 'FeatureCollection' ? lines.features : [lines];
        return lineFeatures.some(function (line) {
            return turf.pointToLineDistance(clickPoint, line, { units: 'kilometers' }) <= toleranceKm;
        });
    } catch (error) {
        return false;
    }
}

function featureOptionLabel(props, index) {
    var preferred = [
        'uf', 'UF', 'SIGLA_UF', 'Name', 'Nome', 'CodigoEstacao',
        'NUNIVOTTO1', 'reach_id', 'node_id'
    ];
    for (var i = 0; i < preferred.length; i++) {
        var key = preferred[i];
        if (props[key] !== undefined && props[key] !== null && String(props[key]).trim() !== '') {
            return String(props[key]);
        }
    }
    if (props.Tile !== undefined && props.Pass !== undefined) {
        return 'Tile ' + props.Tile + ' · Pass ' + props.Pass;
    }
    if (props.Pass !== undefined) return 'Pass ' + props.Pass;
    return 'Opção ' + index;
}

function showMultiPopup(groups, latlng) {
    var html = '<div class="popup-wrapper">';

    if (groups.length === 1 && groups[0].features.length === 1) {
        html += buildFeatureTable(groups[0].title, groups[0].features[0].props);
    } else {
        if (groups.length > 1) {
            html += '<div class="popup-tabs">';
            groups.forEach(function (group, groupIdx) {
                html += '<button type="button" class="multi-tab-btn ' + (groupIdx === 0 ? 'active' : '') + '" data-group="' + groupIdx + '">'
                    + escHtml(group.title)
                    + '</button>';
            });
            html += '</div>';
        }

        html += '<div id="multi-popup-contents">';
        groups.forEach(function (group, groupIdx) {
            html += '<div class="multi-tab-pane ' + (groupIdx === 0 ? '' : 'hidden') + '" data-group-pane="' + groupIdx + '">';
            html += buildLayerPopupPane(group, groupIdx);
            html += '</div>';
        });
        html += '</div>';
    }

    html += '</div>';
    L.popup({ maxHeight: window.innerHeight * 0.5 }).setLatLng(latlng).setContent(html).openOn(map);
    setTimeout(bindPopupTabs, 0);
}

function buildLayerPopupPane(group, groupIdx) {
    var html = '';
    if (group.features.length > 1) {
        html += '<div class="popup-feature-options">';
        group.features.forEach(function (feature, featureIdx) {
            html += '<button type="button" class="feature-option-btn ' + (featureIdx === 0 ? 'active' : '') + '" data-group="' + groupIdx + '" data-feature="' + featureIdx + '">'
                + escHtml(feature.label)
                + '</button>';
        });
        html += '</div>';
    }

    group.features.forEach(function (feature, featureIdx) {
        html += '<div class="popup-feature-pane ' + (featureIdx === 0 ? '' : 'hidden') + '" data-group="' + groupIdx + '" data-feature-pane="' + featureIdx + '">';
        html += buildFeatureTable(group.title, feature.props);
        html += '</div>';
    });
    return html;
}

function buildFeatureTable(title, props) {
    var html = '<div class="feature-title">' + escHtml(title) + '</div>';
    html += '<table class="feature-table">';

    Object.keys(props).forEach(function (key) {
        var value = props[key];
        var displayValue = value === null || value === '' ? '-' : escHtml(String(value));
        html += '<tr><td class="feature-key">' + escHtml(key) + '</td><td class="feature-value">' + displayValue + '</td></tr>';
    });

    html += '</table>';
    return html;
}

window.switchTabPopup = function (activeIdx) {
    document.querySelectorAll('.multi-tab-btn').forEach(function (btn) {
        var isActive = parseInt(btn.getAttribute('data-group'), 10) === activeIdx;
        btn.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.multi-tab-pane').forEach(function (pane) {
        pane.classList.toggle('hidden', parseInt(pane.getAttribute('data-group-pane'), 10) !== activeIdx);
    });
};

window.switchFeaturePopup = function (groupIdx, featureIdx) {
    document.querySelectorAll('.feature-option-btn[data-group="' + groupIdx + '"]').forEach(function (btn) {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-feature'), 10) === featureIdx);
    });

    document.querySelectorAll('.popup-feature-pane[data-group="' + groupIdx + '"]').forEach(function (pane) {
        pane.classList.toggle('hidden', parseInt(pane.getAttribute('data-feature-pane'), 10) !== featureIdx);
    });
};

function bindPopupTabs() {
    document.querySelectorAll('.multi-tab-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            window.switchTabPopup(parseInt(button.getAttribute('data-group'), 10));
        });
    });
    document.querySelectorAll('.feature-option-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            window.switchFeaturePopup(
                parseInt(button.getAttribute('data-group'), 10),
                parseInt(button.getAttribute('data-feature'), 10)
            );
        });
    });
}

function parseGeoJSON(value) {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

Shiny.addCustomMessageHandler('swotr-toast', function (data) {
    showToast(data.message, data.type || 'info', data.duration || 5000);
});

Shiny.addCustomMessageHandler('credentials-status', function (data) {
    earthdataCredentialsConfigured = Boolean(data.configured);
    refreshCredentialStatus();
});

Shiny.addCustomMessageHandler('shape-loaded', function (data) {
    if (uploadedLayer) map.removeLayer(uploadedLayer);
    if (stateLayer) {
        map.removeLayer(stateLayer);
        stateLayer = null;
    }
    document.getElementById('brazil_states').value = '';
    document.getElementById('uploadedShapeName').value = data.filename;
    document.getElementById('shapeStatus').innerText = 'Arquivo carregado: ' + data.filename;
    uploadedLayer = L.geoJSON(parseGeoJSON(data.geojson), {
        interactive: false,
        style: { color: '#d36b00', dashArray: '5,5', weight: 2 }
    }).addTo(map);
    map.fitBounds(uploadedLayer.getBounds());
    updateCoords(uploadedLayer.getBounds());
    stopLoading();
});

Shiny.addCustomMessageHandler('shape-error', function (data) {
    document.getElementById('uploadedShapeName').value = '';
    document.getElementById('shapeStatus').innerText = 'Erro: ' + (data.message || 'arquivo inválido');
    stopLoading();
});

Shiny.addCustomMessageHandler('state-loaded', function (data) {
    if (stateLayer) map.removeLayer(stateLayer);
    stateLayer = null;
    if (!data.uf || !data.bbox) {
        updateCoords(null);
        stopLoading();
        return;
    }
    if (data.geojson) {
        stateLayer = L.geoJSON(parseGeoJSON(data.geojson), {
            interactive: false,
            style: { color: '#1677b8', weight: 2, fillOpacity: 0.1 }
        }).addTo(map);
    }
    var b = data.bbox;
    var bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
    map.fitBounds(bounds);
    updateCoords(bounds);
    stopLoading();
});

Shiny.addCustomMessageHandler('state-error', function (data) {
    document.getElementById('brazil_states').value = '';
    updateCoords(null);
    stopLoading();
    showToast(data.message || 'Erro ao carregar estado.', 'error', 6000);
});

Shiny.addCustomMessageHandler('layer-loaded', function (data) {
    var checkbox = document.querySelector('[data-layer="' + data.name + '"]');
    if (!checkbox) return;
    var title = checkbox.getAttribute('data-title');
    var visual = {
        limites_BR: {
            pane: 'referencePolygonsPane',
            style: {
                color: '#111111',
                weight: 2.6,
                opacity: 1,
                fillColor: '#000000',
                fillOpacity: 0.14
            }
        },
        Estacoes_hidrometeorologicas_ANA: {
            pane: 'stationPointsPane',
            point: {
                radius: 2.3,
                color: '#064e8a',
                weight: 0.7,
                opacity: 1,
                fillColor: '#0099ff',
                fillOpacity: 0.78,
                renderer: stationRenderer,
                pane: 'stationPointsPane'
            }
        },
        SNIRH_OttobaciaNv1: {
            pane: 'referencePolygonsPane',
            style: {
                color: '#f1c900',
                weight: 3.2,
                opacity: 1,
                fillColor: '#ffd700',
                fillOpacity: 0.20
            }
        },
        SWOT_orbits_BR: {
            pane: 'orbitLinesPane',
            style: {
                color: '#f02032',
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0
            }
        },
        SWOT_tiles_BR: {
            pane: 'swotTilesPane',
            style: {
                color: '#00dbe8',
                weight: 0.85,
                opacity: 1,
                fillColor: '#00ffff',
                fillOpacity: 0.015
            }
        },
        OPERA_tiles: {
            pane: 'operaTilesPane',
            renderer: operaTileRenderer,
            style: {
                color: '#ff8a00',
                weight: 0.9,
                opacity: 1,
                fillColor: '#ff8a00',
                fillOpacity: 0.035
            }
        },
        SWORD_reaches_v17b: {
            pane: 'swordReachesPane',
            renderer: swordReachRenderer,
            style: {
                color: '#7c3aed',
                weight: 1.2,
                opacity: 0.92,
                fillOpacity: 0
            }
        },
        SWORD_nodes_v17b: {
            pane: 'swordNodesPane',
            point: {
                radius: 1.8,
                color: '#5b21b6',
                weight: 0.4,
                opacity: 0.9,
                fillColor: '#a855f7',
                fillOpacity: 0.70,
                renderer: swordNodeRenderer,
                pane: 'swordNodesPane'
            }
        }
    }[data.name];

    if (!visual) {
        visual = {
            pane: 'referencePolygonsPane',
            style: {
                color: checkbox.getAttribute('data-color') || '#1677b8',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.1
            }
        };
    }

    var layer = L.geoJSON(parseGeoJSON(data.geojson), {
        customTitle: title,
        interactive: true,
        pane: visual.pane,
        renderer: visual.renderer,
        style: function () {
            return visual.style;
        },
        pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, visual.point || {
                radius: 4,
                color: visual.style.color,
                weight: 1,
                opacity: 1,
                fillColor: visual.style.fillColor || visual.style.color,
                fillOpacity: 0.9,
                pane: visual.pane
            });
        }
    });
    activeLayers[data.name] = layer;
    if (checkbox.checked) {
        map.addLayer(layer);
        if (layer.bringToFront) layer.bringToFront();
    }
    checkbox.disabled = false;
    stopLoading();
    if (data.sampled) {
        showToast('SWORD Nodes carregado em visualização otimizada para manter o mapa rápido.', 'info', 5000);
    }
    if (pendingLayerFocus && pendingLayerFocus.layer_name === data.name) {
        window.setTimeout(function () {
            applyLayerSearchFocus(pendingLayerFocus);
        }, 150);
    }
});

Shiny.addCustomMessageHandler('layer-error', function (data) {
    var checkbox = document.querySelector('[data-layer="' + data.name + '"]');
    if (checkbox) {
        checkbox.checked = false;
        checkbox.disabled = false;
    }
    stopLoading();
    showToast(data.message || 'Erro ao carregar camada.', 'error', 6000);
});

Shiny.addCustomMessageHandler('query-progress', setQueryProgressState);

Shiny.addCustomMessageHandler('search-results', function (data) {
    var list = document.getElementById('results-list');
    var loader = document.getElementById('progress-container');
    var bar = document.getElementById('progress-fill');
    currentSearchSource = data.source || currentSearchSource || selectedDataSource();
    updateResultsContext(currentSearchSource);
    setQueryProgressState({
        source: currentSearchSource,
        percent: 100,
        message: data.status === 'success' ? 'Consulta concluída' : 'Consulta interrompida',
        detail: data.status === 'success' ? 'Resultados prontos.' : (data.message || 'Confira a mensagem de erro.')
    });
    bar.classList.remove('progress-filling');
    loader.classList.add('hidden');
    list.classList.remove('hidden');

    if (data.status !== 'success') {
        list.innerHTML = '<div class="error-card">' + icon('circle-alert') + '<b>Erro na busca</b><br><span>'
            + escHtml(data.message || 'A NASA não respondeu à consulta.')
            + '</span></div>';
        renderIcons();
        return;
    }
    if (!data.results || data.results.length === 0) {
        list.innerHTML = '<p class="state-message">Nenhum resultado encontrado.</p>';
        return;
    }
    renderResults(data.results, currentSearchSource);
    if (data.smart_filter) showToast('Filtro espacial aplicado às grades SWOT.', 'success', 3500);
});

Shiny.addCustomMessageHandler('layer-search-results', renderLayerSearchResults);

Shiny.addCustomMessageHandler('trigger-download', async function (data) {
    var link = document.getElementById((data && data.id) || 'download_bundle');
    if (!link) return;

    if ((pendingDownloadRequest && pendingDownloadRequest.data_source === 'OPERA') && window.showSaveFilePicker) {
        var btn = document.getElementById('btn-download-selected');
        var originalText = btn ? btn.innerHTML : '';
        try {
            if (btn) {
                btn.disabled = true;
                setButton(btn, 'archive', 'Escolha onde salvar...');
            }
            await saveLinkWithPicker(link, buildSuggestedDownloadName(pendingDownloadRequest));
            showToast('ZIP OPERA salvo com sucesso.', 'success', 5000);
        } catch (error) {
            if (error && error.name !== 'AbortError') {
                showToast(error.message || 'Erro ao salvar o ZIP OPERA.', 'error', 7000);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
                renderIcons();
            }
        }
        return;
    }

    link.click();
});

function bindEvents() {
    document.querySelectorAll('[data-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
            switchTab(button.getAttribute('data-tab'));
        });
    });

    document.getElementById('produto').addEventListener('change', toggleSubproducts);
    document.getElementById('data_source').addEventListener('change', toggleDataSource);
    document.getElementById('opera_subproduto').addEventListener('change', updateOperaSubproductHelp);
    document.getElementById('userShapeInput').addEventListener('change', uploadShape);
    document.getElementById('brazil_states').addEventListener('change', aplicarFiltroEstado);
    document.getElementById('start_date').addEventListener('change', validarDatas);
    document.getElementById('end_date').addEventListener('change', validarDatas);
    document.getElementById('clear-area').addEventListener('click', limparArea);
    document.getElementById('search-button').addEventListener('click', buscarDados);
    document.getElementById('opera-search-button').addEventListener('click', buscarDados);
    document.getElementById('btn-download-selected').addEventListener('click', baixarSelecionados);
    document.getElementById('reset-search').addEventListener('click', resetarConsulta);
    document.getElementById('select-all').addEventListener('change', toggleSelectAll);
    document.getElementById('layer-search-button').addEventListener('click', runLayerSearch);
    document.getElementById('layer-search-input').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            runLayerSearch();
        }
    });

    document.querySelectorAll('input[name="basemap_sel"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            trocarBasemap(radio.value);
        });
    });

    document.querySelectorAll('[data-layer]').forEach(function (checkbox) {
        checkbox.addEventListener('change', function () {
            toggleCamada(
                checkbox,
                checkbox.getAttribute('data-layer'),
                checkbox.getAttribute('data-title'),
                checkbox.getAttribute('data-color'),
                checkbox.getAttribute('data-kind')
            );
        });
    });

    window.SWANrAccordionReady = true;
    document.querySelectorAll('.layer-group-toggle').forEach(function (button) {
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            toggleLayerGroupButton(button);
        });
    });
}

bindEvents();
toggleDataSource();
toggleSubproducts();
updateOperaSubproductHelp();
renderIcons();

window.switchTab = switchTab;
window.limparArea = limparArea;
window.buscarDados = buscarDados;
