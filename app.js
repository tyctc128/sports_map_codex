const DATA_URL = "sports_20251201.csv";
const TAIPEI_CENTER = [25.0478, 121.517];
const FALLBACK_TAIPEI_STATION = { lat: 25.0478, lng: 121.517, label: "台北車站" };

const CATEGORY_CONFIG = [
  {
    key: "gym",
    label: "健身房",
    match: ["健身房"],
    icon: "fa-dumbbell",
    colorClass: "marker-icon--gym",
  },
  {
    key: "yoga",
    label: "瑜珈教室",
    match: ["瑜珈教室"],
    icon: "fa-person-praying",
    colorClass: "marker-icon--yoga",
  },
  {
    key: "swim",
    label: "游泳池",
    match: ["游泳池", "室內游泳池", "室外游泳池", "室內外游泳池"],
    icon: "fa-person-swimming",
    colorClass: "marker-icon--swim",
    sub: [
      { key: "pool", label: "游泳池" },
      { key: "pool-indoor", label: "室內游泳池" },
      { key: "pool-outdoor", label: "室外游泳池" },
      { key: "pool-both", label: "室內外游泳池" },
    ],
  },
  {
    key: "other",
    label: "撞球場及攀岩場",
    match: ["撞球場及攀岩場"],
    icon: "fa-mountain",
    colorClass: "marker-icon--other",
  },
];

const state = {
  data: [],
  filtered: [],
  markers: new Map(),
  fuse: null,
  selectedId: null,
  userLocation: null,
  radiusKm: 2,
  onlyNearby: false,
  onlyBounds: false,
  activeCategories: new Set(),
  activeSwimSub: new Set(),
  activeDistricts: new Set(),
};

const elements = {
  map: document.getElementById("map"),
  categoryFilters: document.getElementById("categoryFilters"),
  districtFilters: document.getElementById("districtFilters"),
  districtAll: document.getElementById("districtAll"),
  districtNone: document.getElementById("districtNone"),
  nearbyToggle: document.getElementById("nearbyToggle"),
  radiusSlider: document.getElementById("radiusSlider"),
  radiusValue: document.getElementById("radiusValue"),
  boundsToggle: document.getElementById("boundsToggle"),
  resultList: document.getElementById("resultList"),
  resultCount: document.getElementById("resultCount"),
  toggleList: document.getElementById("toggleList"),
  detailPanel: document.getElementById("detailPanel"),
  detailTitle: document.getElementById("detailTitle"),
  detailType: document.getElementById("detailType"),
  detailBody: document.getElementById("detailBody"),
  detailClose: document.getElementById("detailClose"),
  searchInput: document.getElementById("searchInput"),
  searchSuggest: document.getElementById("searchSuggest"),
  clearSearch: document.getElementById("clearSearch"),
  locateBtn: document.getElementById("locateBtn"),
  fallbackTaipei: document.getElementById("fallbackTaipei"),
};

let map;
let clusterGroup;
let userMarker;

init();

async function init() {
  setupMap();
  setupUI();
  const data = await loadData();
  state.data = data;
  buildFilters();
  setupFuse();
  renderMarkers();
  applyFilters();
}

function setupMap() {
  map = L.map("map", { zoomControl: false }).setView(TAIPEI_CENTER, 12);
  L.control
    .zoom({ position: "bottomright" })
    .addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 52,
    spiderfyOnMaxZoom: true,
  });

  map.addLayer(clusterGroup);
  map.on("moveend", () => {
    if (state.onlyBounds) {
      applyFilters();
    }
  });
}

