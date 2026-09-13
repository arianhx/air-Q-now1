/**
 * Air Q Now — vanilla JS air quality lookup via OpenWeather
 */

(function () {
  "use strict";

  const STORAGE_KEY = "airqnow_ow_api_key";
  const THEME_KEY = "airqnow_theme";
  const SUGGEST_DEBOUNCE_MS = 300;
  const SUGGEST_MIN_CHARS = 2;
  const SUGGEST_LIMIT = 5;
  const BLUR_HIDE_DELAY_MS = 150;

  const AQI_META = {
    1: { name: "Good", description: "Air quality is satisfactory." },
    2: { name: "Fair", description: "Acceptable air quality for most people." },
    3: { name: "Moderate", description: "Sensitive groups may notice effects." },
    4: { name: "Poor", description: "Health effects possible for everyone." },
    5: { name: "Very Poor", description: "Health warnings of emergency conditions." },
  };

  const TIPS_BY_AQI = {
    clean: {
      title: "What you can do",
      items: [
        "Great day for outdoor activity — walk, run, or cycle.",
        "Open windows to air out your home.",
        "Enjoy fresh air; no special precautions needed for most people.",
      ],
    },
    moderate: {
      title: "What you can do",
      items: [
        "Sensitive groups: consider shorter outdoor time or lighter activity.",
        "Watch for symptoms like coughing or shortness of breath.",
        "Prefer outdoor activity earlier or later when pollution is often lower.",
      ],
    },
    dirty: {
      title: "Suggestions",
      items: [
        "Limit outdoor exposure and heavy outdoor exercise.",
        "Keep windows closed; use recirculation if driving.",
        "Consider a well-fitting mask (e.g. N95) if you must go out.",
        "Improve indoor air: use a HEPA filter if available; avoid smoking or frying indoors.",
      ],
    },
  };

  const COMPONENT_LABELS = [
    { key: "pm2_5", label: "PM2.5" },
    { key: "pm10", label: "PM10" },
    { key: "co", label: "CO" },
    { key: "no2", label: "NO₂" },
    { key: "o3", label: "O₃" },
    { key: "so2", label: "SO₂" },
  ];

  // DOM
  const keyModal = document.getElementById("key-modal");
  const keyForm = document.getElementById("key-form");
  const apiKeyInput = document.getElementById("api-key-input");
  const keySubmitBtn = document.getElementById("key-submit-btn");
  const keyError = document.getElementById("key-error");
  const modalFormView = document.getElementById("modal-form-view");
  const modalSuccessView = document.getElementById("modal-success-view");
  const changeKeyBtn = document.getElementById("change-key-btn");
  const themeToggle = document.getElementById("theme-toggle");
  const searchForm = document.getElementById("search-form");
  const cityInput = document.getElementById("city-input");
  const searchBtn = document.getElementById("search-btn");
  const suggestionsEl = document.getElementById("suggestions");
  const statusMsg = document.getElementById("status-msg");
  const results = document.getElementById("results");
  const cityNameEl = document.getElementById("city-name");
  const localTimeEl = document.getElementById("local-time");
  const aqiBadge = document.getElementById("aqi-badge");
  const aqiValue = document.getElementById("aqi-value");
  const aqiLabel = document.getElementById("aqi-label");
  const componentsEl = document.getElementById("components");
  const tipsEl = document.getElementById("tips");
  const tipsTitle = document.getElementById("tips-title");
  const tipsList = document.getElementById("tips-list");

  // Suggestions state
  let suggestTimer = null;
  let suggestAbort = null;
  let suggestions = [];
  let activeSuggestIndex = -1;
  let blurHideTimer = null;
  let suppressSuggest = false;

  // Local time state
  let timezoneOffsetSec = null;
  let localTimeInterval = null;

  function getStoredKey() {
    return (localStorage.getItem(STORAGE_KEY) || "").trim();
  }

  function saveKey(key) {
    localStorage.setItem(STORAGE_KEY, key.trim());
  }

  function getTheme() {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
    themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }

  function showModal(isChange) {
    modalFormView.hidden = false;
    modalSuccessView.hidden = true;
    keyError.hidden = true;
    keyError.textContent = "";
    apiKeyInput.value = isChange ? getStoredKey() : "";
    apiKeyInput.disabled = false;
    keySubmitBtn.disabled = false;
    keySubmitBtn.textContent = "Submit";
    keyModal.hidden = false;
    setTimeout(() => apiKeyInput.focus(), 50);
  }

  function hideModal() {
    keyModal.hidden = true;
  }

  function showSuccessThenDismiss() {
    modalFormView.hidden = true;
    modalSuccessView.hidden = false;
    setTimeout(() => {
      hideModal();
      changeKeyBtn.hidden = false;
      cityInput.focus();
    }, 1000);
  }

  function currentAqiClass() {
    const match = Array.from(document.body.classList).find((c) =>
      /^aqi-/.test(c)
    );
    return match || "aqi-default";
  }

  function setBackgroundAqi(aqi) {
    const dark = document.body.classList.contains("dark");
    document.body.className = "";
    if (dark) document.body.classList.add("dark");
    const level = aqi >= 1 && aqi <= 5 ? aqi : "default";
    document.body.classList.add(`aqi-${level}`);
  }

  function showStatus(message, type) {
    statusMsg.hidden = false;
    statusMsg.textContent = message;
    statusMsg.className = "status-msg" + (type ? ` ${type}` : "");
  }

  function clearStatus() {
    statusMsg.hidden = true;
    statusMsg.textContent = "";
    statusMsg.className = "status-msg";
  }

  function clearLocalTime() {
    if (localTimeInterval) {
      clearInterval(localTimeInterval);
      localTimeInterval = null;
    }
    timezoneOffsetSec = null;
    localTimeEl.hidden = true;
    localTimeEl.textContent = "";
  }

  function formatLocalTime(offsetSec) {
    const now = Date.now();
    const localMs = now + offsetSec * 1000;
    const d = new Date(localMs);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `Local time · ${hh}:${mm}`;
  }

  function tickLocalTime() {
    if (timezoneOffsetSec == null || results.hidden) {
      clearLocalTime();
      return;
    }
    localTimeEl.textContent = formatLocalTime(timezoneOffsetSec);
    localTimeEl.hidden = false;
  }

  function startLocalTime(offsetSec) {
    clearLocalTime();
    if (typeof offsetSec !== "number" || Number.isNaN(offsetSec)) return;
    timezoneOffsetSec = offsetSec;
    tickLocalTime();
    localTimeInterval = setInterval(tickLocalTime, 1000);
  }

  function tipsForAqi(aqi) {
    if (aqi === 1 || aqi === 2) return TIPS_BY_AQI.clean;
    if (aqi === 3) return TIPS_BY_AQI.moderate;
    if (aqi === 4 || aqi === 5) return TIPS_BY_AQI.dirty;
    return null;
  }

  function renderTips(aqi) {
    const pack = tipsForAqi(aqi);
    if (!pack) {
      tipsEl.hidden = true;
      tipsList.innerHTML = "";
      return;
    }
    tipsTitle.textContent = pack.title;
    tipsList.innerHTML = pack.items
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join("");
    tipsEl.hidden = false;
  }

  function hideTips() {
    tipsEl.hidden = true;
    tipsList.innerHTML = "";
  }

  function setLoading(loading) {
    searchBtn.disabled = loading;
    cityInput.disabled = loading;
    if (loading) {
      showStatus("Loading air quality…", "loading");
      results.hidden = true;
      hideTips();
      clearLocalTime();
      hideSuggestions();
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatComponentValue(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    if (value >= 100) return value.toFixed(0);
    if (value >= 10) return value.toFixed(1);
    return value.toFixed(2);
  }

  function renderComponents(components) {
    if (!components || typeof components !== "object") {
      componentsEl.innerHTML = "";
      return;
    }

    const parts = COMPONENT_LABELS.filter((c) => components[c.key] != null).map(
      (c) => {
        const val = formatComponentValue(components[c.key]);
        return (
          `<div class="component">` +
          `<span class="component-name">${c.label}</span>` +
          `<span class="component-value">${val}` +
          `<span class="component-unit">μg/m³</span></span>` +
          `</div>`
        );
      }
    );

    componentsEl.innerHTML = parts.join("");
  }

  function renderResults(placeLabel, pollution, tzOffset) {
    const item = pollution && pollution.list && pollution.list[0];
    if (!item || !item.main) {
      throw new Error("Unexpected pollution response.");
    }

    const aqi = item.main.aqi;
    const meta = AQI_META[aqi] || { name: "Unknown", description: "" };

    cityNameEl.textContent = placeLabel;
    aqiBadge.textContent = meta.name;
    aqiValue.textContent = String(aqi);
    aqiLabel.textContent = meta.description;
    renderComponents(item.components);
    setBackgroundAqi(aqi);
    results.hidden = false;
    renderTips(aqi);
    if (typeof tzOffset === "number") {
      startLocalTime(tzOffset);
    } else {
      clearLocalTime();
    }
    clearStatus();
  }

  async function fetchJson(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      const err = new Error("Network error. Check your connection and try again.");
      err.code = "network";
      throw err;
    }

    if (res.status === 401) {
      const err = new Error("Invalid API key. Please update your OpenWeather key.");
      err.code = "invalid_key";
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`Request failed (${res.status}). Please try again.`);
      err.code = "http";
      throw err;
    }

    return res.json();
  }

  /** Lightweight ping: geocode London. Rejects empty/invalid keys. */
  async function validateApiKey(key) {
    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=London&limit=1&appid=` +
      `${encodeURIComponent(key)}`;

    let res;
    try {
      res = await fetch(url);
    } catch {
      const err = new Error("Network error. Check your connection and try again.");
      err.code = "network";
      throw err;
    }

    if (res.status === 401 || res.status === 403) {
      const err = new Error("Invalid API key.");
      err.code = "invalid_key";
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`Could not verify key (${res.status}). Try again.`);
      err.code = "http";
      throw err;
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      const err = new Error("Invalid API key.");
      err.code = "invalid_key";
      throw err;
    }
  }

  async function geocodeCity(city, key, limit) {
    const lim = limit == null ? 1 : limit;
    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=` +
      `${encodeURIComponent(city)}&limit=${lim}&appid=${encodeURIComponent(key)}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) {
      const err = new Error("City not found. Try another name or spelling.");
      err.code = "not_found";
      throw err;
    }
    return lim === 1 ? data[0] : data;
  }

  async function fetchPollution(lat, lon, key) {
    const url =
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}` +
      `&lon=${lon}&appid=${encodeURIComponent(key)}`;
    return fetchJson(url);
  }

  async function fetchWeatherTimezone(lat, lon, key) {
    const url =
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}` +
      `&lon=${lon}&appid=${encodeURIComponent(key)}`;
    const data = await fetchJson(url);
    if (typeof data.timezone !== "number") {
      return null;
    }
    return data.timezone;
  }

  function placeLabelFromGeo(geo) {
    const parts = [geo.name];
    if (geo.state) parts.push(geo.state);
    if (geo.country) parts.push(geo.country);
    return parts.join(", ");
  }

  function suggestionLabel(geo) {
    return placeLabelFromGeo(geo);
  }

  function hideSuggestions() {
    if (suggestAbort) {
      suggestAbort.abort();
      suggestAbort = null;
    }
    suggestions = [];
    activeSuggestIndex = -1;
    suggestionsEl.innerHTML = "";
    suggestionsEl.hidden = true;
    cityInput.setAttribute("aria-expanded", "false");
    cityInput.removeAttribute("aria-activedescendant");
  }

  function setActiveSuggestion(index) {
    const items = suggestionsEl.querySelectorAll(".suggestion-item");
    items.forEach((el, i) => {
      const active = i === index;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", active ? "true" : "false");
    });
    activeSuggestIndex = index;
    if (index >= 0 && items[index]) {
      cityInput.setAttribute("aria-activedescendant", items[index].id);
      items[index].scrollIntoView({ block: "nearest" });
    } else {
      cityInput.removeAttribute("aria-activedescendant");
    }
  }

  function renderSuggestions(list) {
    suggestions = list || [];
    activeSuggestIndex = -1;

    if (!suggestions.length) {
      hideSuggestions();
      return;
    }

    suggestionsEl.innerHTML = suggestions
      .map((geo, i) => {
        const label = suggestionLabel(geo);
        const secondary = [geo.state, geo.country].filter(Boolean).join(", ");
        return (
          `<li class="suggestion-item" role="option" id="suggest-${i}" ` +
          `aria-selected="false" data-index="${i}">` +
          `<span class="suggestion-name">${escapeHtml(geo.name)}</span>` +
          (secondary
            ? `<span class="suggestion-meta">${escapeHtml(secondary)}</span>`
            : "") +
          `</li>`
        );
      })
      .join("");

    suggestionsEl.hidden = false;
    cityInput.setAttribute("aria-expanded", "true");
  }

  function selectSuggestion(index) {
    const geo = suggestions[index];
    if (!geo) return;
    suppressSuggest = true;
    cityInput.value = suggestionLabel(geo);
    hideSuggestions();
    // Run search with the selected place
    runSearch(geo);
  }

  async function fetchSuggestions(query) {
    const key = getStoredKey();
    if (!key || query.length < SUGGEST_MIN_CHARS) {
      hideSuggestions();
      return;
    }

    if (suggestAbort) suggestAbort.abort();
    suggestAbort = new AbortController();
    const signal = suggestAbort.signal;

    try {
      const url =
        `https://api.openweathermap.org/geo/1.0/direct?q=` +
        `${encodeURIComponent(query)}&limit=${SUGGEST_LIMIT}` +
        `&appid=${encodeURIComponent(key)}`;
      const data = await fetchJson(url, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(data) || data.length === 0) {
        hideSuggestions();
        return;
      }
      renderSuggestions(data);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      // Skip quietly on errors (including invalid key during typing)
      hideSuggestions();
    }
  }

  function scheduleSuggestions() {
    if (suppressSuggest) {
      suppressSuggest = false;
      return;
    }
    clearTimeout(suggestTimer);
    const q = cityInput.value.trim();
    if (q.length < SUGGEST_MIN_CHARS || !getStoredKey()) {
      hideSuggestions();
      return;
    }
    suggestTimer = setTimeout(() => fetchSuggestions(q), SUGGEST_DEBOUNCE_MS);
  }

  async function runSearch(preselectedGeo) {
    const key = getStoredKey();

    if (!key) {
      showModal(false);
      return;
    }

    const city = cityInput.value.trim();
    if (!preselectedGeo && !city) return;

    setLoading(true);
    clearTimeout(suggestTimer);
    hideSuggestions();

    try {
      const geo = preselectedGeo || (await geocodeCity(city, key, 1));
      const [pollution, tzOffset] = await Promise.all([
        fetchPollution(geo.lat, geo.lon, key),
        fetchWeatherTimezone(geo.lat, geo.lon, key).catch(() => null),
      ]);
      renderResults(placeLabelFromGeo(geo), pollution, tzOffset);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      results.hidden = true;
      hideTips();
      clearLocalTime();
      setBackgroundAqi(null);
      showStatus(err.message || "Something went wrong.", "error");
      if (err.code === "invalid_key") {
        changeKeyBtn.hidden = false;
      }
    } finally {
      searchBtn.disabled = false;
      cityInput.disabled = false;
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    await runSearch(null);
  }

  keyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = apiKeyInput.value.trim();
    if (!key) {
      keyError.textContent = "Please enter your API key.";
      keyError.hidden = false;
      return;
    }

    keyError.hidden = true;
    keyError.textContent = "";
    apiKeyInput.disabled = true;
    keySubmitBtn.disabled = true;
    keySubmitBtn.textContent = "Checking…";

    try {
      await validateApiKey(key);
      saveKey(key);
      showSuccessThenDismiss();
    } catch (err) {
      keyError.textContent =
        err.code === "invalid_key"
          ? "Invalid API key."
          : err.message || "Could not verify API key.";
      keyError.hidden = false;
      apiKeyInput.disabled = false;
      keySubmitBtn.disabled = false;
      keySubmitBtn.textContent = "Submit";
      apiKeyInput.focus();
    }
  });

  changeKeyBtn.addEventListener("click", () => showModal(true));
  searchForm.addEventListener("submit", handleSearch);

  cityInput.addEventListener("input", scheduleSuggestions);

  cityInput.addEventListener("keydown", (event) => {
    if (suggestionsEl.hidden || !suggestions.length) {
      if (event.key === "Escape") hideSuggestions();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next =
        activeSuggestIndex < suggestions.length - 1
          ? activeSuggestIndex + 1
          : 0;
      setActiveSuggestion(next);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        activeSuggestIndex > 0
          ? activeSuggestIndex - 1
          : suggestions.length - 1;
      setActiveSuggestion(next);
    } else if (event.key === "Enter") {
      if (activeSuggestIndex >= 0) {
        event.preventDefault();
        selectSuggestion(activeSuggestIndex);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSuggestions();
    }
  });

  cityInput.addEventListener("blur", () => {
    clearTimeout(blurHideTimer);
    blurHideTimer = setTimeout(() => hideSuggestions(), BLUR_HIDE_DELAY_MS);
  });

  cityInput.addEventListener("focus", () => {
    clearTimeout(blurHideTimer);
    const q = cityInput.value.trim();
    if (q.length >= SUGGEST_MIN_CHARS && getStoredKey()) {
      scheduleSuggestions();
    }
  });

  suggestionsEl.addEventListener("mousedown", (event) => {
    // Prevent input blur before click handler runs
    event.preventDefault();
  });

  suggestionsEl.addEventListener("click", (event) => {
    const item = event.target.closest(".suggestion-item");
    if (!item) return;
    const index = Number(item.dataset.index);
    if (!Number.isNaN(index)) selectSuggestion(index);
  });

  themeToggle.addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    applyTheme(next);
    void currentAqiClass;
  });

  // Init theme first so body classes are correct
  applyTheme(getTheme());

  const existing = getStoredKey();
  if (existing) {
    changeKeyBtn.hidden = false;
    hideModal();
  } else {
    changeKeyBtn.hidden = true;
    showModal(false);
  }
})();
