/* CUNY Housing Finder — Final build + Locate Me radius chips
   - Radius chips: 1 / 3 / 5 km (default 3)
   - Locate me uses current chip radius
*/

///////////////////////////////
// 0) SUPABASE + MODE TOGGLE //
///////////////////////////////
const SUPABASE_URL = "https://znlnarqyzwcrzitkcjih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubG5hcnF5endjcnppdGtjamloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NTg1NjAsImV4cCI6MjA3NzUzNDU2MH0.PChD4eCzCZSFwcDscwp-ZjEc3Jf7FHvnmbk1YGDxQD8";
const sbClient = (SUPABASE_URL && SUPABASE_ANON_KEY) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const MODE_KEY = 'cuny_local_mode';
function getLocalMode() { return localStorage.getItem(MODE_KEY) === 'true'; }
function setLocalMode(v) { localStorage.setItem(MODE_KEY, v ? 'true' : 'false'); }
let USE_SUPABASE = !!sbClient && !getLocalMode();

const toggleLocal = document.getElementById('toggleLocal');
const modeLabel = document.getElementById('modeLabel');
const btnClearLocal = document.getElementById('btnClearLocal');

if (toggleLocal) {
    toggleLocal.checked = getLocalMode();
    modeLabel.textContent = toggleLocal.checked ? 'Local only' : 'Cloud (Supabase)';
    toggleLocal.addEventListener('change', async () => {
        setLocalMode(toggleLocal.checked);
        USE_SUPABASE = !!sbClient && !getLocalMode();
        modeLabel.textContent = toggleLocal.checked ? 'Local only' : 'Cloud (Supabase)';
        await reloadData();
        showToast(toggleLocal.checked ? 'Using local storage' : 'Using Supabase');
        refreshClearLocalButtonState();
    });
}

//////////////////////
// 1) Tabs/Sections //
//////////////////////
const sectionMap = document.getElementById('sectionMap');
const sectionAdd = document.getElementById('sectionAdd');
const sectionFind = document.getElementById('sectionFind');
const sectionList = document.getElementById('sectionList');

const tabs = {
    Map: document.getElementById('tabMap'),
    Add: document.getElementById('tabAdd'),
    Find: document.getElementById('tabFind'),
    List: document.getElementById('tabList'),
};

function showSection(which) {
    sectionMap.classList.toggle('visible', which === 'map');
    sectionAdd.classList.toggle('visible', which === 'add');
    sectionFind.classList.toggle('visible', which === 'find');
    sectionList.classList.toggle('visible', which === 'list');

    Object.values(tabs).forEach(b => b.classList.remove('active'));
    if (which === 'map') tabs.Map.classList.add('active');
    if (which === 'add') tabs.Add.classList.add('active');
    if (which === 'find') tabs.Find.classList.add('active');
    if (which === 'list') tabs.List.classList.add('active');

    if (which === 'list') renderListings();
    if (which === 'map') setTimeout(() => map.invalidateSize(), 200);
}
tabs.Map.onclick = () => showSection('map');
tabs.Add.onclick = () => showSection('add');
tabs.Find.onclick = () => showSection('find');
tabs.List.onclick = () => showSection('list');

/////////////////////////
// 2) Map + base layers //
/////////////////////////
const homeCenter = [40.7128, -74.0060];
const homeZoom = 10.5;

const map = L.map('map').setView(homeCenter, homeZoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);

const clusterNeed = L.markerClusterGroup({ chunkedLoading: true });
const clusterHave = L.markerClusterGroup({ chunkedLoading: true });
map.addLayer(clusterNeed);
map.addLayer(clusterHave);

// Campus layer + user layer
const campusLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);

let tempSearchMarker = null;

const toast = document.getElementById('toast');
function showToast(msg) { if (!toast) return; toast.textContent = msg; toast.hidden = false; setTimeout(() => toast.hidden = true, 1100); }