function setupUI() {
  elements.radiusSlider.addEventListener("input", (event) => {
    state.radiusKm = Number(event.target.value);
    elements.radiusValue.textContent = `${state.radiusKm} km`;
    applyFilters();
  });

  elements.nearbyToggle.addEventListener("change", (event) => {
    if (event.target.checked && !state.userLocation) {
      alert("請先點「定位我」或選擇台北車站備援。");
      event.target.checked = false;
      state.onlyNearby = false;
      return;
    }
    state.onlyNearby = event.target.checked;
    applyFilters();
  });

  elements.boundsToggle.addEventListener("change", (event) => {
    state.onlyBounds = event.target.checked;
    applyFilters();
  });

  elements.districtAll.addEventListener("click", () => {
    state.activeDistricts = new Set(getDistricts());
    updateDistrictUI();
    applyFilters();
  });

  elements.districtNone.addEventListener("click", () => {
    state.activeDistricts = new Set();
    updateDistrictUI();
    applyFilters();
  });

  elements.toggleList.addEventListener("click", () => {
    elements.resultList.classList.toggle("is-collapsed");
    elements.toggleList.textContent = elements.resultList.classList.contains("is-collapsed")
      ? "展開"
      : "收合";
  });

  elements.detailClose.addEventListener("click", () => {
    resetDetailPanel();
  });

  elements.locateBtn.addEventListener("click", locateUser);
  elements.fallbackTaipei.addEventListener("click", () => {
    setUserLocation(FALLBACK_TAIPEI_STATION.lat, FALLBACK_TAIPEI_STATION.lng, FALLBACK_TAIPEI_STATION.label);
  });

  elements.searchInput.addEventListener("input", onSearchInput);
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const firstResult = getSearchResults(elements.searchInput.value.trim())[0];
      if (firstResult) {
        focusVenue(firstResult.item);
      }
    }
  });

  elements.clearSearch.addEventListener("click", () => {
    elements.searchInput.value = "";
    closeSuggest();
  });

  document.addEventListener("click", (event) => {
    if (!elements.searchSuggest.contains(event.target) && event.target !== elements.searchInput) {
      closeSuggest();
    }
  });
}

async function loadData() {
  const response = await fetch(DATA_URL);
  const text = await response.text();
  const rows = parseCSV(text);
  const headers = rows.shift();
  const cleaned = rows
    .filter((row) => row.length > 1)
    .map((row, index) => buildRecord(row, headers, index))
    .filter((record) => record.lat && record.lng);

  return cleaned;
}

function parseCSV(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (value || current.length) {
        current.push(value);
        rows.push(current);
      }
      current = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value || current.length) {
    current.push(value);
    rows.push(current);
  }

  return rows.map((row) => row.map((cell) => cell.trim()));
}

function buildRecord(row, headers, index) {
  const data = {};
  headers.forEach((key, i) => {
    data[key] = row[i] ?? "";
  });

  const rawLng = parseFloat(data["經度"]);
  const rawLat = parseFloat(data["緯度"]);
  const fixedLng = fixLongitude(rawLng);

  return {
    id: data["編號"] || String(index + 1),
    district: data["行政區"],
    name: data["廠商名稱〈市招〉"],
    org: data["所屬單位"],
    operator: data["經營主體"],
    phone: normalizePhone(data["市話"]),
    ext: normalizePhone(data["分機"]),
    mobile: normalizePhone(data["行動電話"]),
    address: data["地址"],
    remark: data["備註"],
    lng: Number.isFinite(fixedLng) ? fixedLng : null,
    lat: Number.isFinite(rawLat) ? rawLat : null,
  };
}

function normalizePhone(value) {
  if (!value) return "";
  return String(value).replace(/\.0$/, "").trim();
}

function fixLongitude(lng) {
  if (!Number.isFinite(lng)) return null;
  if (lng < 100 && lng > 20 && lng < 30) {
    return lng + 100;
  }
  return lng;
}

function setupFuse() {
  state.fuse = new Fuse(state.data, {
    keys: ["name", "address", "district"],
    includeScore: true,
    threshold: 0.35,
  });
}

function buildFilters() {
  CATEGORY_CONFIG.forEach((category) => {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.key = category.key;
    state.activeCategories.add(category.key);

    const label = document.createElement("span");
    label.textContent = category.label;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);

    if (category.sub) {
      const subList = document.createElement("div");
      subList.className = "filter-group";
      subList.style.marginLeft = "18px";
      category.sub.forEach((sub) => {
        const subItem = document.createElement("label");
        subItem.className = "filter-item";
        const subBox = document.createElement("input");
        subBox.type = "checkbox";
        subBox.checked = true;
        subBox.dataset.subkey = sub.label;
        state.activeSwimSub.add(sub.label);

        subItem.appendChild(subBox);
        subItem.appendChild(document.createTextNode(sub.label));
        subList.appendChild(subItem);

        subBox.addEventListener("change", () => {
          if (subBox.checked) {
            state.activeSwimSub.add(sub.label);
          } else {
            state.activeSwimSub.delete(sub.label);
          }
          applyFilters();
        });
      });
      elements.categoryFilters.appendChild(wrapper);
      elements.categoryFilters.appendChild(subList);
    } else {
      elements.categoryFilters.appendChild(wrapper);
    }

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.activeCategories.add(category.key);
      } else {
        state.activeCategories.delete(category.key);
      }
      applyFilters();
    });
  });

  const districts = getDistricts();
  state.activeDistricts = new Set(districts);
  districts.forEach((district) => {
    const label = document.createElement("label");
    label.className = "filter-item";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.dataset.district = district;

    label.appendChild(box);
    label.appendChild(document.createTextNode(district));
    elements.districtFilters.appendChild(label);

    box.addEventListener("change", () => {
      if (box.checked) {
        state.activeDistricts.add(district);
      } else {
        state.activeDistricts.delete(district);
      }
      applyFilters();
    });
  });
}

