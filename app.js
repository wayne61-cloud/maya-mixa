(() => {
  const AUTH_TOKEN_KEY = "maya_mixa_auth_token";
  const API_BASE_KEY = "maya_mixa_api_base";
  const APPLE_SYNC_KEY = "maya_mixa_apple_sync_at";
  const runtimeConfig = (() => {
    const inlineConfig = (typeof window !== "undefined" && window.__MAYA_CONFIG__) || {};
    const electronConfig = (typeof window !== "undefined" && window.mayaConfig) || {};
    let storedApiBase = "";
    try {
      storedApiBase = String(localStorage.getItem(API_BASE_KEY) || "").trim();
    } catch (_) {
      storedApiBase = "";
    }
    const rawApiBase = String(electronConfig.apiBase || inlineConfig.apiBase || storedApiBase || "").trim();
    const safeApiBase = /your-maya-mixa-api\.example\.com/i.test(rawApiBase) ? "" : rawApiBase;
    return {
      ...inlineConfig,
      ...electronConfig,
      apiBase: safeApiBase.replace(/\/+$/, ""),
    };
  })();

  const state = {
    activeScreen: "now-playing",
    liveMode: false,
    searchTab: "local",
    auth: {
      token: "",
      user: null,
      users: [],
      mode: "login",
      locked: true,
      oauth: {
        google: { configured: false, start_url: "/api/auth/oauth/google/start" },
        apple: { configured: false, start_url: "/api/auth/oauth/apple/start" },
      },
      settings: {
        passwordless: true,
        identifierLabel: "ID de connexion DJ",
        passwordRecoveryEnabled: false,
      },
    },

    tracks: [],
    tracksById: new Map(),
    localSearchResults: [],
    globalSearchResults: [],
    selectedExternalDetail: null,
    selectedExternalMatches: [],

    recommendations: [],
    activeTransition: null,
    liveCoach: null,

    serato: { status: "disconnected", deckA: null, deckB: null, mode: "none", lastSeen: null, lastError: "" },
    history: { averageCompatibility: 0, transitionsCount: 0, playsCount: 0, eventsCount: 0, events: [], externalSavedCount: 0 },
    ai: { localModelActive: true, openaiEnabled: false, openaiConnected: false, localModel: "loading", openaiMessage: "" },
    activeSession: null,
    accountDashboard: null,
    lastAppleSyncAt: null,

    poller: null,
    recommendationsPoller: null,
    searchDebounce: null,
  };

  const el = {
    appShell: document.getElementById("appShell"),
    sidebar: document.getElementById("sidebar"),
    mobileMenuBtn: document.getElementById("mobileMenuBtn"),
    navItems: Array.from(document.querySelectorAll(".nav-item")),
    screens: Array.from(document.querySelectorAll(".screen")),
    liveToggle: document.getElementById("liveToggle"),
    liveToggleSwitch: document.getElementById("liveToggleSwitch"),
    liveOverlay: document.getElementById("liveOverlay"),
    bridgeStatus: document.getElementById("bridgeStatus"),
    bridgeStatusText: document.getElementById("bridgeStatusText"),
    socketStatus: document.getElementById("socketStatus"),
    socketStatusText: document.getElementById("socketStatusText"),

    nowTrackName: document.getElementById("nowTrackName"),
    nowTrackArtist: document.getElementById("nowTrackArtist"),
    nowBpm: document.getElementById("nowBpm"),
    nowKey: document.getElementById("nowKey"),
    nowNote: document.getElementById("nowNote"),
    nowEnergy: document.getElementById("nowEnergy"),
    nowGenre: document.getElementById("nowGenre"),
    deckProgressBar: document.getElementById("deckProgressBar"),
    deckPosition: document.getElementById("deckPosition"),
    deckRemaining: document.getElementById("deckRemaining"),

    nextTrackName: document.getElementById("nextTrackName"),
    nextTrackArtist: document.getElementById("nextTrackArtist"),
    nextBpm: document.getElementById("nextBpm"),
    nextKey: document.getElementById("nextKey"),
    nextNote: document.getElementById("nextNote"),
    nextCompatibility: document.getElementById("nextCompatibility"),
    nextCompatibilityBar: document.getElementById("nextCompatibilityBar"),
    nowCoach: document.getElementById("nowCoach"),
    nowRecommendations: document.getElementById("nowRecommendations"),
    deckAWave: document.getElementById("deckAWave"),
    deckBWave: document.getElementById("deckBWave"),

    searchInput: document.getElementById("searchInput"),
    searchSubmitBtn: document.getElementById("searchSubmitBtn"),
    appleSyncBtn: document.getElementById("appleSyncBtn"),
    bpmFilterInput: document.getElementById("bpmFilterInput"),
    keyFilterInput: document.getElementById("keyFilterInput"),
    energyFilterInput: document.getElementById("energyFilterInput"),
    searchTabs: Array.from(document.querySelectorAll(".search-tab")),
    libraryLocalPane: document.getElementById("libraryLocalPane"),
    libraryGlobalPane: document.getElementById("libraryGlobalPane"),
    libraryMatchesPane: document.getElementById("libraryMatchesPane"),
    trackResults: document.getElementById("trackResults"),
    globalResults: document.getElementById("globalResults"),
    matchesResults: document.getElementById("matchesResults"),

    externalDetailCard: document.getElementById("externalDetailCard"),
    externalDetailBody: document.getElementById("externalDetailBody"),
    externalDetailHints: document.getElementById("externalDetailHints"),
    externalSaveWishlistBtn: document.getElementById("externalSaveWishlistBtn"),
    externalSaveCrateBtn: document.getElementById("externalSaveCrateBtn"),
    externalTestLibraryBtn: document.getElementById("externalTestLibraryBtn"),
    externalFindSimilarBtn: document.getElementById("externalFindSimilarBtn"),

    libraryPathInput: document.getElementById("libraryPathInput"),
    scanLibraryBtn: document.getElementById("scanLibraryBtn"),
    scanStatus: document.getElementById("scanStatus"),

    trackASelect: document.getElementById("trackASelect"),
    trackBSelect: document.getElementById("trackBSelect"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    transitionResult: document.getElementById("transitionResult"),

    analysisTrackSelect: document.getElementById("analysisTrackSelect"),
    analysisKpis: document.getElementById("analysisKpis"),
    analysisDna: document.getElementById("analysisDna"),
    analysisOutlook: document.getElementById("analysisOutlook"),
    analysisMixHints: document.getElementById("analysisMixHints"),
    analysisEnergyRing: document.getElementById("analysisEnergyRing"),
    analysisEnergyRingValue: document.getElementById("analysisEnergyRingValue"),

    historyAvg: document.getElementById("historyAvg"),
    historyTransitions: document.getElementById("historyTransitions"),
    historySwitches: document.getElementById("historySwitches"),
    historyEvents: document.getElementById("historyEvents"),

    seratoModeSelect: document.getElementById("seratoModeSelect"),
    wsUrlInput: document.getElementById("wsUrlInput"),
    historyPathInput: document.getElementById("historyPathInput"),
    feedPathInput: document.getElementById("feedPathInput"),
    wsConnectBtn: document.getElementById("wsConnectBtn"),
    wsDisconnectBtn: document.getElementById("wsDisconnectBtn"),
    wsStatusDetail: document.getElementById("wsStatusDetail"),
    sessionStatusDetail: document.getElementById("sessionStatusDetail"),

    startSessionBtn: document.getElementById("startSessionBtn"),
    endSessionBtn: document.getElementById("endSessionBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),

    liveTrackName: document.getElementById("liveTrackName"),
    liveBpm: document.getElementById("liveBpm"),
    liveKey: document.getElementById("liveKey"),
    liveNote: document.getElementById("liveNote"),
    liveEnergy: document.getElementById("liveEnergy"),
    liveMixWindow: document.getElementById("liveMixWindow"),
    liveCountdown: document.getElementById("liveCountdown"),
    liveAlert: document.getElementById("liveAlert"),
    liveCoachList: document.getElementById("liveCoachList"),
    liveSuggestions: document.getElementById("liveSuggestions"),

    authGate: document.getElementById("authGate"),
    authLoginTab: document.getElementById("authLoginTab"),
    authRegisterTab: document.getElementById("authRegisterTab"),
    authLoginForm: document.getElementById("authLoginForm"),
    authRegisterForm: document.getElementById("authRegisterForm"),
    authForgotForm: document.getElementById("authForgotForm"),
    authResetForm: document.getElementById("authResetForm"),
    authFeedback: document.getElementById("authFeedback"),
    loginIdentifierLabel: document.getElementById("loginIdentifierLabel"),
    registerIdentifierLabel: document.getElementById("registerIdentifierLabel"),
    loginPasswordFields: document.getElementById("loginPasswordFields"),
    registerPasswordFields: document.getElementById("registerPasswordFields"),
    forgotPasswordRow: document.getElementById("forgotPasswordRow"),
    loginEmailInput: document.getElementById("loginEmailInput"),
    loginPasswordInput: document.getElementById("loginPasswordInput"),
    loginSubmitBtn: document.getElementById("loginSubmitBtn"),
    forgotPasswordBtn: document.getElementById("forgotPasswordBtn"),
    forgotEmailInput: document.getElementById("forgotEmailInput"),
    forgotSubmitBtn: document.getElementById("forgotSubmitBtn"),
    forgotBackBtn: document.getElementById("forgotBackBtn"),
    googleAuthBtn: document.getElementById("googleAuthBtn"),
    appleAuthBtn: document.getElementById("appleAuthBtn"),
    oauthStatusText: document.getElementById("oauthStatusText"),
    apiConfigCard: document.getElementById("apiConfigCard"),
    apiBaseInput: document.getElementById("apiBaseInput"),
    apiBaseSaveBtn: document.getElementById("apiBaseSaveBtn"),
    apiBaseTestBtn: document.getElementById("apiBaseTestBtn"),
    apiBaseStatus: document.getElementById("apiBaseStatus"),
    openResetTokenBtn: document.getElementById("openResetTokenBtn"),
    resetTokenInput: document.getElementById("resetTokenInput"),
    resetNewPasswordInput: document.getElementById("resetNewPasswordInput"),
    resetConfirmPasswordInput: document.getElementById("resetConfirmPasswordInput"),
    resetSubmitBtn: document.getElementById("resetSubmitBtn"),
    resetBackBtn: document.getElementById("resetBackBtn"),
    registerDisplayNameInput: document.getElementById("registerDisplayNameInput"),
    registerDjNameInput: document.getElementById("registerDjNameInput"),
    registerEmailInput: document.getElementById("registerEmailInput"),
    registerPasswordInput: document.getElementById("registerPasswordInput"),
    registerConfirmPasswordInput: document.getElementById("registerConfirmPasswordInput"),
    registerSubmitBtn: document.getElementById("registerSubmitBtn"),
    openAccountBtn: document.getElementById("openAccountBtn"),
    logoutBtn: document.getElementById("logoutBtn"),

    profileEmailInput: document.getElementById("profileEmailInput"),
    profileIdentifierLabel: document.getElementById("profileIdentifierLabel"),
    profileDisplayNameInput: document.getElementById("profileDisplayNameInput"),
    profileDjNameInput: document.getElementById("profileDjNameInput"),
    profileSaveBtn: document.getElementById("profileSaveBtn"),
    profileSessionStatus: document.getElementById("profileSessionStatus"),
    profileSessionTime: document.getElementById("profileSessionTime"),
    profileCloudStatus: document.getElementById("profileCloudStatus"),
    profileAiTipsCount: document.getElementById("profileAiTipsCount"),
    profileAiTips: document.getElementById("profileAiTips"),
    profileTopTracks: document.getElementById("profileTopTracks"),
    profileWishlist: document.getElementById("profileWishlist"),
    profilePrepCrate: document.getElementById("profilePrepCrate"),
    passwordCurrentInput: document.getElementById("passwordCurrentInput"),
    passwordNewInput: document.getElementById("passwordNewInput"),
    passwordConfirmInput: document.getElementById("passwordConfirmInput"),
    passwordSaveBtn: document.getElementById("passwordSaveBtn"),
    accountSecurityCard: document.getElementById("accountSecurityCard"),
    adminPanelCard: document.getElementById("adminPanelCard"),
    adminRefreshUsersBtn: document.getElementById("adminRefreshUsersBtn"),
    adminUsersTableBody: document.getElementById("adminUsersTableBody"),

    toast: document.getElementById("toast"),
  };

  function safeDetail(message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === "object" && parsed.detail) return String(parsed.detail);
    } catch (_) {
      return message || "Unknown error";
    }
    return message || "Unknown error";
  }

  function lockAppUi(locked) {
    state.auth.locked = Boolean(locked);
    document.body.classList.toggle("auth-locked", state.auth.locked);
    if (el.authGate) el.authGate.classList.toggle("active", state.auth.locked);
    if (el.appShell) el.appShell.style.pointerEvents = state.auth.locked ? "none" : "auto";
  }

  function normalizeApiBase(value) {
    return String(value || "")
      .trim()
      .replace(/\/+$/, "");
  }

  function requiresConfiguredApiBase() {
    return window.location.protocol === "file:";
  }

  function hasApiBaseConfigured() {
    return Boolean(normalizeApiBase(runtimeConfig.apiBase));
  }

  function setRuntimeApiBase(value, persist = true) {
    runtimeConfig.apiBase = normalizeApiBase(value);
    if (!persist) return;
    try {
      if (runtimeConfig.apiBase) {
        localStorage.setItem(API_BASE_KEY, runtimeConfig.apiBase);
      } else {
        localStorage.removeItem(API_BASE_KEY);
      }
    } catch (_) {
      // Ignore storage errors (private mode / restricted contexts).
    }
  }

  function updateApiConfigUi() {
    if (!el.apiConfigCard || !el.apiBaseInput || !el.apiBaseStatus) return;
    const shouldShow = requiresConfiguredApiBase() || !hasApiBaseConfigured();
    el.apiConfigCard.classList.toggle("hidden", !shouldShow);
    el.apiBaseInput.value = runtimeConfig.apiBase || "";
    if (hasApiBaseConfigured()) {
      el.apiBaseStatus.textContent = `API: ${runtimeConfig.apiBase}`;
      el.apiBaseStatus.classList.remove("error");
      el.apiBaseStatus.classList.add("success");
    } else {
      el.apiBaseStatus.textContent = "API backend non configurée.";
      el.apiBaseStatus.classList.remove("success");
      el.apiBaseStatus.classList.add("error");
    }
  }

  function ensureApiConfiguredForAuth() {
    if (!requiresConfiguredApiBase()) return true;
    if (hasApiBaseConfigured()) return true;
    setAuthFeedback("Backend API non configurée. Renseigne l'URL de ton backend dans la section API.", "error");
    updateApiConfigUi();
    return false;
  }

  function getAppleSyncTimestamp() {
    try {
      return String(localStorage.getItem(APPLE_SYNC_KEY) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function setAppleSyncTimestamp(isoValue) {
    try {
      if (!isoValue) {
        localStorage.removeItem(APPLE_SYNC_KEY);
      } else {
        localStorage.setItem(APPLE_SYNC_KEY, isoValue);
      }
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function isPasswordlessMode() {
    return Boolean(state.auth.settings?.passwordless);
  }

  function applyAuthSettings() {
    const passwordless = isPasswordlessMode();
    const identifierLabel = state.auth.settings?.identifierLabel || (passwordless ? "ID de connexion DJ" : "Email");

    if (el.loginIdentifierLabel) el.loginIdentifierLabel.textContent = identifierLabel;
    if (el.registerIdentifierLabel) el.registerIdentifierLabel.textContent = identifierLabel;
    if (el.profileIdentifierLabel) el.profileIdentifierLabel.textContent = identifierLabel;
    if (el.loginEmailInput) {
      el.loginEmailInput.placeholder = passwordless ? "ID DJ (ex: dj_hive_01)" : "Email ou ID admin";
    }
    if (el.registerEmailInput) {
      el.registerEmailInput.placeholder = passwordless ? "ID DJ unique (ex: dj_maya)" : "Email";
      el.registerEmailInput.type = passwordless ? "text" : "email";
      el.registerEmailInput.autocomplete = passwordless ? "username" : "email";
    }

    el.loginPasswordFields?.classList.toggle("hidden", passwordless);
    el.registerPasswordFields?.classList.toggle("hidden", passwordless);
    el.forgotPasswordRow?.classList.toggle("hidden", passwordless);
    el.authForgotForm?.classList.toggle("hidden", passwordless || state.auth.mode !== "forgot");
    el.authResetForm?.classList.toggle("hidden", passwordless || state.auth.mode !== "reset");
    el.accountSecurityCard?.classList.toggle("hidden", passwordless);

    if (el.loginPasswordInput) {
      el.loginPasswordInput.required = !passwordless;
      if (passwordless) el.loginPasswordInput.value = "";
    }
    if (el.registerPasswordInput) {
      el.registerPasswordInput.required = !passwordless;
      if (passwordless) el.registerPasswordInput.value = "";
    }
    if (el.registerConfirmPasswordInput) {
      el.registerConfirmPasswordInput.required = !passwordless;
      if (passwordless) el.registerConfirmPasswordInput.value = "";
    }
    if (passwordless && (state.auth.mode === "forgot" || state.auth.mode === "reset")) {
      state.auth.mode = "login";
    }
  }

  function setAuthFeedback(message, status = "neutral") {
    if (!el.authFeedback) return;
    el.authFeedback.textContent = message || "";
    el.authFeedback.classList.remove("error", "success");
    if (status === "error") el.authFeedback.classList.add("error");
    if (status === "success") el.authFeedback.classList.add("success");
  }

  function setAuthTab(mode) {
    const allowedModes = new Set(["login", "register", "forgot", "reset"]);
    const requested = allowedModes.has(mode) ? mode : "login";
    state.auth.mode = isPasswordlessMode() && (requested === "forgot" || requested === "reset") ? "login" : requested;
    applyAuthSettings();
    el.authLoginTab?.classList.toggle("active", state.auth.mode === "login");
    el.authRegisterTab?.classList.toggle("active", state.auth.mode === "register");
    el.authLoginForm?.classList.toggle("hidden", state.auth.mode !== "login");
    el.authRegisterForm?.classList.toggle("hidden", state.auth.mode !== "register");
    el.authForgotForm?.classList.toggle("hidden", isPasswordlessMode() || state.auth.mode !== "forgot");
    el.authResetForm?.classList.toggle("hidden", isPasswordlessMode() || state.auth.mode !== "reset");
    if (state.auth.mode === "login") {
      if (requiresConfiguredApiBase() && !hasApiBaseConfigured()) {
        setAuthFeedback("Backend API non configurée. Renseigne l'URL API ci-dessous.", "error");
      } else if (isPasswordlessMode()) {
        setAuthFeedback("Mode sans mot de passe actif. Utilise uniquement ton ID de connexion DJ.");
      } else {
        setAuthFeedback("Connecte-toi pour accéder à Maya Mixa.");
      }
    } else if (state.auth.mode === "register") {
      if (isPasswordlessMode()) {
        setAuthFeedback("Crée un profil DJ avec un ID de connexion unique (sans mot de passe).");
      } else {
        setAuthFeedback("Crée un profil DJ pour accéder à l'app.");
      }
    } else if (state.auth.mode === "forgot") {
      setAuthFeedback("Entre ton email DJ pour recevoir un code de reset.");
    } else {
      setAuthFeedback("Entre le code reçu puis définis un nouveau mot de passe.");
    }
  }

  function updateOAuthButtons() {
    const google = state.auth.oauth?.google || { configured: false };
    const apple = state.auth.oauth?.apple || { configured: false };
    const apiMissing = requiresConfiguredApiBase() && !hasApiBaseConfigured();

    if (el.googleAuthBtn) {
      el.googleAuthBtn.disabled = apiMissing || !google.configured;
      el.googleAuthBtn.title = apiMissing
        ? "Configure l'URL API backend d'abord"
        : google.configured
        ? "Connexion Google activée"
        : "Google OAuth non configuré côté backend";
    }
    if (el.appleAuthBtn) {
      el.appleAuthBtn.disabled = apiMissing || !apple.configured;
      el.appleAuthBtn.title = apiMissing
        ? "Configure l'URL API backend d'abord"
        : apple.configured
        ? "Connexion Apple activée"
        : "Apple OAuth non configuré côté backend";
    }
    if (el.oauthStatusText) {
      if (apiMissing) {
        el.oauthStatusText.textContent = "Configure d'abord l'URL backend API.";
      } else if (google.configured && apple.configured) {
        el.oauthStatusText.textContent = "Google et Apple sont connectables.";
      } else if (google.configured || apple.configured) {
        el.oauthStatusText.textContent = "Un provider OAuth est actif. Configure l'autre pour le duo complet.";
      } else {
        el.oauthStatusText.textContent = "Google/Apple OAuth non configurés sur le backend.";
      }
    }
  }

  async function refreshOAuthProviders() {
    if (requiresConfiguredApiBase() && !hasApiBaseConfigured()) {
      state.auth.oauth = {
        google: { configured: false, start_url: "/api/auth/oauth/google/start" },
        apple: { configured: false, start_url: "/api/auth/oauth/apple/start" },
      };
      updateOAuthButtons();
      return;
    }
    try {
      const payload = await api("GET", "/api/auth/oauth/providers", undefined, { auth: false });
      state.auth.oauth = payload?.providers || state.auth.oauth;
    } catch (_) {
      state.auth.oauth = {
        google: { configured: false, start_url: "/api/auth/oauth/google/start" },
        apple: { configured: false, start_url: "/api/auth/oauth/apple/start" },
      };
    }
    updateOAuthButtons();
  }

  async function refreshAuthSettings() {
    if (requiresConfiguredApiBase() && !hasApiBaseConfigured()) {
      applyAuthSettings();
      return;
    }
    try {
      const payload = await api("GET", "/api/auth/config", undefined, { auth: false });
      state.auth.settings = payload?.auth || state.auth.settings;
    } catch (_) {
      // keep defaults
    }
    applyAuthSettings();
  }

  function oauthStartUrl(provider) {
    const path = state.auth.oauth?.[provider]?.start_url || `/api/auth/oauth/${provider}/start`;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (runtimeConfig.apiBase) return `${runtimeConfig.apiBase}${normalizedPath}`;
    return normalizedPath;
  }

  function startOAuthLogin(provider) {
    if (!ensureApiConfiguredForAuth()) return;
    const cfg = state.auth.oauth?.[provider];
    if (!cfg?.configured) {
      setAuthFeedback(`${provider} OAuth non configuré sur ce runtime.`, "error");
      return;
    }
    window.location.href = oauthStartUrl(provider);
  }

  async function saveApiBaseConfig() {
    const entered = normalizeApiBase(el.apiBaseInput?.value || "");
    if (!entered) {
      setRuntimeApiBase("", true);
      updateApiConfigUi();
      setAuthFeedback("URL API vide. Configure une URL backend valide.", "error");
      return;
    }
    if (!/^https?:\/\//i.test(entered)) {
      setAuthFeedback("URL API invalide. Utilise http(s)://...", "error");
      return;
    }
    setRuntimeApiBase(entered, true);
    updateApiConfigUi();
    setAuthFeedback(`API configurée: ${entered}`, "success");
    await refreshAuthSettings();
    await refreshOAuthProviders();
  }

  async function testApiBaseConnection() {
    if (!hasApiBaseConfigured()) {
      setAuthFeedback("Configure d'abord l'URL API.", "error");
      updateApiConfigUi();
      return;
    }
    if (el.apiBaseTestBtn) el.apiBaseTestBtn.disabled = true;
    try {
      const health = await api("GET", "/api/health", undefined, { auth: false });
      setAuthFeedback(`Backend connecté (${health?.ok ? "ok" : "unknown"}).`, "success");
      await refreshAuthSettings();
      await refreshOAuthProviders();
      updateApiConfigUi();
    } catch (error) {
      setAuthFeedback(String(error.message || error), "error");
      updateApiConfigUi();
    } finally {
      if (el.apiBaseTestBtn) el.apiBaseTestBtn.disabled = false;
    }
  }

  function persistAuthToken(token) {
    state.auth.token = token || "";
    if (state.auth.token) {
      localStorage.setItem(AUTH_TOKEN_KEY, state.auth.token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  }

  function setCurrentUser(user) {
    state.auth.user = user || null;
    const fallback = "Profil DJ";
    const label = state.auth.user ? `${state.auth.user.dj_name || state.auth.user.display_name || state.auth.user.email}` : fallback;
    if (el.openAccountBtn) el.openAccountBtn.textContent = label;
    if (el.profileEmailInput) el.profileEmailInput.value = state.auth.user?.email || "";
    if (el.profileDisplayNameInput) el.profileDisplayNameInput.value = state.auth.user?.display_name || "";
    if (el.profileDjNameInput) el.profileDjNameInput.value = state.auth.user?.dj_name || "";
    const isAdmin = state.auth.user?.role === "admin";
    el.adminPanelCard?.classList.toggle("hidden", !isAdmin);
  }

  function resetSensitiveInputs() {
    if (el.loginPasswordInput) el.loginPasswordInput.value = "";
    if (el.registerPasswordInput) el.registerPasswordInput.value = "";
    if (el.registerConfirmPasswordInput) el.registerConfirmPasswordInput.value = "";
    if (el.resetTokenInput) el.resetTokenInput.value = "";
    if (el.resetNewPasswordInput) el.resetNewPasswordInput.value = "";
    if (el.resetConfirmPasswordInput) el.resetConfirmPasswordInput.value = "";
    if (el.passwordCurrentInput) el.passwordCurrentInput.value = "";
    if (el.passwordNewInput) el.passwordNewInput.value = "";
    if (el.passwordConfirmInput) el.passwordConfirmInput.value = "";
  }

  function forceLogoutUi(message = "Session expirée. Reconnecte-toi.") {
    persistAuthToken("");
    setCurrentUser(null);
    stopPollers();
    lockAppUi(true);
    setAuthTab("login");
    setAuthFeedback(message, "error");
    resetSensitiveInputs();
  }

  async function api(method, path, payload, requestConfig = {}) {
    if (requiresConfiguredApiBase() && !hasApiBaseConfigured()) {
      throw new Error("Backend API non configurée. Ajoute l'URL backend (ex: https://ton-api.onrender.com).");
    }
    const normalizedPath = /^https?:\/\//i.test(path) ? path : path.startsWith("/") ? path : `/${path}`;
    const url = /^https?:\/\//i.test(path)
      ? path
      : runtimeConfig.apiBase
      ? `${runtimeConfig.apiBase}${normalizedPath}`
      : normalizedPath;
    const requestOptions = { method };
    const headers = {};
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(payload);
    }
    const useAuth = requestConfig.auth !== false;
    if (useAuth && state.auth.token) {
      headers.Authorization = `Bearer ${state.auth.token}`;
    }
    if (Object.keys(headers).length) requestOptions.headers = headers;
    let response;
    try {
      response = await fetch(url, requestOptions);
    } catch (_) {
      throw new Error(`Impossible de joindre le backend (${url}). Vérifie l'URL API et que le serveur est en ligne.`);
    }

    if (!response.ok) {
      const body = await response.text();
      if (useAuth && response.status === 401) {
        forceLogoutUi("Session invalide ou expirée. Reconnecte-toi.");
      }
      throw new Error(safeDetail(body) || `HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return response.json();
    return response.text();
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 1800);
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function formatHms(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remain = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  }

  function compatClass(score) {
    if (score >= 86) return "compat-easy";
    if (score >= 72) return "compat-medium";
    return "compat-hard";
  }

  function typingIndicatorMarkup(label) {
    return `<span class="typing-indicator"><span></span><span></span><span></span>${esc(label)}</span>`;
  }

  function setWaveMenuState(node, bpm, isPlaying) {
    if (!node) return;
    const normalizedBpm = clamp(Number(bpm) || 120, 70, 160);
    const speed = clamp(1.9 - (normalizedBpm - 70) * 0.012, 0.52, 1.85);
    node.style.setProperty("--wave-speed", `${speed.toFixed(2)}s`);
    node.classList.toggle("playing", Boolean(isPlaying));
  }

  function trackPassesFilters(track) {
    const bpmFilter = Number((el.bpmFilterInput?.value || "").trim());
    const keyFilter = (el.keyFilterInput?.value || "").trim().toUpperCase();
    const energyFilter = Number((el.energyFilterInput?.value || "").trim());

    if (Number.isFinite(bpmFilter) && bpmFilter > 0) {
      const bpm = Number(track?.bpm || 0);
      if (!Number.isFinite(bpm) || Math.abs(bpm - bpmFilter) > 2) return false;
    }

    if (keyFilter) {
      const key = String(track?.camelot_key || track?.musical_key || "").toUpperCase();
      if (!key.includes(keyFilter)) return false;
    }

    if (Number.isFinite(energyFilter) && energyFilter > 0) {
      const energy = Number(track?.energy ?? track?.note ?? 0);
      if (!Number.isFinite(energy) || energy < energyFilter) return false;
    }

    return true;
  }

  function setStatusPill(node, textNode, status, label, extra = "") {
    node.classList.remove("connected", "disconnected", "error");
    if (status === "connected") node.classList.add("connected");
    if (status === "disconnected") node.classList.add("disconnected");
    if (status === "error") node.classList.add("error");
    textNode.textContent = `${label}: ${extra || status}`;
  }

  function trackLabel(track) {
    return `${esc(track.artist || "Unknown")} - ${esc(track.title || "Unknown")}`;
  }

  function getTrackById(id) {
    return state.tracksById.get(Number(id)) || null;
  }

  function currentDeckTrack(deckPayload) {
    if (!deckPayload) return null;
    if (deckPayload.track_id && getTrackById(deckPayload.track_id)) return getTrackById(deckPayload.track_id);
    return {
      id: deckPayload.track_id || 0,
      title: deckPayload.title || "Unknown Track",
      artist: deckPayload.artist || "Unknown Artist",
      bpm: deckPayload.bpm || 0,
      camelot_key: deckPayload.key || "",
      musical_key: deckPayload.key || "",
      note: deckPayload.note || 0,
      energy: deckPayload.energy || 0,
      duration: 0,
      genre: "unknown",
      tags: [],
      features: {},
    };
  }

  async function bootstrapAuth() {
    if (requiresConfiguredApiBase() && !hasApiBaseConfigured()) {
      lockAppUi(true);
      setAuthFeedback("Backend API non configurée. Ajoute l'URL backend pour te connecter.", "error");
      updateApiConfigUi();
      return false;
    }
    persistAuthToken(localStorage.getItem(AUTH_TOKEN_KEY) || "");
    if (!state.auth.token) {
      lockAppUi(true);
      return false;
    }
    try {
      const payload = await api("GET", "/api/auth/me");
      setCurrentUser(payload.user || null);
      lockAppUi(false);
      return true;
    } catch (_) {
      forceLogoutUi("Session expirée. Reconnecte-toi.");
      return false;
    }
  }

  function bootstrapApiBaseFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const override = normalizeApiBase(params.get("api_base") || "");
      if (!override) return;
      setRuntimeApiBase(override, true);
      params.delete("api_base");
      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
    } catch (_) {
      // Ignore URL parsing failures.
    }
  }

  function bootstrapOAuthFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const authToken = (params.get("auth_token") || "").trim();
      const oauthProvider = (params.get("oauth_provider") || "").trim();
      const oauthError = (params.get("oauth_error") || "").trim();
      if (!authToken && !oauthError) return;

      if (authToken) {
        persistAuthToken(authToken);
        setAuthFeedback(`Connexion ${oauthProvider || "OAuth"} réussie.`, "success");
      } else if (oauthError) {
        setAuthFeedback(`OAuth error: ${oauthError}`, "error");
      }

      params.delete("auth_token");
      params.delete("oauth_provider");
      params.delete("oauth_error");
      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
    } catch (_) {
      // Ignore URL parsing failures.
    }
  }

  function bootstrapResetFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const token = (params.get("reset_token") || "").trim();
      if (!token) return;
      if (el.resetTokenInput) el.resetTokenInput.value = token;
      lockAppUi(true);
      setAuthTab("reset");
      params.delete("reset_token");
      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
    } catch (_) {
      // Ignore URL parsing failures.
    }
  }

  async function loginSubmit(event) {
    event.preventDefault();
    if (!ensureApiConfiguredForAuth()) return;
    const email = (el.loginEmailInput?.value || "").trim().toLowerCase();
    const password = isPasswordlessMode() ? "" : el.loginPasswordInput?.value || "";
    if (!email || (!isPasswordlessMode() && !password)) {
      setAuthFeedback(isPasswordlessMode() ? "ID de connexion requis." : "Email et mot de passe requis.", "error");
      return;
    }
    el.loginSubmitBtn.disabled = true;
    try {
      const payload = await api("POST", "/api/auth/login", { email, password }, { auth: false });
      persistAuthToken(payload.token || "");
      setCurrentUser(payload.user || null);
      lockAppUi(false);
      setAuthFeedback("Connexion réussie.", "success");
      resetSensitiveInputs();
      navigateTo("now-playing");
      await loadAuthorizedData();
      startPollers();
      showToast(`Bienvenue ${state.auth.user?.dj_name || state.auth.user?.display_name || ""}`.trim());
    } catch (error) {
      setAuthFeedback(String(error.message || error), "error");
    } finally {
      el.loginSubmitBtn.disabled = false;
    }
  }

  async function registerSubmit(event) {
    event.preventDefault();
    if (!ensureApiConfiguredForAuth()) return;
    const displayName = (el.registerDisplayNameInput?.value || "").trim();
    const djName = (el.registerDjNameInput?.value || "").trim() || displayName;
    const email = (el.registerEmailInput?.value || "").trim().toLowerCase();
    const password = isPasswordlessMode() ? "" : el.registerPasswordInput?.value || "";
    const confirmPassword = isPasswordlessMode() ? "" : el.registerConfirmPasswordInput?.value || "";
    if (!displayName || !email || (!isPasswordlessMode() && !password)) {
      setAuthFeedback(
        isPasswordlessMode() ? "Nom et ID de connexion requis." : "Nom, email et mot de passe requis.",
        "error"
      );
      return;
    }
    if (!isPasswordlessMode() && password.length < 8) {
      setAuthFeedback("Le mot de passe doit contenir au moins 8 caractères.", "error");
      return;
    }
    if (!isPasswordlessMode() && password !== confirmPassword) {
      setAuthFeedback("Les mots de passe ne correspondent pas.", "error");
      return;
    }
    el.registerSubmitBtn.disabled = true;
    try {
      const payload = await api(
        "POST",
        "/api/auth/register",
        {
          email,
          password,
          display_name: displayName,
          dj_name: djName,
        },
        { auth: false }
      );
      persistAuthToken(payload.token || "");
      setCurrentUser(payload.user || null);
      lockAppUi(false);
      setAuthFeedback("Compte créé avec succès.", "success");
      resetSensitiveInputs();
      navigateTo("now-playing");
      await loadAuthorizedData();
      startPollers();
      showToast("Compte DJ créé");
    } catch (error) {
      setAuthFeedback(String(error.message || error), "error");
    } finally {
      el.registerSubmitBtn.disabled = false;
    }
  }

  function openForgotFlow() {
    if (isPasswordlessMode()) {
      setAuthFeedback("Récupération mot de passe indisponible: mode sans mot de passe actif.", "error");
      return;
    }
    const loginEmail = (el.loginEmailInput?.value || "").trim();
    if (el.forgotEmailInput && loginEmail) {
      el.forgotEmailInput.value = loginEmail;
    }
    setAuthTab("forgot");
  }

  function openResetFlow(prefillToken = "") {
    if (el.resetTokenInput && prefillToken) {
      el.resetTokenInput.value = prefillToken;
    }
    setAuthTab("reset");
  }

  async function forgotPasswordSubmit(event) {
    event.preventDefault();
    if (isPasswordlessMode()) {
      setAuthFeedback("Récupération mot de passe désactivée en mode sans mot de passe.", "error");
      return;
    }
    if (!ensureApiConfiguredForAuth()) return;
    const email = (el.forgotEmailInput?.value || "").trim();
    if (!email) {
      setAuthFeedback("Entre ton email pour reset ton mot de passe.", "error");
      return;
    }
    el.forgotSubmitBtn.disabled = true;
    try {
      const payload = await api("POST", "/api/auth/forgot-password", { email }, { auth: false });
      const debugToken = payload?.debug_reset_token || "";
      if (debugToken) {
        openResetFlow(debugToken);
        setAuthFeedback("Code de reset généré (mode debug).", "success");
        showToast("Code de reset généré");
      } else {
        openResetFlow();
        setAuthFeedback(payload?.message || "Si le compte existe, un reset a été envoyé.", "success");
        showToast("Si le compte existe, le reset a été envoyé");
      }
    } catch (error) {
      setAuthFeedback(String(error.message || error), "error");
    } finally {
      el.forgotSubmitBtn.disabled = false;
    }
  }

  async function resetPasswordSubmit(event) {
    event.preventDefault();
    if (isPasswordlessMode()) {
      setAuthFeedback("Reset mot de passe désactivé en mode sans mot de passe.", "error");
      return;
    }
    if (!ensureApiConfiguredForAuth()) return;
    const token = (el.resetTokenInput?.value || "").trim();
    const newPassword = el.resetNewPasswordInput?.value || "";
    const confirmPassword = el.resetConfirmPasswordInput?.value || "";
    if (!token || !newPassword || !confirmPassword) {
      setAuthFeedback("Code et nouveau mot de passe requis.", "error");
      return;
    }
    if (newPassword.length < 8) {
      setAuthFeedback("Le nouveau mot de passe doit avoir 8+ caractères.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      setAuthFeedback("La confirmation du mot de passe ne correspond pas.", "error");
      return;
    }
    el.resetSubmitBtn.disabled = true;
    try {
      await api("POST", "/api/auth/reset-password", { token, new_password: newPassword }, { auth: false });
      if (el.loginPasswordInput) el.loginPasswordInput.value = "";
      if (el.resetTokenInput) el.resetTokenInput.value = "";
      if (el.resetNewPasswordInput) el.resetNewPasswordInput.value = "";
      if (el.resetConfirmPasswordInput) el.resetConfirmPasswordInput.value = "";
      setAuthTab("login");
      setAuthFeedback("Mot de passe réinitialisé. Connecte-toi avec le nouveau.", "success");
      showToast("Mot de passe réinitialisé");
    } catch (error) {
      setAuthFeedback(String(error.message || error), "error");
    } finally {
      el.resetSubmitBtn.disabled = false;
    }
  }

  async function logoutSubmit() {
    try {
      if (state.auth.token) {
        await api("POST", "/api/auth/logout", {});
      }
    } catch (_) {
      // Best effort logout.
    }
    forceLogoutUi("Déconnecté.");
    showToast("Session fermée");
  }

  async function saveProfile() {
    const displayName = (el.profileDisplayNameInput?.value || "").trim();
    const djName = (el.profileDjNameInput?.value || "").trim();
    if (!displayName) {
      showToast("Display name requis");
      return;
    }
    try {
      const payload = await api("PUT", "/api/auth/profile", {
        display_name: displayName,
        dj_name: djName,
        preferences: state.auth.user?.preferences || {},
      });
      setCurrentUser(payload.user || null);
      await refreshAccountDashboard();
      showToast("Profil mis à jour");
    } catch (error) {
      showToast(`Erreur profil: ${String(error.message || error)}`);
    }
  }

  async function changePassword() {
    if (isPasswordlessMode()) {
      showToast("Mode sans mot de passe actif: modification mot de passe désactivée");
      return;
    }
    const currentPassword = el.passwordCurrentInput?.value || "";
    const newPassword = el.passwordNewInput?.value || "";
    const confirmPassword = el.passwordConfirmInput?.value || "";
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast("Complète tous les champs mot de passe");
      return;
    }
    if (newPassword.length < 8) {
      showToast("Nouveau mot de passe trop court");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("Confirmation mot de passe invalide");
      return;
    }
    try {
      await api("POST", "/api/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      resetSensitiveInputs();
      showToast("Mot de passe modifié");
    } catch (error) {
      showToast(`Erreur mot de passe: ${String(error.message || error)}`);
    }
  }

  function renderAdminUsers() {
    if (!el.adminUsersTableBody) return;
    const rows = state.auth.users || [];
    if (!rows.length) {
      el.adminUsersTableBody.innerHTML = `<tr><td colspan="7" style="color:var(--text-secondary);">Aucun utilisateur.</td></tr>`;
      return;
    }
    el.adminUsersTableBody.innerHTML = rows
      .map((user) => {
        const roleOptions = ["dj", "admin"]
          .map((role) => `<option value="${esc(role)}" ${role === user.role ? "selected" : ""}>${esc(role)}</option>`)
          .join("");
        const statusOptions = ["active", "disabled"]
          .map((status) => `<option value="${esc(status)}" ${status === user.status ? "selected" : ""}>${esc(status)}</option>`)
          .join("");
        return `
          <tr data-admin-user-id="${Number(user.id) || 0}">
            <td>${Number(user.id) || 0}</td>
            <td>${esc(user.email)}</td>
            <td>${esc(user.display_name || "-")}</td>
            <td>${esc(user.dj_name || "-")}</td>
            <td><select data-field="role">${roleOptions}</select></td>
            <td><select data-field="status">${statusOptions}</select></td>
            <td><button class="btn ghost" data-admin-save type="button">Save</button></td>
          </tr>
        `;
      })
      .join("");
  }

  async function refreshAdminUsers() {
    if (state.auth.user?.role !== "admin") return;
    try {
      const payload = await api("GET", "/api/auth/users?limit=250");
      state.auth.users = payload.users || [];
      renderAdminUsers();
    } catch (error) {
      showToast(`Admin users error: ${String(error.message || error)}`);
    }
  }

  async function saveAdminUser(row) {
    const userId = Number(row?.getAttribute("data-admin-user-id") || 0);
    if (!userId) return;
    const role = row.querySelector('select[data-field="role"]')?.value || "dj";
    const status = row.querySelector('select[data-field="status"]')?.value || "active";
    try {
      await api("PATCH", `/api/auth/users/${userId}`, { role, status });
      showToast(`User #${userId} mis à jour`);
      await refreshAdminUsers();
    } catch (error) {
      showToast(`Admin update error: ${String(error.message || error)}`);
    }
  }

  function stopPollers() {
    clearInterval(state.poller);
    clearInterval(state.recommendationsPoller);
    state.poller = null;
    state.recommendationsPoller = null;
  }

  function startPollers() {
    stopPollers();
    state.poller = setInterval(async () => {
      await refreshSerato();
      await refreshLiveCoach();
      await refreshHistory();
      if (state.activeScreen === "account") {
        await refreshAccountDashboard();
      }
    }, 1300);
    state.recommendationsPoller = setInterval(async () => {
      await refreshRecommendations();
    }, 4200);
  }

  function navigateTo(screenId) {
    if (state.auth.locked) return;
    state.activeScreen = screenId;
    el.screens.forEach((screen) => screen.classList.toggle("active", screen.id === screenId));
    el.navItems.forEach((item) => item.classList.toggle("active", item.dataset.screen === screenId));
    el.sidebar.classList.remove("open");
    if (screenId === "account") {
      setCurrentUser(state.auth.user);
      refreshAdminUsers();
      refreshAccountDashboard();
    }
  }

  function toggleLive(force) {
    if (state.auth.locked) return;
    state.liveMode = typeof force === "boolean" ? force : !state.liveMode;
    document.body.classList.toggle("live-mode", state.liveMode);
    el.liveToggle.classList.toggle("active", state.liveMode);
    if (el.liveToggleSwitch) el.liveToggleSwitch.checked = state.liveMode;
    el.liveOverlay.classList.toggle("active", state.liveMode);
    if (state.liveMode) renderLiveOverlay();
  }

  function setSearchTab(tab) {
    state.searchTab = tab;
    el.searchTabs.forEach((button) => button.classList.toggle("active", button.dataset.searchTab === tab));
    el.libraryLocalPane.classList.toggle("hidden", tab !== "local");
    el.libraryGlobalPane.classList.toggle("hidden", tab !== "global");
    el.libraryMatchesPane.classList.toggle("hidden", tab !== "matches");
  }

  function ensureSelectOptions() {
    const options = state.tracks
      .map((track) => `<option value="${Number(track.id) || 0}">${esc(track.title)} - ${esc(track.artist)}</option>`)
      .join("");
    el.trackASelect.innerHTML = options;
    el.trackBSelect.innerHTML = options;
    el.analysisTrackSelect.innerHTML = options;

    const deckAId = state.serato.deckA?.track_id;
    const deckBId = state.serato.deckB?.track_id;

    if (deckAId && getTrackById(deckAId)) {
      el.trackASelect.value = String(deckAId);
      el.analysisTrackSelect.value = String(deckAId);
    } else if (state.tracks[0]) {
      el.trackASelect.value = String(state.tracks[0].id);
      el.analysisTrackSelect.value = String(state.tracks[0].id);
    }

    if (deckBId && getTrackById(deckBId) && deckBId !== Number(el.trackASelect.value)) {
      el.trackBSelect.value = String(deckBId);
    } else {
      const fallback = state.tracks.find((track) => track.id !== Number(el.trackASelect.value));
      if (fallback) el.trackBSelect.value = String(fallback.id);
    }
  }

  async function loadTracks() {
    const payload = await api("GET", "/api/library/tracks?limit=1000");
    state.tracks = payload.tracks || [];
    state.tracksById = new Map(state.tracks.map((track) => [track.id, track]));
    ensureSelectOptions();
  }

  async function runUnifiedSearch() {
    const query = (el.searchInput.value || "").trim();

    if (!query) {
      state.localSearchResults = state.tracks.slice(0, 120);
      state.globalSearchResults = [];
      renderLibraryLocal();
      renderLibraryGlobal();
      if (state.searchTab !== "local") setSearchTab("local");
      return;
    }

    try {
      const payload = await api("GET", `/api/search/unified?q=${encodeURIComponent(query)}&limit=40`);
      state.localSearchResults = payload.local || [];
      state.globalSearchResults = payload.global || [];
      renderLibraryLocal();
      renderLibraryGlobal();
      renderMatchesPane();
    } catch (error) {
      console.error(error);
      showToast("Search failed");
    }
  }

  function renderLibraryLocal() {
    const source = state.localSearchResults.length ? state.localSearchResults : state.tracks.slice(0, 120);
    const rows = source.filter(trackPassesFilters);
    if (!rows.length) {
      el.trackResults.innerHTML = `<article class="track-card">No local tracks found. Scan your audio folder first.</article>`;
      return;
    }

    el.trackResults.innerHTML = rows
      .map(
        (track) => `
      <article class="track-card" data-local-track-id="${track.id}">
        <div style="font-size:1.02rem; font-weight:760;">${esc(track.title)}</div>
        <div style="color:var(--text-secondary); margin-top:4px;">${esc(track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip">${esc(track.genre)}</span>
          <span class="chip">${Number(track.bpm).toFixed(2)} BPM</span>
          <span class="chip">${esc(track.camelot_key || track.musical_key || "-")}</span>
          <span class="chip">${Number(track.note).toFixed(1)}/10</span>
        </div>
        <div style="font-size:0.77rem; color:var(--text-secondary); margin-top:8px;">${esc((track.tags || []).join(" • "))}</div>
        <div class="compat-badge ${compatClass(track.note * 10)}">Analysis confidence ${((track.features?.analysis_confidence || 0) * 100).toFixed(0)}%</div>
        <div class="track-reveal">Open full Track DNA, best mix-in/mix-out and transition usage profile.</div>
      </article>
    `
      )
      .join("");
  }

  function renderLibraryGlobal() {
    const rows = state.globalSearchResults.filter(trackPassesFilters);
    if (!rows.length) {
      el.globalResults.innerHTML = `<article class="track-card">No external results yet. Try a query like "Anyma Syren".</article>`;
      return;
    }

    el.globalResults.innerHTML = rows
      .map(
        (track) => `
      <article class="track-card" data-external-track-id="${track.id}">
        <div style="font-size:1.02rem; font-weight:760;">${esc(track.title)}</div>
        <div style="color:var(--text-secondary); margin-top:4px;">${esc(track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip">${esc(track.genre || "unknown")}</span>
          <span class="chip">${track.bpm ? `${Number(track.bpm).toFixed(2)} BPM` : "BPM est."}</span>
          <span class="chip">${esc(track.camelot_key || track.musical_key || "Key est.")}</span>
          <span class="chip">${track.note ? `${Number(track.note).toFixed(1)}/10` : "Note est."}</span>
        </div>
        <div style="font-size:0.77rem; color:var(--text-secondary); margin-top:8px;">source: ${esc(track.source)}</div>
        <div class="compat-badge ${compatClass(Number(track.current_track_compatibility || 0))}">
          ${track.current_track_compatibility ? `${Number(track.current_track_compatibility).toFixed(1)}% with current track` : "No current-track match yet"}
        </div>
        <div class="track-reveal">Click to open external intelligence sheet + local library compatibility map.</div>
      </article>
    `
      )
      .join("");
  }

  function renderMatchesPane() {
    const rows = (state.selectedExternalMatches || []).filter((row) => trackPassesFilters(row.track));
    if (!rows.length) {
      el.matchesResults.innerHTML = `<article class="track-card">Select an external track to compute local matches.</article>`;
      return;
    }

    el.matchesResults.innerHTML = rows
      .map(
        (row) => `
      <article class="track-card">
        <div style="font-size:1.02rem; font-weight:760;">${esc(row.track.title)}</div>
        <div style="color:var(--text-secondary); margin-top:4px;">${esc(row.track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip">${Number(row.track.bpm).toFixed(2)} BPM</span>
          <span class="chip">${esc(row.track.camelot_key || row.track.musical_key || "-")}</span>
        </div>
        <div class="compat-badge ${compatClass(row.compatibility)}">${row.compatibility}% • ${row.difficulty}</div>
        <div class="track-reveal">Transition hint: start ${formatTime(row.analysis.mixPoints.startB)} • mix ${formatTime(row.analysis.mixPoints.mixPoint)}.</div>
      </article>
    `
      )
      .join("");
  }

  async function openExternalDetail(externalId, deep = true) {
    try {
      el.externalDetailCard.classList.remove("hidden");
      el.externalDetailBody.innerHTML = typingIndicatorMarkup("Maya is analyzing external track...");
      el.externalDetailHints.innerHTML = "";
      const detail = await api("GET", `/api/external/${externalId}?deep=${deep ? "true" : "false"}&matches_limit=6`);
      state.selectedExternalDetail = detail;
      state.selectedExternalMatches = detail.libraryMatches || [];

      const external = detail.external;
      const compatibility = detail.currentCompatibility;
      const mood = (external.mood_tags || []).join(" • ");
      const tags = (external.tags || []).join(" • ");
      const structure = `intro / build / break / drop / outro`;

      el.externalDetailBody.innerHTML = `
        <div style="font-size:1.2rem; font-weight:800; margin-bottom:6px;">${esc(external.title)}</div>
        <div style="color:var(--text-secondary); margin-bottom:8px;">${esc(external.artist)}${external.version ? ` • ${esc(external.version)}` : ""}</div>
        <div class="row">
          <span class="chip">${external.bpm ? `${Number(external.bpm).toFixed(2)} BPM` : "BPM est."}</span>
          <span class="chip">${esc(external.camelot_key || external.musical_key || "Key est.")}</span>
          <span class="chip">${external.note ? `${Number(external.note).toFixed(1)}/10` : "Note est."}</span>
          <span class="chip">${esc(external.genre || "unknown")}</span>
        </div>
        <div class="coach-list" style="margin-top:10px;">
          <div class="coach-tip"><strong>Mood:</strong> ${esc(mood || "estimated")}</div>
          <div class="coach-tip"><strong>Structure:</strong> ${esc(structure)}</div>
          <div class="coach-tip"><strong>Tags:</strong> ${esc(tags || "none")}</div>
          <div class="coach-tip"><strong>Current track compatibility:</strong> ${compatibility ? `${compatibility.compatibility}%` : "not available"}</div>
          ${compatibility ? `<div class="coach-tip"><strong>Suggested transition:</strong> start ${formatTime(compatibility.mixPoints.startB)} • mix ${formatTime(compatibility.mixPoints.mixPoint)} • drop ${formatTime(compatibility.mixPoints.dropAlign)}</div>` : ""}
        </div>
      `;

      el.externalDetailHints.innerHTML = (detail.libraryMatches || [])
        .slice(0, 4)
        .map(
          (row) => `<div class="coach-tip">Best local match: ${esc(row.track.artist)} - ${esc(row.track.title)} (${row.compatibility}%)</div>`
        )
        .join("");

      el.externalDetailCard.classList.remove("hidden");
      renderMatchesPane();
    } catch (error) {
      console.error(error);
      showToast("Cannot open external track details");
    }
  }

  async function saveExternalTo(listName) {
    const detail = state.selectedExternalDetail;
    if (!detail?.external?.id) {
      showToast("Open an external track first.");
      return;
    }
    try {
      await api("POST", `/api/external/${detail.external.id}/save`, { list_name: listName, action: "save", note: "" });
      showToast(`Saved to ${listName}`);
      await refreshHistory();
      await refreshAccountDashboard();
    } catch (error) {
      console.error(error);
      showToast("Save failed");
    }
  }

  async function testExternalWithLibrary() {
    const detail = state.selectedExternalDetail;
    if (!detail?.external?.id) {
      showToast("Open an external track first.");
      return;
    }
    try {
      const payload = await api("GET", `/api/external/${detail.external.id}/matches?limit=12`);
      state.selectedExternalMatches = payload.matches || [];
      renderMatchesPane();
      setSearchTab("matches");
      showToast("Library matching ready");
    } catch (error) {
      console.error(error);
      showToast("Matching failed");
    }
  }

  async function findSimilarExternal() {
    const detail = state.selectedExternalDetail;
    if (!detail?.external?.id) {
      showToast("Open an external track first.");
      return;
    }

    try {
      const payload = await api("GET", `/api/external/${detail.external.id}/similar?limit=12`);
      state.globalSearchResults = payload.similar || [];
      renderLibraryGlobal();
      setSearchTab("global");
      showToast("Similar tracks loaded");
    } catch (error) {
      console.error(error);
      showToast("Similar search failed");
    }
  }

  function renderTransitionResult(data) {
    if (!data) {
      el.transitionResult.innerHTML = `<div style="color:var(--text-secondary)">Select two analyzed tracks and click ANALYZE.</div>`;
      return;
    }

    const result = data.analysis;
    const trackA = data.trackA;
    const trackB = data.trackB;
    const bars = ["bpm", "key", "energy", "timbre"]
      .map(
        (key) => `
      <div class="mini-meter">
        <div style="font-size:0.78rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em;">${key}</div>
        <strong style="font-size:1rem;">${result.breakdown[key]}%</strong>
        <div class="meter-track"><div class="meter-value" style="width:${result.breakdown[key]}%"></div></div>
      </div>`
      )
      .join("");

    el.transitionResult.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:5px;">${trackLabel(trackA)} -> ${trackLabel(trackB)}</div>
          <div class="score-big">${result.compatibility}%</div>
          <div class="compat-badge ${compatClass(result.compatibility)}" style="margin-top:8px;">${result.difficulty.toUpperCase()}</div>
        </div>
        <div style="text-align:right; color:var(--text-secondary); font-size:0.9rem;">
          <div>Start B: <strong>${formatTime(result.mixPoints.startB)}</strong></div>
          <div>Mix Point: <strong>${formatTime(result.mixPoints.mixPoint)}</strong></div>
          <div>Drop Align: <strong>${formatTime(result.mixPoints.dropAlign)}</strong></div>
        </div>
      </div>
      <div class="breakdown">${bars}</div>
      <div class="coach-list">${result.coach.map((tip) => `<div class="coach-tip">${esc(tip)}</div>`).join("")}</div>
      <div class="coach-tip" style="margin-top:8px;">AI runtime: local ${esc(result.ai.localModel)}${result.ai.openaiUsed ? " + OpenAI" : ""}</div>
    `;
  }

  async function analyzeTransition() {
    const trackAId = Number(el.trackASelect.value);
    const trackBId = Number(el.trackBSelect.value);
    if (!trackAId || !trackBId || trackAId === trackBId) {
      showToast("Track A and Track B must be different.");
      return;
    }

    try {
      el.transitionResult.innerHTML = `<div class="coach-list"><div class="coach-tip">${typingIndicatorMarkup("Maya is analyzing transitions...")}</div></div>`;
      const data = await api("POST", "/api/transition/analyze", { track_a_id: trackAId, track_b_id: trackBId });
      state.activeTransition = data;
      renderTransitionResult(data);
      await refreshHistory();
      await refreshAccountDashboard();
      await refreshRecommendations();
      await refreshLiveCoach();
      renderLiveOverlay();
    } catch (error) {
      console.error(error);
      showToast("Transition analysis failed");
    }
  }

  function renderAnalysis() {
    const track = getTrackById(el.analysisTrackSelect.value) || state.tracks[0] || null;
    if (!track) {
      el.analysisKpis.innerHTML = "";
      el.analysisDna.innerHTML = `<div class="analysis-item"><span style="color:var(--text-secondary)">No track analyzed yet</span><strong>-</strong></div>`;
      el.analysisOutlook.innerHTML = "";
      el.analysisMixHints.innerHTML = "";
      return;
    }

    const features = track.features || {};
    const kpis = [
      ["BPM", Number(track.bpm).toFixed(2)],
      ["Key", track.camelot_key || track.musical_key || "-"],
      ["Note", `${Number(track.note).toFixed(1)}/10`, true],
      ["Duration", formatTime(track.duration)],
      ["Confidence", `${((features.analysis_confidence || 0) * 100).toFixed(0)}%`],
      ["Dance", `${(features.danceability || 0).toFixed(1)}/10`],
    ];

    el.analysisKpis.innerHTML = kpis
      .map(
        ([label, value, special]) => `
      <div class="kpi-tile">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value ${special ? "note" : ""}">${esc(value)}</div>
      </div>
    `
      )
      .join("");

    const dnaRows = [
      ["Genre", track.genre || "unknown"],
      ["Tags", (track.tags || []).join(" • ") || "none"],
      ["Key", track.camelot_key || track.musical_key || "-"],
    ];

    const meterRows = [
      ["Bass", features.bass || 0],
      ["Melody", features.melodic || 0],
      ["Percussion", features.percussion || 0],
      ["Brightness", features.brightness || 0],
      ["Groove", features.groove || 0],
      ["Danceability", features.danceability || 0],
    ];

    const dnaInfo = dnaRows
      .map(
        ([label, value]) => `
      <div class="analysis-item">
        <span style="color:var(--text-secondary)">${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `
      )
      .join("");

    const dnaMeters = meterRows
      .map(
        ([label, raw]) => {
          const score = clamp(Number(raw) || 0, 0, 10);
          return `
        <div class="analysis-meter-row">
          <span>${label}</span>
          <div class="analysis-meter-track"><div class="analysis-meter-fill" style="width:${score * 10}%"></div></div>
          <strong>${score.toFixed(1)}</strong>
        </div>
      `;
        }
      )
      .join("");

    el.analysisDna.innerHTML = `${dnaInfo}<div style="margin-top:8px;">${dnaMeters}</div>`;

    const energyPercent = clamp(Math.round((Number(track.energy) || 0) * 10), 0, 100);
    if (el.analysisEnergyRing && el.analysisEnergyRingValue) {
      el.analysisEnergyRing.style.setProperty("--energy-value", String(energyPercent));
      el.analysisEnergyRingValue.innerHTML = `${energyPercent}%<br><small style="font-size:0.68rem; color:var(--text-secondary);">ENERGY</small>`;
    }

    const fallbackRecs = state.recommendations.slice(0, 3);
    el.analysisOutlook.innerHTML = fallbackRecs.length
      ? fallbackRecs
          .map(
            (item) => `
      <div class="history-row">
        <div>
          <div style="font-weight:700; color:var(--text-primary)">${esc(item.track.title)}</div>
          <div style="font-size:0.8rem;">${esc(item.track.artist)} • ${Number(item.track.bpm).toFixed(2)} BPM • ${esc(item.track.camelot_key || item.track.musical_key || "-")}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800; color:var(--accent-main)">${item.compatibility}%</div>
          <div style="font-size:0.8rem;">${esc(item.difficulty)}</div>
        </div>
      </div>
    `
          )
          .join("")
      : `<div class="history-row"><span>No recommendation yet.</span><small>-</small></div>`;

    const phrase16 = Math.max(8, Math.round((16 * 60) / Math.max(1, Number(track.bpm))));
    const phrase32 = Math.max(12, Math.round((32 * 60) / Math.max(1, Number(track.bpm))));
    const hints = [
      `16 bars at ${formatTime(phrase16)}, 32 bars at ${formatTime(phrase32)} for phrase lock.`,
      `Harmonic lane: use ${track.camelot_key || track.musical_key} as anchor before switching deck.`,
      `${Number(track.energy) >= 8 ? "Peak-time" : Number(track.energy) >= 7 ? "Main-room" : "Warm-up"} energy profile detected by local AI model.`,
      `Sub ${(features.bass || 0).toFixed(1)}/10, melodic ${(features.melodic || 0).toFixed(1)}/10, percussion ${(features.percussion || 0).toFixed(1)}/10.`,
    ];

    el.analysisMixHints.innerHTML = hints.map((tip) => `<div class="coach-tip">${esc(tip)}</div>`).join("");
  }

  function renderNowPlaying() {
    const deckA = state.serato.deckA;
    const deckB = state.serato.deckB;

    const current = currentDeckTrack(deckA) || state.tracks[0] || null;
    const next = currentDeckTrack(deckB) || state.recommendations[0]?.track || state.tracks[1] || null;

    if (!current) {
      el.nowTrackName.textContent = "No track";
      el.nowTrackArtist.textContent = "Scan your library and connect Serato bridge";
      el.nowRecommendations.innerHTML = `<div class="track-card">No recommendation yet.</div>`;
      setWaveMenuState(el.deckAWave, 0, false);
      setWaveMenuState(el.deckBWave, 0, false);
      return;
    }

    el.nowTrackName.textContent = current.title;
    el.nowTrackArtist.textContent = current.artist;
    el.nowBpm.textContent = `${Number(deckA?.bpm || current.bpm || 0).toFixed(2)} BPM`;
    el.nowKey.textContent = current.camelot_key || current.musical_key || "-";
    el.nowNote.textContent = `Note ${Number(current.note || 0).toFixed(1)}/10`;
    el.nowEnergy.textContent = `Energy ${Number(current.energy || 0).toFixed(1)}`;
    el.nowGenre.textContent = current.genre || "unknown";

    const position = Number(deckA?.position || 0);
    const duration = Number(current.duration || 0);
    const progress = duration > 0 ? (position / duration) * 100 : 0;
    el.deckProgressBar.style.width = `${clamp(progress, 0, 100)}%`;
    el.deckPosition.textContent = formatTime(position);
    el.deckRemaining.textContent = duration > 0 ? `Remaining ${formatTime(Math.max(0, duration - position))}` : "Remaining --:--";

    if (next) {
      el.nextTrackName.textContent = next.title;
      el.nextTrackArtist.textContent = next.artist;
      el.nextBpm.textContent = `${Number(next.bpm || 0).toFixed(2)} BPM`;
      el.nextKey.textContent = next.camelot_key || next.musical_key || "-";
      el.nextNote.textContent = `Note ${Number(next.note || 0).toFixed(1)}/10`;
    }

    setWaveMenuState(el.deckAWave, Number(deckA?.bpm || current.bpm || 0), true);
    setWaveMenuState(el.deckBWave, Number(deckB?.bpm || next?.bpm || 0), Boolean(next));

    const recs = state.recommendations.slice(0, 6);
    if (!recs.length) {
      el.nextCompatibility.textContent = "--%";
      el.nextCompatibilityBar.style.width = "0%";
      el.nowCoach.innerHTML = `<div class="coach-tip">Analyze a transition to unlock live suggestions.</div>`;
      el.nowRecommendations.innerHTML = `<div class="track-card">No AI recommendation yet.</div>`;
      return;
    }

    const first = recs[0];
    el.nextCompatibility.textContent = `${Number(first.compatibility).toFixed(1)}%`;
    el.nextCompatibilityBar.style.width = `${first.compatibility}%`;

    const coachLines = state.liveCoach?.analysis?.coach || state.activeTransition?.analysis?.coach || ["Runtime AI active", "Live coach uses deck position and transition windows"]; 
    el.nowCoach.innerHTML = coachLines.slice(0, 2).map((tip) => `<div class="coach-tip">${esc(tip)}</div>`).join("");

    el.nowRecommendations.innerHTML = recs
      .map(
        (item) => `
      <div class="track-card">
        <div style="font-weight:700">${esc(item.track.title)}</div>
        <div style="color:var(--text-secondary); font-size:0.84rem">${esc(item.track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip">${Number(item.track.bpm).toFixed(2)} BPM</span>
          <span class="chip">${esc(item.track.camelot_key || item.track.musical_key || "-")}</span>
          <span class="chip">${Number(item.track.note).toFixed(1)}/10</span>
          <span class="chip">${esc(item.track.genre)}</span>
        </div>
        <div class="compat-badge ${compatClass(item.compatibility)}">${item.compatibility}% • ${esc(item.difficulty)}</div>
        <div class="track-reveal">Hover to preview blend profile and click in Library for full drill-down.</div>
      </div>
    `
      )
      .join("");
  }

  function renderLiveOverlay() {
    const deckA = state.serato.deckA;
    const current = currentDeckTrack(deckA) || state.tracks[0] || null;
    if (!current) return;

    el.liveTrackName.textContent = current.title;
    el.liveBpm.textContent = `${Number(deckA?.bpm || current.bpm || 0).toFixed(2)} BPM`;
    el.liveKey.textContent = current.camelot_key || current.musical_key || "-";
    el.liveNote.textContent = `Note ${Number(current.note || 0).toFixed(1)}/10`;
    el.liveEnergy.textContent = `Energy ${Number(current.energy || 0).toFixed(1)}`;

    const coach = state.liveCoach;
    if (!coach) {
      el.liveMixWindow.textContent = "No live coach yet";
      el.liveCountdown.textContent = "Connect bridge + load deck A/B";
      el.liveAlert.textContent = "Maya suggest: prepare deck B.";
      el.liveAlert.classList.remove("show");
      el.liveCoachList.innerHTML = "";
      el.liveSuggestions.innerHTML = "";
      return;
    }

    const mix = coach.analysis?.mixPoints || {};
    el.liveMixWindow.textContent = `${formatTime(mix.startB || 0)} -> ${formatTime(mix.mixPoint || 0)}`;
    el.liveCountdown.textContent = coach.message || "Live coach active";
    el.liveAlert.textContent = `Maya suggests: ${coach.message || "Monitor transition timing."}`;
    el.liveAlert.classList.add("show");

    const coachRows = [
      `Action: ${coach.action}`,
      ...(coach.analysis?.coach || []).slice(0, 3),
    ];
    el.liveCoachList.innerHTML = coachRows.map((line) => `<div class="live-next-row"><span>${esc(line)}</span></div>`).join("");

    el.liveSuggestions.innerHTML = state.recommendations
      .slice(0, 4)
      .map(
        (item) => `
      <div class="live-next-row">
        <div>
          <strong>${esc(item.track.title)}</strong>
          <span>${esc(item.track.artist)} • ${Number(item.track.bpm).toFixed(2)} BPM • ${esc(item.track.camelot_key || item.track.musical_key || "-")}</span>
        </div>
        <div style="text-align:right;">
          <strong>${item.compatibility}%</strong>
          <span>${esc(item.difficulty)}</span>
        </div>
      </div>
    `
      )
      .join("");
  }

  function renderHistory() {
    el.historyAvg.textContent = `${Number(state.history.averageCompatibility || 0).toFixed(1)}%`;
    el.historyTransitions.textContent = String(state.history.transitionsCount || 0);
    el.historySwitches.textContent = String(state.history.playsCount || 0);

    const events = state.history.events || [];
    el.historyEvents.innerHTML = events.length
      ? events
          .map(
            (event) => `
      <div class="history-row">
        <span>${esc(event.event_type)}</span>
        <small>${new Date(event.created_at).toLocaleTimeString()}</small>
      </div>
    `
          )
          .join("")
      : `<div class="history-row"><span>No events yet.</span><small>-</small></div>`;

    const session = state.activeSession;
    if (!session) {
      el.sessionStatusDetail.textContent = `Session inactive. External saves: ${state.history.externalSavedCount || 0}.`;
    } else {
      el.sessionStatusDetail.textContent = `Session #${session.id} active since ${new Date(session.started_at).toLocaleTimeString()} • external saves ${state.history.externalSavedCount || 0}.`;
    }
  }

  function renderProfileStack(node, rows, formatter) {
    if (!node) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      node.innerHTML = `<div class="profile-stack-item"><span>Aucun élément pour le moment.</span></div>`;
      return;
    }
    node.innerHTML = list.map((row, index) => formatter(row, index)).join("");
  }

  function renderAccountDashboard() {
    const data = state.accountDashboard;
    if (!data) return;

    const active = Boolean(data.session?.active);
    if (el.profileSessionStatus) {
      el.profileSessionStatus.textContent = active ? "Active" : "Inactive";
      el.profileSessionStatus.classList.toggle("note", active);
    }
    if (el.profileSessionTime) {
      const elapsed = Number(data.session?.elapsedSeconds || 0);
      el.profileSessionTime.textContent = formatHms(elapsed);
    }
    if (el.profileCloudStatus) {
      const cloudOk = Boolean(data.cloud?.dbExists);
      el.profileCloudStatus.textContent = cloudOk ? "Ready" : "Offline";
      el.profileCloudStatus.classList.toggle("note", cloudOk);
    }

    const tips = Array.isArray(data.aiTips) ? data.aiTips : [];
    if (el.profileAiTipsCount) el.profileAiTipsCount.textContent = String(tips.length);
    if (el.profileAiTips) {
      el.profileAiTips.innerHTML = tips.length
        ? tips.map((tip) => `<div class="coach-tip">${esc(tip)}</div>`).join("")
        : `<div class="coach-tip">Aucun conseil IA disponible.</div>`;
    }

    renderProfileStack(el.profileTopTracks, data.topTracks || [], (row) => `
      <div class="profile-stack-item">
        <strong>${esc(row.artist || "Unknown")} - ${esc(row.title || "Unknown")}</strong>
        <span>${Number(row.play_count || 0)} plays • ${Number(row.bpm || 0).toFixed(2)} BPM • ${esc(row.camelot_key || "-")}</span>
      </div>
    `);

    renderProfileStack(el.profileWishlist, data.favorites?.wishlist || [], (row) => `
      <div class="profile-stack-item">
        <strong>${esc(row.artist || "Unknown")} - ${esc(row.title || "Unknown")}</strong>
        <span>${esc(row.list_name || "wishlist")} • ${Number(row.bpm || 0).toFixed(2)} BPM • ${esc(row.camelot_key || "-")}</span>
      </div>
    `);

    renderProfileStack(el.profilePrepCrate, data.favorites?.prepCrate || [], (row) => `
      <div class="profile-stack-item">
        <strong>${esc(row.artist || "Unknown")} - ${esc(row.title || "Unknown")}</strong>
        <span>${esc(row.list_name || "prep_crate")} • ${Number(row.note || 0).toFixed(1)}/10 • ${esc(row.genre || "unknown")}</span>
      </div>
    `);
  }

  function updateTopStatus() {
    const bridgeMap = {
      connected: ["connected", `mode ${state.serato.mode}${state.serato.lastSeen ? ` • last seen ${new Date(state.serato.lastSeen).toLocaleTimeString()}` : ""}`],
      connecting: ["disconnected", "connecting"],
      disconnected: ["disconnected", "disconnected"],
      error: ["error", `error ${state.serato.lastError || "unknown"}`],
    };
    const bridgeStatus = bridgeMap[state.serato.status] || ["disconnected", state.serato.status];
    setStatusPill(el.bridgeStatus, el.bridgeStatusText, bridgeStatus[0], "Serato", bridgeStatus[1]);

    const aiText = `local ${state.ai.localModelActive ? "active" : "off"} • openai ${state.ai.openaiEnabled ? (state.ai.openaiConnected ? "connected" : "configured") : "off"}`;
    const aiStatus = state.ai.openaiEnabled ? (state.ai.openaiConnected ? "connected" : "disconnected") : "connected";
    setStatusPill(el.socketStatus, el.socketStatusText, aiStatus, "AI", aiText);

    const wsLine = `Bridge mode: ${state.serato.mode}. Status: ${state.serato.status}${state.serato.lastError ? ` (${state.serato.lastError})` : ""}`;
    el.wsStatusDetail.textContent = wsLine;
  }

  async function refreshRecommendations() {
    const deckAId = state.serato.deckA?.track_id || Number(el.trackASelect.value);
    if (!deckAId) {
      state.recommendations = [];
      renderNowPlaying();
      return;
    }

    try {
      const payload = await api("GET", `/api/recommendations/${deckAId}?limit=8`);
      state.recommendations = payload.recommendations || [];
    } catch (error) {
      console.error(error);
      state.recommendations = [];
    }

    renderNowPlaying();
    renderAnalysis();
    renderLiveOverlay();
  }

  async function refreshSerato() {
    try {
      state.serato = await api("GET", "/api/serato/status");
      renderNowPlaying();
      renderLiveOverlay();
      updateTopStatus();
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshLiveCoach() {
    try {
      state.liveCoach = await api("GET", "/api/live/coach");
    } catch (_) {
      state.liveCoach = null;
    }
    renderLiveOverlay();
  }

  async function refreshHistory() {
    try {
      state.history = await api("GET", "/api/history/summary");
      const session = await api("GET", "/api/sessions/current");
      state.activeSession = session.session;
      renderHistory();
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshAccountDashboard() {
    try {
      state.accountDashboard = await api("GET", "/api/account/dashboard");
      renderAccountDashboard();
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshAiStatus() {
    try {
      state.ai = await api("GET", "/api/ai/status");
      updateTopStatus();
    } catch (error) {
      console.error(error);
    }
  }

  async function scanLibrary() {
    const path = (el.libraryPathInput.value || "").trim();
    if (!path) {
      showToast("Enter a library path first.");
      return;
    }

    el.scanStatus.innerHTML = `${typingIndicatorMarkup("Maya is scanning and analyzing tracks...")}`;
    try {
      const start = await api("POST", "/api/library/scan", { path, recursive: true, limit: 0 });
      const jobId = start?.job?.id;
      if (!jobId) throw new Error("Scan job creation failed");

      let finalJob = null;
      const timeoutAt = Date.now() + 1000 * 60 * 30;
      while (Date.now() < timeoutAt) {
        const payload = await api("GET", `/api/library/scan/jobs/${encodeURIComponent(jobId)}`);
        const job = payload?.job;
        if (!job) throw new Error("Scan job not found");
        const progress = job.candidates
          ? `${job.processed}/${job.candidates}`
          : `${job.processed || 0}`;
        el.scanStatus.textContent = `Scan ${job.status}: ${progress} files • analyzed ${job.analyzed || 0} • errors ${job.errors_count || 0}${job.truncated ? " • truncated by safety limit" : ""}`;
        if (job.status === "completed") {
          finalJob = job;
          break;
        }
        if (job.status === "failed") {
          throw new Error(job.message || "Scan failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!finalJob) throw new Error("Scan timeout");

      await loadTracks();
      await runUnifiedSearch();
      await refreshRecommendations();
      await refreshHistory();
      await refreshAccountDashboard();
      showToast("Library scan finished.");
    } catch (error) {
      console.error(error);
      el.scanStatus.textContent = `Scan failed: ${String(error)}`;
      showToast("Scan failed");
    }
  }

  async function syncAppleCatalog() {
    if (el.appleSyncBtn) el.appleSyncBtn.disabled = true;
    try {
      const payload = await api("POST", "/api/library/apple/sync?seeds_limit=12&per_query_limit=4", {});
      state.lastAppleSyncAt = new Date().toISOString();
      setAppleSyncTimestamp(state.lastAppleSyncAt);
      const discovered = Number(payload?.uniqueExternalTracks || payload?.discovered || 0);
      el.scanStatus.textContent = `Apple catalog sync done: ${discovered} external tracks updated.`;
      await runUnifiedSearch();
      await refreshHistory();
      await refreshAccountDashboard();
      showToast(`Apple catalog synced (${discovered})`);
    } catch (error) {
      showToast(`Apple sync failed: ${String(error.message || error)}`);
    } finally {
      if (el.appleSyncBtn) el.appleSyncBtn.disabled = false;
    }
  }

  async function maybeAutoSyncAppleCatalog() {
    const last = getAppleSyncTimestamp();
    if (last) {
      const lastMs = Date.parse(last);
      if (Number.isFinite(lastMs)) {
        const ageMs = Date.now() - lastMs;
        if (ageMs < 30 * 60 * 1000) return;
      }
    }
    await syncAppleCatalog();
  }

  async function connectBridge() {
    const payload = {
      mode: el.seratoModeSelect.value,
      ws_url: (el.wsUrlInput.value || "").trim(),
      history_path: (el.historyPathInput.value || "").trim(),
      feed_path: (el.feedPathInput.value || "").trim(),
    };

    try {
      state.serato = await api("POST", "/api/serato/connect", payload);
      updateTopStatus();
      showToast(`Bridge connecting (${payload.mode})`);
      await refreshSerato();
      await refreshLiveCoach();
      await refreshRecommendations();
      await refreshHistory();
      await refreshAccountDashboard();
    } catch (error) {
      console.error(error);
      showToast("Bridge connection failed");
    }
  }

  async function disconnectBridge() {
    try {
      state.serato = await api("POST", "/api/serato/disconnect", {});
      state.liveCoach = null;
      updateTopStatus();
      renderLiveOverlay();
      await refreshHistory();
      await refreshAccountDashboard();
      showToast("Bridge disconnected");
    } catch (error) {
      console.error(error);
    }
  }

  async function startSession() {
    try {
      state.activeSession = await api("POST", "/api/sessions/start", { name: "Maya Hive Live", profile_id: null });
      renderHistory();
      await refreshAccountDashboard();
      showToast(`Session #${state.activeSession.id} started`);
    } catch (error) {
      console.error(error);
      showToast("Cannot start session");
    }
  }

  async function endSession() {
    try {
      const done = await api("POST", "/api/sessions/end", {});
      state.activeSession = null;
      renderHistory();
      await refreshAccountDashboard();
      showToast(`Session #${done.id} ended`);
    } catch (_) {
      showToast("No active session");
    }
  }

  async function exportCurrent(format) {
    const path = format === "json" ? "/api/export/current.json" : "/api/export/current.csv";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = runtimeConfig.apiBase ? `${runtimeConfig.apiBase}${normalizedPath}` : normalizedPath;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: state.auth.token ? { Authorization: `Bearer ${state.auth.token}` } : {},
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(safeDetail(text) || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const extension = format === "json" ? "json" : "csv";
      const fileName = `maya-session-current.${extension}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      showToast(`Export ${extension.toUpperCase()} prêt`);
    } catch (error) {
      showToast(`Export failed: ${String(error.message || error)}`);
    }
  }

  function bindLibraryDelegates() {
    el.trackResults.addEventListener("click", (event) => {
      const card = event.target.closest("[data-local-track-id]");
      if (!card) return;
      const id = card.getAttribute("data-local-track-id");
      if (!id) return;
      el.analysisTrackSelect.value = id;
      renderAnalysis();
      navigateTo("analysis");
    });

    el.globalResults.addEventListener("click", (event) => {
      const card = event.target.closest("[data-external-track-id]");
      if (!card) return;
      const id = card.getAttribute("data-external-track-id");
      if (!id) return;
      openExternalDetail(Number(id), true);
    });
  }

  function bindEvents() {
    el.navItems.forEach((item) => item.addEventListener("click", () => navigateTo(item.dataset.screen)));

    el.mobileMenuBtn.addEventListener("click", () => el.sidebar.classList.toggle("open"));

    document.addEventListener("click", (event) => {
      if (window.innerWidth > 860) return;
      if (!el.sidebar.contains(event.target) && event.target !== el.mobileMenuBtn) {
        el.sidebar.classList.remove("open");
      }
    });

    el.liveToggle.addEventListener("click", () => toggleLive());
    el.liveToggleSwitch?.addEventListener("change", (event) => {
      toggleLive(Boolean(event.target?.checked));
    });

    document.addEventListener("keydown", (event) => {
      const targetTag = event.target.tagName;
      const typing = targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT";

      if (!typing && /^[1-9]$/.test(event.key)) {
        const item = el.navItems[Number(event.key) - 1];
        if (item) navigateTo(item.dataset.screen);
      }
      if (!typing && event.key.toLowerCase() === "l") toggleLive();
      if (event.key === "Escape" && state.liveMode) toggleLive(false);
    });

    el.searchTabs.forEach((button) => {
      button.addEventListener("click", () => setSearchTab(button.dataset.searchTab));
    });

    el.searchInput.addEventListener("input", () => {
      clearTimeout(state.searchDebounce);
      state.searchDebounce = setTimeout(runUnifiedSearch, 280);
    });
    el.searchSubmitBtn?.addEventListener("click", runUnifiedSearch);
    el.appleSyncBtn?.addEventListener("click", syncAppleCatalog);

    [el.bpmFilterInput, el.keyFilterInput, el.energyFilterInput].forEach((input) => {
      input.addEventListener("input", () => {
        renderLibraryLocal();
        renderLibraryGlobal();
        renderMatchesPane();
      });
    });

    document.querySelectorAll("[data-quick-search]").forEach((button) => {
      button.addEventListener("click", () => {
        el.searchInput.value = button.dataset.quickSearch || "";
        runUnifiedSearch();
      });
    });

    el.scanLibraryBtn.addEventListener("click", scanLibrary);
    el.analyzeBtn.addEventListener("click", analyzeTransition);
    el.analysisTrackSelect.addEventListener("change", renderAnalysis);

    el.trackASelect.addEventListener("change", () => {
      if (el.trackASelect.value === el.trackBSelect.value) {
        const fallback = state.tracks.find((track) => track.id !== Number(el.trackASelect.value));
        if (fallback) el.trackBSelect.value = String(fallback.id);
      }
      refreshRecommendations();
    });

    el.trackBSelect.addEventListener("change", () => {
      if (el.trackASelect.value === el.trackBSelect.value) showToast("Track B must differ from Track A");
    });

    el.wsConnectBtn.addEventListener("click", connectBridge);
    el.wsDisconnectBtn.addEventListener("click", disconnectBridge);

    el.startSessionBtn.addEventListener("click", startSession);
    el.endSessionBtn.addEventListener("click", endSession);
    el.exportJsonBtn.addEventListener("click", () => exportCurrent("json"));
    el.exportCsvBtn.addEventListener("click", () => exportCurrent("csv"));

    el.externalSaveWishlistBtn.addEventListener("click", () => saveExternalTo("wishlist"));
    el.externalSaveCrateBtn.addEventListener("click", () => saveExternalTo("prep_crate"));
    el.externalTestLibraryBtn.addEventListener("click", testExternalWithLibrary);
    el.externalFindSimilarBtn.addEventListener("click", findSimilarExternal);

    el.authLoginTab?.addEventListener("click", () => setAuthTab("login"));
    el.authRegisterTab?.addEventListener("click", () => setAuthTab("register"));
    el.apiBaseSaveBtn?.addEventListener("click", saveApiBaseConfig);
    el.apiBaseTestBtn?.addEventListener("click", testApiBaseConnection);
    el.apiBaseInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveApiBaseConfig();
      }
    });
    el.googleAuthBtn?.addEventListener("click", () => startOAuthLogin("google"));
    el.appleAuthBtn?.addEventListener("click", () => startOAuthLogin("apple"));
    el.authLoginForm?.addEventListener("submit", loginSubmit);
    el.authRegisterForm?.addEventListener("submit", registerSubmit);
    el.forgotPasswordBtn?.addEventListener("click", openForgotFlow);
    el.authForgotForm?.addEventListener("submit", forgotPasswordSubmit);
    el.openResetTokenBtn?.addEventListener("click", () => openResetFlow());
    el.forgotBackBtn?.addEventListener("click", () => setAuthTab("login"));
    el.authResetForm?.addEventListener("submit", resetPasswordSubmit);
    el.resetBackBtn?.addEventListener("click", () => setAuthTab("login"));

    el.openAccountBtn?.addEventListener("click", () => navigateTo("account"));
    el.logoutBtn?.addEventListener("click", logoutSubmit);
    el.profileSaveBtn?.addEventListener("click", saveProfile);
    el.passwordSaveBtn?.addEventListener("click", changePassword);
    el.adminRefreshUsersBtn?.addEventListener("click", refreshAdminUsers);
    el.adminUsersTableBody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-admin-save]");
      if (!button) return;
      const row = button.closest("[data-admin-user-id]");
      if (!row) return;
      saveAdminUser(row);
    });

    bindLibraryDelegates();
  }

  async function loadAuthorizedData() {
    if (!runtimeConfig.apiBase && window.location.protocol === "file:") {
      showToast("API backend non configurée.");
    }
    await refreshAiStatus();
    await loadTracks();
    state.localSearchResults = state.tracks.slice(0, 120);
    renderLibraryLocal();
    renderLibraryGlobal();
    renderMatchesPane();
    await refreshSerato();
    await refreshRecommendations();
    await refreshLiveCoach();
    await refreshHistory();
    await refreshAccountDashboard();
    renderTransitionResult(null);
    renderNowPlaying();
    renderAnalysis();
    renderLiveOverlay();
    setCurrentUser(state.auth.user);
    if (state.auth.user?.role === "admin") {
      await refreshAdminUsers();
    }
  }

  async function initialLoad() {
    bindEvents();
    bootstrapApiBaseFromUrl();
    updateApiConfigUi();
    setSearchTab("local");
    await refreshAuthSettings();
    await refreshOAuthProviders();
    setAuthTab("login");
    bootstrapOAuthFromUrl();
    bootstrapResetFromUrl();

    const authenticated = await bootstrapAuth();
    if (authenticated) {
      navigateTo("now-playing");
      try {
        await loadAuthorizedData();
        await maybeAutoSyncAppleCatalog();
        startPollers();
      } catch (error) {
        console.error(error);
        showToast("Backend unavailable. Start API server first.");
      }
    } else {
      lockAppUi(true);
      navigateTo("now-playing");
      stopPollers();
    }
  }

  initialLoad();
})();