document.getElementById('btnResetView').onclick = () => {
    filteredListings = [...allListings];
    renderListingMarkers(filteredListings);
    renderListings();
    map.setView(homeCenter, homeZoom);
    userLayer.clearLayers();
    showToast('Reset view');
};
document.getElementById('btnClearSearchPin').onclick = () => {
    if (tempSearchMarker) { map.removeLayer(tempSearchMarker); tempSearchMarker = null; showToast('Search pin cleared'); }
};
map.on('click', (e) => {
    document.getElementById('inputLat').value = e.latlng.lat.toFixed(6);
    document.getElementById('inputLng').value = e.latlng.lng.toFixed(6);
    showToast('Location picked');
});

////////////////////////////////////////
// 3) Data layer (Supabase + local LS) //
////////////////////////////////////////
const LS_KEY = 'cuny_listings_v2';
const OWN_KEY = 'cuny_owned_ids';

function lsLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } }
function lsSave(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
function clearLocalData() { localStorage.removeItem(LS_KEY); refreshClearLocalButtonState(); }

function ownedLoad() { try { return new Set(JSON.parse(localStorage.getItem(OWN_KEY)) || []); } catch { return new Set(); } }
function ownedSave(set) { localStorage.setItem(OWN_KEY, JSON.stringify(Array.from(set))); }
function addOwnedId(id) { const s = ownedLoad(); s.add(id); ownedSave(s); }
function removeOwnedId(id) { const s = ownedLoad(); s.delete(id); ownedSave(s); }
function isOwned(id) { return ownedLoad().has(id); }

async function sbLoad() {
    const { data, error } = await sbClient.from('listings').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
        id: row.id, type: row.type, campus: row.campus, title: row.title,
        description: row.description || '', price: row.price, contact: row.contact,
        lat: row.lat, lng: row.lng, created_at: row.created_at
    }));
}
async function sbInsert(Li) {
    const { data, error } = await sbClient.from('listings').insert({
        type: Li.type, campus: Li.campus || null, title: Li.title || null,
        description: Li.description || null, price: isFinite(Li.price) ? Number(Li.price) : null,
        contact: Li.contact || null, lat: isFinite(Li.lat) ? Number(Li.lat) : null, lng: isFinite(Li.lng) ? Number(Li.lng) : null
    }).select().single();
    if (error) throw error;
    return data;
}

let allListings = [];
let filteredListings = [];

//////////////////////////////////////////////////////////
// 4) Campus dataset (NYC Open Data with safe fallback) //
//////////////////////////////////////////////////////////
const CUNY_GEOJSON = 'https://data.cityofnewyork.us/resource/uew7-8je4.geojson?$select=the_geom,name';
const fallbackCampuses = [
    { name: 'BMCC', lat: 40.7183, lng: -74.0120 },
    { name: 'Baruch College', lat: 40.7403, lng: -73.9832 },
    { name: 'City College', lat: 40.8200, lng: -73.9493 },
    { name: 'Hunter College', lat: 40.7683, lng: -73.9640 },
    { name: 'Queens College', lat: 40.7365, lng: -73.8203 },
    { name: 'Brooklyn College', lat: 40.6305, lng: -73.9524 },
    { name: 'Lehman College', lat: 40.8735, lng: -73.8940 },
    { name: 'CSI', lat: 40.6034, lng: -74.1483 },
    { name: 'York College', lat: 40.7028, lng: -73.7956 },
    { name: 'CUNY School of Law', lat: 40.7433, lng: -73.8270 },
];

const campusSelect = document.getElementById('filterCampus');
let campusPoints = [];