function getDistricts() {
  return Array.from(new Set(state.data.map((item) => item.district))).sort();
}

function updateDistrictUI() {
  elements.districtFilters.querySelectorAll("input").forEach((input) => {
    input.checked = state.activeDistricts.has(input.dataset.district);
  });
}

function renderMarkers() {
  clusterGroup.clearLayers();
  state.markers.clear();

  state.data.forEach((item) => {
    const icon = buildIcon(item);
    const marker = L.marker([item.lat, item.lng], { icon });
    marker.bindTooltip(buildTooltip(item), { direction: "top", sticky: true, opacity: 0.95 });
    marker.on("click", () => {
      closeAllTooltips();
      marker.openTooltip();
      showDetail(item);
    });
    clusterGroup.addLayer(marker);
    state.markers.set(item.id, marker);
  });
}

function buildIcon(item) {
  const category = resolveCategory(item.remark);
  const subLabel = resolveSwimLabel(item.remark);
  const html = `
    <div class="marker-icon ${category.colorClass}">
      <i class="fa-solid ${category.icon}"></i>
      ${subLabel ? `<span class="marker-icon__label">${subLabel}</span>` : ""}
    </div>
  `;

  return L.divIcon({
    html,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -16],
  });
}

function resolveCategory(remark) {
  return CATEGORY_CONFIG.find((cat) => cat.match.includes(remark)) || CATEGORY_CONFIG[3];
}

function resolveSwimLabel(remark) {
  if (!remark.includes("游泳池")) return "";
  if (remark === "游泳池") return "一般";
  if (remark.includes("室內外")) return "室內外";
  if (remark.includes("室內")) return "室內";
  if (remark.includes("室外")) return "室外";
  return "";
}

function buildTooltip(item) {
  return `
    <div>
      <strong>${item.name}</strong><br />
      ${item.remark} · ${item.district}<br />
      ${item.address}
    </div>
  `;
}

function applyFilters() {
  const bounds = map.getBounds();
  const filtered = state.data.filter((item) => {
    const category = resolveCategory(item.remark).key;
    if (!state.activeCategories.has(category)) return false;

    if (category === "swim" && state.activeSwimSub.size) {
      if (!state.activeSwimSub.has(item.remark)) return false;
    }

    if (!state.activeDistricts.has(item.district)) return false;

    if (state.onlyNearby && state.userLocation) {
      const dist = haversine(state.userLocation, item);
      if (dist > state.radiusKm) return false;
    }

    if (state.onlyBounds) {
      if (!bounds.contains([item.lat, item.lng])) return false;
    }

    return true;
  });

  state.filtered = filtered;
  updateMarkers();
  updateList();
}

function updateMarkers() {
  clusterGroup.clearLayers();
  state.filtered.forEach((item) => {
    const marker = state.markers.get(item.id);
    if (marker) clusterGroup.addLayer(marker);
  });
}

function updateList() {
  elements.resultList.innerHTML = "";

  const listData = [...state.filtered];
  if (state.userLocation) {
    listData.forEach((item) => {
      item.distance = haversine(state.userLocation, item);
    });
    listData.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  } else {
    listData.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }

  elements.resultCount.textContent = `${listData.length} 筆`;

  listData.forEach((item) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.addEventListener("click", () => focusVenue(item));

    const distanceText = state.userLocation
      ? `<span class="result-card__distance">${formatDistance(item.distance)}</span>`
      : "";

    card.innerHTML = `
      <div class="result-card__title">${item.name}</div>
      <div class="result-card__meta">
        <span>${item.remark}</span>
        <span>${item.district}</span>
        ${distanceText}
      </div>
      <div class="result-card__meta">${item.address}</div>
    `;

    elements.resultList.appendChild(card);
  });
}