async function loadCampuses() {
    try {
        const resp = await fetch(CUNY_GEOJSON, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const gj = await resp.json();
        const pts = [];
        gj.features.forEach(f => {
            const name = (f.properties?.name || 'CUNY campus').toString().trim();
            const g = f.geometry || f;
            if (!g) return;
            if (g.type === 'Point') pts.push({ name, lat: g.coordinates[1], lng: g.coordinates[0] });
            else if (g.type === 'MultiPoint') g.coordinates.forEach(([x, y]) => pts.push({ name, lat: y, lng: x }));
        });
        if (pts.length) renderCampuses(pts); else throw new Error('Empty dataset');
    } catch {
        renderCampuses(fallbackCampuses);
    }
}
function renderCampuses(list) {
    campusLayer.clearLayers();
    campusPoints = list.slice();
    const names = Array.from(new Set(list.map(c => c.name))).sort((a, b) => a.localeCompare(b));
    campusSelect.innerHTML = '<option value="">All campuses</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
    list.forEach(c => {
        L.circleMarker([c.lat, c.lng], { radius: 6, color: '#0d4ea8', weight: 2, fillColor: '#1273de', fillOpacity: 0.9 })
            .bindTooltip(c.name).bindPopup(`<b>${c.name}</b>`).addTo(campusLayer);
    });
}

/////////////////////////////////////////////
// 5) Listings markers + UI (rendering)   //
/////////////////////////////////////////////
function listingPopupHtml(Li) {
    const price = Li.price ? `$${Li.price}/mo` : '—';
    const campus = Li.campus || '—';
    const contactTxt = (Li.contact || '').replace(/'/g, '&#39;');
    const delBtn = isOwned(Li.id) ? `<button class="btn" onclick="deleteListing('${Li.id}', this)">Delete</button>` : '';
    return `
    <div>
      <b>${escapeHtml(Li.title || '(no title)')}</b><br/>
      ${escapeHtml(campus)} &middot; ${price}<br/>
      ${escapeHtml(Li.description || '')}
      <div style="margin-top:6px">Contact: <a href="#">${escapeHtml(Li.contact || '')}</a></div>
      <div class="actions" style="margin-top:8px">
        <button class="btn" onclick="copyContact(this, '${contactTxt}')">Copy contact</button>
        ${delBtn}
      </div>
    </div>`;
}
function addListingMarker(Li) {
    if (!isFinite(Li.lat) || !isFinite(Li.lng)) return null;
    const marker = L.marker([Li.lat, Li.lng], {
        title: Li.title || '',
        icon: L.divIcon({
            className: '',
            html: '<div style="width:10px;height:10px;border-radius:50%;background:' + (Li.type === 'need' ? '#b13d3d' : '#2d8a52') + ';border:2px solid #111"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7]
        })
    }).bindPopup(listingPopupHtml(Li), { autoPan: true });
    (Li.type === 'need' ? clusterNeed : clusterHave).addLayer(marker);
    return marker;
}
function renderListingMarkers(list) {
    clusterNeed.clearLayers(); clusterHave.clearLayers();
    list.forEach(addListingMarker);
}

function renderListings() {
    const wrap = document.getElementById('listingsContainer');
    wrap.innerHTML = '';
    filteredListings.slice().reverse().forEach(Li => {
        const card = document.createElement('div');
        card.className = 'cardRow';
        const badgeClass = Li.type === 'need' ? 'need' : 'have';
        const price = Li.price ? `$${Li.price}/mo` : '—';
        const campus = Li.campus || '—';
        const del = isOwned(Li.id) ? `<button class="btn" data-act="del">Delete</button>` : '';
        card.innerHTML = `
      <span class="badge ${badgeClass}">${Li.type === 'need' ? 'Needs room' : 'Room available'}</span>
      <div style="font-weight:700">${escapeHtml(Li.title || '(no title)')}</div>
      <div style="color:#a6b3c2">${escapeHtml(campus)} &middot; ${price}</div>
      <div style="margin-top:6px">${escapeHtml(Li.description || '')}</div>
      <div style="margin-top:8px">Contact: ${escapeHtml(Li.contact || '')}</div>
      <div class="actions">
        <button class="btn" data-act="show">Show on map</button>
        <button class="btn" data-act="copy">Copy contact</button>
        ${del}
      </div>
    `;
        card.querySelector('[data-act="show"]').onclick = () => {
            if (isFinite(Li.lat) && isFinite(Li.lng)) { showSection('map'); map.setView([Li.lat, Li.lng], 16, { animate: true }); }
            else { showSection('map'); showToast('Listing has no coordinates'); }
        };
        card.querySelector('[data-act="copy"]').onclick = (ev) => copyContact(ev.currentTarget, Li.contact || '');
        if (isOwned(Li.id)) card.querySelector('[data-act="del"]').onclick = (ev) => deleteListing(Li.id, ev.currentTarget);
        wrap.appendChild(card);
    });
}

// Copy helper
window.copyContact = function (btnEl, text) {
    navigator.clipboard.writeText(text || '').then(() => {
        const old = btnEl.textContent;
        btnEl.textContent = 'Copied!';
        btnEl.disabled = true;
        showToast('Contact copied');
        setTimeout(() => { btnEl.textContent = old; btnEl.disabled = false; }, 900);
    });
};

// Delete own listing
window.deleteListing = async function (id) {
    if (!id) return;
    const ok = confirm('Delete this listing? This cannot be undone.');
    if (!ok) return;
    try {
        if (USE_SUPABASE) await sbClient.from('listings').delete().eq('id', id);
        else { const ls = lsLoad().filter(r => r.id !== id); lsSave(ls); }
        removeOwnedId(id);
        await reloadData();
        showToast('Listing deleted');
    } catch (e) {
        console.error(e);
        showToast('Delete failed');
    }
};

/////////////////////////////
// 6) Filters (list + map) //
/////////////////////////////
const fKeyword = document.getElementById('filterKeyword');
const fType = document.getElementById('filterType');
const fCampus = document.getElementById('filterCampus');
const fMin = document.getElementById('filterMin');
const fMax = document.getElementById('filterMax');
const fMine = document.getElementById('filterMine');
const btnMyListings = document.getElementById('btnMyListings');

function applyFilters() {
    const kw = (fKeyword.value || '').toLowerCase().trim();
    const ty = fType.value;
    const cp = fCampus.value;
    const nMin = fMin.value ? Number(fMin.value) : null;
    const nMax = fMax.value ? Number(fMax.value) : null;
    const mineOnly = !!(fMine && fMine.checked);

    let cpPoint = null;
    if (cp) cpPoint = campusPoints.find(c => c.name === cp) || null;

    filteredListings = allListings.filter(Li => {
        if (ty && Li.type !== ty) return false;

        if (cpPoint) {
            const near = (isFinite(Li.lat) && isFinite(Li.lng) &&
                haversineKm(Li.lat, Li.lng, cpPoint.lat, cpPoint.lng) <= 11);
            const textMatch = (Li.campus || '').trim().toLowerCase() === cp.toLowerCase();
            if (!near && !textMatch) return false;
        }

        if (mineOnly && !isOwned(Li.id)) return false;

        if (nMin != null && isFinite(Li.price) && Number(Li.price) < nMin) return false;
        if (nMax != null && isFinite(Li.price) && Number(Li.price) > nMax) return false;

        if (kw) {
            const hay = `${Li.title || ''} ${Li.description || ''} ${Li.campus || ''}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        return true;
    });

    renderListingMarkers(filteredListings);
    renderListings();

    if (cpPoint) {
        map.setView([cpPoint.lat, cpPoint.lng], 13, { animate: true });
        showToast(`Filtered near ${cpPoint.name}`);
    } else {
        showToast('Filters applied');
    }
    showSection('map');
}
document.getElementById('btnApplyFilters').onclick = applyFilters;
document.getElementById('btnClearFilters').onclick = () => {
    fKeyword.value = ''; fType.value = ''; fCampus.value = ''; fMin.value = ''; fMax.value = '';
    if (fMine) fMine.checked = false;
    filteredListings = [...allListings];
    renderListingMarkers(filteredListings);
    renderListings();
    showToast('Filters cleared');
};

if (btnMyListings) {
    btnMyListings.addEventListener('click', () => {
        if (fMine) fMine.checked = true;
        applyFilters();
        showSection('list');
        showToast('Showing your listings');
    });
}

/////////////////////////////////////////////
// 7) Add listing + search + campus autosnap
/////////////////////////////////////////////
const inType = document.getElementById('inputType');
const inCampus = document.getElementById('inputCampus');
const inTitle = document.getElementById('inputTitle');
const inDesc = document.getElementById('inputDesc');
const inPrice = document.getElementById('inputPrice');
const inContact = document.getElementById('inputContact');
const inLat = document.getElementById('inputLat');
const inLng = document.getElementById('inputLng');
const inSearch = document.getElementById('inputSearch');
const btnSnapCampus = document.getElementById('btnSnapCampus');

function findCampusByName(name) {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    return campusPoints.find(c => c.name.toLowerCase() === n)
        || campusPoints.find(c => c.name.toLowerCase().includes(n))
        || null;
}
function snapCampusToCoords() {
    const cp = findCampusByName(inCampus.value);
    if (cp) {
        inLat.value = cp.lat.toFixed(6);
        inLng.value = cp.lng.toFixed(6);
        showToast('Coordinates set from campus');
        return { lat: cp.lat, lng: cp.lng };
    }
    return null;
}
if (btnSnapCampus) btnSnapCampus.onclick = () => {
    const cp = snapCampusToCoords();
    if (cp) { showSection('map'); setTimeout(() => map.invalidateSize(), 150); map.setView([cp.lat, cp.lng], 15, { animate: true }); }
    else showToast('Campus not found');
};

async function smartGeocode({ title, description, campus }) {
    const cp = campus ? snapCampusToCoords() : null;
    if (cp) return cp;

    const qParts = [];
    if (title) qParts.push(title);
    if (campus) qParts.push(campus);
    if (!title && description) qParts.push(description);
    qParts.push('New York City, USA');

    const q = qParts.join(', ').slice(0, 200);
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
    try {
        const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'cuny-housing-demo' } });
        const arr = await res.json();
        if (arr && arr.length) return { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
    } catch (_) { }
    return null;
}

function clearAddForm() {
    inType.value = 'need'; inCampus.value = ''; inTitle.value = ''; inDesc.value = '';
    inPrice.value = ''; inContact.value = ''; inLat.value = ''; inLng.value = ''; inSearch.value = '';
}

const btnPost = document.getElementById('btnPost');
document.getElementById('btnPost').onclick = async () => {
    const statusEl = document.getElementById('postStatus');
    statusEl.classList.remove('ok', 'err');
    statusEl.textContent = 'Posting…';
    btnPost.disabled = true; btnPost.textContent = 'Posting…';

    if (!inLat.value && !inLng.value) {
        const g = await smartGeocode({ title: inTitle.value, description: inDesc.value, campus: inCampus.value });
        if (g) { inLat.value = g.lat.toFixed(6); inLng.value = g.lng.toFixed(6); }
    }

    const Li = {
        type: inType.value || 'need',
        campus: (inCampus.value || '').trim(),
        title: (inTitle.value || '').trim(),
        description: (inDesc.value || '').trim(),
        price: inPrice.value ? Number(inPrice.value) : null,
        contact: (inContact.value || '').trim(),
        lat: inLat.value ? Number(inLat.value) : NaN,
        lng: inLng.value ? Number(inLng.value) : NaN,
    };

    try {
        if (USE_SUPABASE) {
            const row = await sbInsert(Li);
            addOwnedId(row.id);
            allListings = await sbLoad();
        } else {
            const ls = lsLoad();
            const newId = 'L' + Date.now();
            ls.push({ ...Li, id: newId });
            lsSave(ls);
            addOwnedId(newId);
            allListings = ls;
        }
        filteredListings = [...allListings];
        renderListingMarkers(filteredListings);
        renderListings();

        statusEl.textContent = 'Posted!';
        statusEl.classList.add('ok');

        const hasPin = isFinite(Li.lat) && isFinite(Li.lng);
        clearAddForm();
        btnPost.disabled = false;
        btnPost.textContent = 'Post listing';

        if (hasPin) {
            showSection('map');
            setTimeout(() => map.invalidateSize(), 120);
            map.setView([Li.lat, Li.lng], 16, { animate: true });
            showToast('Posted! Pin added to map');
        } else {
            showSection('list');
            showToast('Posted! No pin (add campus or search)');
        }
        refreshClearLocalButtonState();
    } catch (e) {
        const ls = lsLoad();
        const newId = 'L' + Date.now();
        ls.push({ ...Li, id: newId });
        lsSave(ls);
        addOwnedId(newId);
        allListings = ls;
        filteredListings = [...allListings];
        renderListingMarkers(filteredListings);
        renderListings();

        statusEl.textContent = `Post failed on Supabase; saved locally. (${e?.message || e})`;
        statusEl.classList.add('err');
        console.error(e);
        btnPost.disabled = false;
        btnPost.textContent = 'Post listing';

        const hasPin = isFinite(Li.lat) && isFinite(Li.lng);
        clearAddForm();
        if (hasPin) { showSection('map'); setTimeout(() => map.invalidateSize(), 120); map.setView([Li.lat, Li.lng], 16, { animate: true }); showToast('Saved locally; pin added'); }
        else { showSection('list'); showToast('Saved locally (no pin)'); }
        refreshClearLocalButtonState();
    }
};

document.getElementById('btnSearch').onclick = async () => {
    const q = (inSearch.value || '').trim();
    if (!q) return;
    try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
        const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'cuny-housing-demo' } });
        const arr = await res.json();
        if (!arr.length) { showToast('No results'); return; }
        const { lat, lon, display_name } = arr[0];
        const p = [Number(lat), Number(lon)];
        inLat.value = Number(lat).toFixed(6);
        inLng.value = Number(lon).toFixed(6);
        if (tempSearchMarker) map.removeLayer(tempSearchMarker);
        tempSearchMarker = L.marker(p, { title: 'Search' }).addTo(map).bindPopup(display_name).openPopup();

        showSection('map');
        setTimeout(() => map.invalidateSize(), 150);
        map.setView(p, 15, { animate: true });
        showToast('Location picked');
    } catch {
        showToast('Search failed');
    }
};

//////////////////////
// 8) Locate Me ⭐  //
//////////////////////
const btnLocateMe = document.getElementById('btnLocateMe');
const radiusChips = document.querySelectorAll('.radius-chips .chip');
let LOCATE_RADIUS_KM = 3; // default chip

radiusChips.forEach(chip => {
    chip.addEventListener('click', () => {
        radiusChips.forEach(c => c.classList.remove('chip-active'));
        chip.classList.add('chip-active');
        LOCATE_RADIUS_KM = Number(chip.getAttribute('data-radius')) || 3;
        showToast(`Radius set to ${LOCATE_RADIUS_KM} km`);
    });
});

if (btnLocateMe) {
    btnLocateMe.addEventListener('click', () => {
        if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
        showToast('Locating…');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const acc = Math.min(pos.coords.accuracy || 120, 300); // clamp to 300m

                // draw user marker + accuracy circle
                userLayer.clearLayers();
                const m = L.marker([lat, lng], { title: 'You are here' }).addTo(userLayer);
                const c = L.circle([lat, lng], { radius: acc + 150, color: '#2b82f6', weight: 1, fillColor: '#2b82f6', fillOpacity: 0.12 }).addTo(userLayer);
                m.bindPopup('You are here').openPopup();

                // filter listings within selected radius
                const nearby = allListings.filter(Li =>
                    isFinite(Li.lat) && isFinite(Li.lng) &&
                    haversineKm(lat, lng, Li.lat, Li.lng) <= LOCATE_RADIUS_KM
                );

                filteredListings = nearby.length ? nearby : [];
                renderListingMarkers(filteredListings);
                renderListings();

                // zoom to user + nearby
                const group = L.featureGroup([m, c]);
                if (filteredListings.length) {
                    filteredListings.forEach(Li => group.addLayer(L.marker([Li.lat, Li.lng])));
                }
                map.fitBounds(group.getBounds().pad(0.25), { animate: true });

                showSection('map');
                showToast(`${filteredListings.length} listing${filteredListings.length === 1 ? '' : 's'} within ${LOCATE_RADIUS_KM} km`);
            },
            () => showToast('Location access denied')
        );
    });
}

//////////////////////
// 9) Helpers + boot
//////////////////////
function escapeHtml(s) {
    return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

async function reloadData() {
    try { allListings = USE_SUPABASE ? await sbLoad() : lsLoad(); }
    catch (e) { console.warn('Supabase load failed, using localStorage', e); allListings = lsLoad(); }
    filteredListings = [...allListings];
    renderListingMarkers(filteredListings);
    renderListings();
    refreshClearLocalButtonState();
}

function refreshClearLocalButtonState() {
    if (!btnClearLocal) return;
    const hasLocal = (lsLoad().length > 0);
    btnClearLocal.disabled = !hasLocal;
    btnClearLocal.title = hasLocal ? 'Clear locally saved listings' : 'Local cache is empty';
}
if (btnClearLocal) {
    btnClearLocal.addEventListener('click', async () => {
        clearLocalData();
        await reloadData();
        showToast('Local data cleared');
    });
}

async function init() {
    renderListingMarkers([]);
    await loadCampuses();
    await reloadData();
}
init();