function focusVenue(item) {
  const marker = state.markers.get(item.id);
  if (marker) {
    closeAllTooltips();
    clusterGroup.zoomToShowLayer(marker, () => {
      map.setView([item.lat, item.lng], Math.max(map.getZoom(), 16), { animate: true });
      marker.openTooltip();
    });
  }
  showDetail(item);
}

function showDetail(item) {
  elements.detailTitle.textContent = item.name;
  elements.detailType.textContent = `${item.remark} · ${item.district}`;

  const distance = state.userLocation ? formatDistance(haversine(state.userLocation, item)) : "";

  elements.detailBody.innerHTML = `
    <div class="detail__row"><span>地址</span>${item.address}</div>
    ${distance ? `<div class="detail__row"><span>距離</span>${distance}</div>` : ""}
    ${item.phone ? `<div class="detail__row"><span>市話</span>${formatPhoneLink(item.phone, item.ext)}</div>` : ""}
    ${item.mobile ? `<div class="detail__row"><span>行動電話</span>${formatPhoneLink(item.mobile)}</div>` : ""}
    ${item.org ? `<div class="detail__row"><span>所屬單位</span>${item.org}</div>` : ""}
    ${item.operator ? `<div class="detail__row"><span>經營主體</span>${item.operator}</div>` : ""}
    <div class="detail__actions">
      <button class="btn btn--ghost btn--sm" data-copy="${item.address}">複製地址</button>
      <a class="btn btn--ghost btn--sm" href="https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}" target="_blank" rel="noreferrer">開啟導航</a>
    </div>
  `;

  const copyBtn = elements.detailBody.querySelector("[data-copy]");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(copyBtn.dataset.copy);
      copyBtn.textContent = "已複製";
      setTimeout(() => (copyBtn.textContent = "複製地址"), 1200);
    });
  }
}

function resetDetailPanel() {
  elements.detailTitle.textContent = "點擊地圖上的場館";
  elements.detailType.textContent = "";
  elements.detailBody.innerHTML = "";
}

function formatPhoneLink(phone, ext = "") {
  const extText = ext ? `#${ext}` : "";
  const tel = phone.replace(/\s+/g, "");
  return `<a href="tel:${tel}">${phone}${extText}</a>`;
}

function locateUser() {
  if (!navigator.geolocation) {
    alert("瀏覽器不支援定位功能");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserLocation(latitude, longitude, "你在這裡");
    },
    () => {
      alert("定位失敗，可改用搜尋或台北車站備援");
    }
  );
}

function setUserLocation(lat, lng, label) {
  state.userLocation = { lat, lng };
  if (userMarker) {
    map.removeLayer(userMarker);
  }
  userMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div class="marker-icon marker-icon--yoga"><i class="fa-solid fa-location-dot"></i></div>`,
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    }),
  }).addTo(map);

  userMarker.bindTooltip(label, { permanent: true, direction: "right" });
  map.setView([lat, lng], 14, { animate: true });
  applyFilters();
}

function haversine(origin, item) {
  const lat1 = origin.lat;
  const lon1 = origin.lng;
  const lat2 = item.lat;
  const lon2 = item.lng;
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function formatDistance(distance) {
  if (!Number.isFinite(distance)) return "";
  if (distance < 1) return `${Math.round(distance * 1000)} m`;
  return `${distance.toFixed(2)} km`;
}

function onSearchInput(event) {
  const query = event.target.value.trim();
  if (!query) {
    closeSuggest();
    return;
  }
  const results = getSearchResults(query);
  renderSuggest(results.slice(0, 6));
}

function getSearchResults(query) {
  if (!state.fuse) return [];
  return state.fuse.search(query);
}

function renderSuggest(results) {
  elements.searchSuggest.innerHTML = "";
  if (!results.length) {
    closeSuggest();
    return;
  }

  results.forEach((result) => {
    const item = result.item;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${item.name} · ${item.district}`;
    button.addEventListener("click", () => {
      elements.searchInput.value = item.name;
      closeSuggest();
      focusVenue(item);
    });
    elements.searchSuggest.appendChild(button);
  });

  elements.searchSuggest.classList.add("is-open");
}

function closeSuggest() {
  elements.searchSuggest.classList.remove("is-open");
}

function closeAllTooltips() {
  state.markers.forEach((marker) => marker.closeTooltip());
}
