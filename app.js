(() => {
  const AUTH_TOKEN_KEY = "maya_mixa_auth_token";
  const API_BASE_KEY = "maya_mixa_api_base";
  const APPLE_SYNC_KEY = "maya_mixa_apple_sync_at";
  const DEFAULT_CLOUD_API_BASE = "https://maya-mixa-cloud.onrender.com";
  const BOOT_LOADER_MIN_MS = 950;
  const BOOT_LOADER_MAX_MS = 7000;
  const bootStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const runtimeConfig = (() => {
    const inlineConfig = (typeof window !== "undefined" && window.__MAYA_CONFIG__) || {};
    const electronConfig = (typeof window !== "undefined" && window.mayaConfig) || {};
    let storedApiBase = "";
    try {
      storedApiBase = String(localStorage.getItem(API_BASE_KEY) || "").trim();
    } catch (_) {
      storedApiBase = "";
    }
    const useDefaultCloudFallback = typeof window !== "undefined" && window.location?.protocol === "file:";
    const rawApiBase = String(
      electronConfig.apiBase || inlineConfig.apiBase || storedApiBase || (useDefaultCloudFallback ? DEFAULT_CLOUD_API_BASE : "")
    ).trim();
    const safeApiBase = /your-maya-mixa-api\.example\.com/i.test(rawApiBase) ? "" : rawApiBase;
    return {
      ...inlineConfig,
      ...electronConfig,
      apiBase: safeApiBase.replace(/\/+$/, ""),
    };
  })();
  const desktopSeratoApi =
    typeof window !== "undefined" && window.mayaDesktop && window.mayaDesktop.serato ? window.mayaDesktop.serato : null;

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
    globalSearchById: new Map(),
    searchEnrichmentNonce: 0,
    selectedExternalDetail: null,
    selectedExternalMatches: [],
    analysisExternalTrack: null,

    recommendations: [],
    activeTransition: null,
    liveCoach: null,
    seratoRelay: { socket: null, wsUrl: "", mode: "none", connected: false, forwarding: false },
    seratoAutoConnectAt: 0,
    seratoLibrarySyncAt: 0,
    desktopSerato: {
      available: Boolean(desktopSeratoApi),
      active: false,
      connected: false,
      mode: "idle",
      historyPath: "",
      lastPushAt: null,
      lastError: "",
    },
    transitionFilters: { a: "", b: "" },
    sessionBuilder: { selectedTrackIds: [], analyses: [] },

    serato: { status: "disconnected", deckA: null, deckB: null, mode: "none", lastSeen: null, lastError: "" },
    history: { averageCompatibility: 0, transitionsCount: 0, playsCount: 0, eventsCount: 0, events: [], externalSavedCount: 0 },
    ai: { localModelActive: true, openaiEnabled: false, openaiConnected: false, localModel: "loading", openaiMessage: "" },
    activeSession: null,
    accountDashboard: null,
    lastAppleSyncAt: null,

    poller: null,
    recommendationsPoller: null,
    desktopSeratoPoller: null,
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
    nowWaveformA: document.getElementById("nowWaveformA"),
    nowWaveformB: document.getElementById("nowWaveformB"),
    nowStructureA: document.getElementById("nowStructureA"),
    nowStructureB: document.getElementById("nowStructureB"),
    nowWaveformALabel: document.getElementById("nowWaveformALabel"),
    nowWaveformBLabel: document.getElementById("nowWaveformBLabel"),

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
    externalRemoveWishlistBtn: document.getElementById("externalRemoveWishlistBtn"),
    externalRemoveCrateBtn: document.getElementById("externalRemoveCrateBtn"),
    externalTestLibraryBtn: document.getElementById("externalTestLibraryBtn"),
    externalFindSimilarBtn: document.getElementById("externalFindSimilarBtn"),
    externalOpenAnalysisBtn: document.getElementById("externalOpenAnalysisBtn"),
    externalImportLibraryBtn: document.getElementById("externalImportLibraryBtn"),

    libraryPathInput: document.getElementById("libraryPathInput"),
    scanLibraryBtn: document.getElementById("scanLibraryBtn"),
    scanStatus: document.getElementById("scanStatus"),

    trackASelect: document.getElementById("trackASelect"),
    trackBSelect: document.getElementById("trackBSelect"),
    trackAFilterInput: document.getElementById("trackAFilterInput"),
    trackBFilterInput: document.getElementById("trackBFilterInput"),
    trackAPreview: document.getElementById("trackAPreview"),
    trackBPreview: document.getElementById("trackBPreview"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    transitionResult: document.getElementById("transitionResult"),

    analysisTrackSelect: document.getElementById("analysisTrackSelect"),
    analysisSourceTag: document.getElementById("analysisSourceTag"),
    analysisKpis: document.getElementById("analysisKpis"),
    analysisDna: document.getElementById("analysisDna"),
    analysisOutlook: document.getElementById("analysisOutlook"),
    analysisMixHints: document.getElementById("analysisMixHints"),
    analysisEnergyRing: document.getElementById("analysisEnergyRing"),
    analysisEnergyRingValue: document.getElementById("analysisEnergyRingValue"),
    analysisWaveform: document.getElementById("analysisWaveform"),
    analysisStructure: document.getElementById("analysisStructure"),
    analysisWaveformLabel: document.getElementById("analysisWaveformLabel"),

    historyAvg: document.getElementById("historyAvg"),
    historyTransitions: document.getElementById("historyTransitions"),
    historySwitches: document.getElementById("historySwitches"),
    historyEvents: document.getElementById("historyEvents"),
    sessionBuilderAvailable: document.getElementById("sessionBuilderAvailable"),
    sessionBuilderSelected: document.getElementById("sessionBuilderSelected"),
    sessionBuilderTotal: document.getElementById("sessionBuilderTotal"),
    sessionBuilderTransitions: document.getElementById("sessionBuilderTransitions"),
    sessionBuilderClearBtn: document.getElementById("sessionBuilderClearBtn"),

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
    bootLoader: document.getElementById("bootLoader"),
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

  function dismissBootLoader(force = false) {
    const node = el.bootLoader;
    if (!node || node.dataset.dismissed === "1") return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = now - bootStartedAt;
    const wait = force ? 0 : Math.max(0, BOOT_LOADER_MIN_MS - elapsed);
    clearTimeout(dismissBootLoader.timer);
    dismissBootLoader.timer = setTimeout(() => {
      node.dataset.dismissed = "1";
      node.classList.add("hide");
      setTimeout(() => {
        node.classList.remove("active");
        node.setAttribute("aria-hidden", "true");
      }, 280);
    }, wait);
  }

  function humanizeError(error, fallback = "Impossible de joindre le backend. Vérifie internet et l'URL API.") {
    const message = String(error?.message || error || "").trim();
    if (!message) return fallback;
    if (/load failed|failed to fetch|networkerror|typeerror/i.test(message)) return fallback;
    return message;
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
    const shouldShow = !hasApiBaseConfigured();
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
    setAuthFeedback("Backend API indisponible. Vérifie internet puis réessaie.", "error");
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
      el.googleAuthBtn.disabled = false;
      el.googleAuthBtn.title = apiMissing
        ? "Configure l'URL API backend d'abord"
        : google.configured
        ? "Connexion Google activée"
        : "Google OAuth non configuré côté backend";
      el.googleAuthBtn.classList.toggle("ghost", apiMissing || !google.configured);
    }
    if (el.appleAuthBtn) {
      el.appleAuthBtn.disabled = false;
      el.appleAuthBtn.title = apiMissing
        ? "Configure l'URL API backend d'abord"
        : apple.configured
        ? "Connexion Apple activée"
        : "Apple OAuth non configuré côté backend";
      el.appleAuthBtn.classList.toggle("ghost", apiMissing || !apple.configured);
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
      const message = `${provider} OAuth non configuré sur ce runtime.`;
      setAuthFeedback(message, "error");
      showToast(message);
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
      setAuthFeedback(humanizeError(error), "error");
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

  function resetRuntimeData() {
    state.tracks = [];
    state.tracksById = new Map();
    state.localSearchResults = [];
    state.globalSearchResults = [];
    state.globalSearchById = new Map();
    state.searchEnrichmentNonce = 0;
    state.selectedExternalDetail = null;
    state.selectedExternalMatches = [];
    state.analysisExternalTrack = null;
    state.recommendations = [];
    state.activeTransition = null;
    state.liveCoach = null;
    state.history = { averageCompatibility: 0, transitionsCount: 0, playsCount: 0, eventsCount: 0, events: [], externalSavedCount: 0 };
    state.activeSession = null;
    state.accountDashboard = null;
    state.sessionBuilder = { selectedTrackIds: [], analyses: [] };
    state.serato = { status: "disconnected", deckA: null, deckB: null, mode: "none", lastSeen: null, lastError: "" };
    state.seratoRelay = { socket: null, wsUrl: "", mode: "none", connected: false, forwarding: false };
    state.seratoAutoConnectAt = 0;
    state.seratoLibrarySyncAt = 0;
    state.desktopSerato = {
      ...state.desktopSerato,
      available: Boolean(desktopSeratoApi),
      active: false,
      connected: false,
      mode: "idle",
      historyPath: "",
      lastPushAt: null,
      lastError: "",
    };
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
    stopSeratoRelay();
    if (state.desktopSerato.available) void stopDesktopSeratoSync();
    resetRuntimeData();
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

  function on(node, eventName, handler) {
    if (!node) return;
    node.addEventListener(eventName, handler);
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

  function hashString32(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let v = t;
      v = Math.imul(v ^ (v >>> 15), v | 1);
      v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
  }

  function computeTrackStructure(track) {
    const duration = Math.max(120, Number(track?.duration || 360));
    const energy = clamp(Number(track?.energy || track?.note || 6), 1, 10);
    const buildBoost = clamp((energy - 5) / 8, -0.22, 0.22);
    const dropBoost = clamp((energy - 5) / 6, -0.25, 0.25);
    const base = [
      { key: "intro", label: "Intro", weight: 0.2 - buildBoost * 0.35 },
      { key: "build", label: "Build", weight: 0.19 + buildBoost * 0.35 },
      { key: "drop", label: "Drop", weight: 0.23 + dropBoost * 0.42 },
      { key: "break", label: "Break", weight: 0.16 - dropBoost * 0.2 },
      { key: "outro", label: "Outro", weight: 0.22 - buildBoost * 0.05 },
    ].map((seg) => ({ ...seg, weight: clamp(seg.weight, 0.08, 0.38) }));

    const totalWeight = base.reduce((acc, seg) => acc + seg.weight, 0) || 1;
    let cursor = 0;
    return base.map((seg, idx) => {
      const pctRaw = (seg.weight / totalWeight) * 100;
      const startPct = cursor;
      const pct = idx === base.length - 1 ? Math.max(4, 100 - cursor) : Math.max(8, Math.round(pctRaw * 10) / 10);
      const endPct = startPct + pct;
      const startSec = Math.round((duration * startPct) / 100);
      const endSec = Math.round((duration * endPct) / 100);
      cursor += pct;
      return { ...seg, pct, startPct, endPct, startSec, endSec };
    });
  }

  function buildWaveformSamples(track, points = 86) {
    const bpm = clamp(Number(track?.bpm || 124), 90, 160);
    const energy = clamp(Number(track?.energy || track?.note || 6), 1, 10);
    const seed = hashString32(`${track?.id || ""}|${track?.title || ""}|${track?.artist || ""}|${bpm.toFixed(2)}|${energy.toFixed(2)}`);
    const rnd = seededRandom(seed);
    const structure = computeTrackStructure(track);
    const out = [];
    for (let i = 0; i < points; i += 1) {
      const x = i / Math.max(1, points - 1);
      const phaseA = Math.sin((x * bpm) / 5.4);
      const phaseB = Math.sin((x * bpm) / 2.2 + 0.7);
      const noise = (rnd() - 0.5) * 0.52;
      const progressPct = x * 100;
      const seg = structure.find((item) => progressPct >= item.startPct && progressPct < item.endPct) || structure[structure.length - 1];
      const segBoost = seg?.key === "drop" ? 0.28 : seg?.key === "build" ? 0.14 : seg?.key === "break" ? -0.12 : 0.02;
      const raw = 0.46 + phaseA * 0.2 + phaseB * 0.16 + noise + (energy - 5) * 0.03 + segBoost;
      out.push(clamp(raw, 0.06, 1));
    }
    return out;
  }

  function renderWaveformCanvas(node, samples) {
    if (!node) return;
    if (!samples?.length) {
      node.innerHTML = "";
      return;
    }
    node.innerHTML = samples
      .map((value) => `<span class="wf-bar" style="height:${Math.round(clamp(value, 0.06, 1) * 100)}%"></span>`)
      .join("");
  }

  function renderStructureSegments(node, structure) {
    if (!node) return;
    if (!structure?.length) {
      node.innerHTML = "";
      return;
    }
    node.innerHTML = structure
      .map(
        (seg) => `
      <span class="wf-seg seg-${seg.key}" style="width:${seg.pct}%;">
        <strong>${esc(seg.label)}</strong>
        <small>${formatTime(seg.startSec)}-${formatTime(seg.endSec)}</small>
      </span>
    `
      )
      .join("");
  }

  function renderTrackWaveform(track, waveNode, structureNode, labelNode) {
    if (!waveNode || !structureNode) return;
    if (!track) {
      renderWaveformCanvas(waveNode, []);
      renderStructureSegments(structureNode, []);
      if (labelNode) labelNode.textContent = "Aucune data";
      return;
    }
    const samples = buildWaveformSamples(track);
    const structure = computeTrackStructure(track);
    renderWaveformCanvas(waveNode, samples);
    renderStructureSegments(structureNode, structure);
    if (labelNode) {
      labelNode.textContent = `${Number(track.bpm || 0).toFixed(2)} BPM • ${track.camelot_key || track.musical_key || "-"} • ${formatTime(track.duration || 0)}`;
    }
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
      const payload = await api("POST", "/api/auth/login", { email, loginId: email, identifier: email, password }, { auth: false });
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
      setAuthFeedback(humanizeError(error, "Connexion impossible. Vérifie ton ID DJ et la connexion backend."), "error");
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
          loginId: email,
          identifier: email,
          password,
          display_name: displayName,
          displayName,
          dj_name: djName,
          djName,
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
      setAuthFeedback(humanizeError(error, "Inscription impossible. Vérifie que l'ID DJ est unique."), "error");
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
      setAuthFeedback(humanizeError(error), "error");
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
      setAuthFeedback(humanizeError(error), "error");
    } finally {
      el.resetSubmitBtn.disabled = false;
    }
  }

  async function logoutSubmit() {
    try {
      if (state.desktopSerato.available) {
        await stopDesktopSeratoSync();
      }
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

  async function syncDesktopSeratoStatus() {
    if (!desktopSeratoApi) return null;
    try {
      const payload = await desktopSeratoApi.status();
      if (payload && typeof payload === "object") {
        state.desktopSerato = { ...state.desktopSerato, ...payload, available: true };
      }
      return state.desktopSerato;
    } catch (error) {
      state.desktopSerato = {
        ...state.desktopSerato,
        available: true,
        active: false,
        connected: false,
        lastError: humanizeError(error),
      };
      return state.desktopSerato;
    }
  }

  async function startDesktopSeratoSync(force = false) {
    if (!desktopSeratoApi) return false;
    const apiBase = String(runtimeConfig.apiBase || "").trim();
    const token = String(state.auth.token || "").trim();
    if (!apiBase || !token) return false;
    try {
      const payload = await desktopSeratoApi.start({
        apiBase,
        token,
        force: Boolean(force),
      });
      if (payload && typeof payload === "object") {
        state.desktopSerato = { ...state.desktopSerato, ...payload, available: true };
      }
      await syncDesktopSeratoStatus();
      updateTopStatus();
      return true;
    } catch (error) {
      state.desktopSerato = {
        ...state.desktopSerato,
        available: true,
        active: false,
        connected: false,
        lastError: humanizeError(error),
      };
      updateTopStatus();
      return false;
    }
  }

  async function stopDesktopSeratoSync() {
    if (!desktopSeratoApi) return;
    try {
      const payload = await desktopSeratoApi.stop();
      if (payload && typeof payload === "object") {
        state.desktopSerato = { ...state.desktopSerato, ...payload, available: true };
      }
    } catch (_) {
      // Best effort.
    } finally {
      state.desktopSerato = {
        ...state.desktopSerato,
        available: true,
        active: false,
        connected: false,
      };
      updateTopStatus();
    }
  }

  function stopDesktopSeratoPolling() {
    clearInterval(state.desktopSeratoPoller);
    state.desktopSeratoPoller = null;
  }

  function startDesktopSeratoPolling() {
    if (!desktopSeratoApi) return;
    stopDesktopSeratoPolling();
    state.desktopSeratoPoller = setInterval(async () => {
      await syncDesktopSeratoStatus();
      updateTopStatus();
    }, 2600);
  }

  function stopPollers() {
    clearInterval(state.poller);
    clearInterval(state.recommendationsPoller);
    stopDesktopSeratoPolling();
    state.poller = null;
    state.recommendationsPoller = null;
  }

  function startPollers() {
    stopPollers();
    if (state.desktopSerato.available) {
      startDesktopSeratoPolling();
    }
    state.poller = setInterval(async () => {
      await refreshSerato();
      if (state.desktopSerato.available) {
        if (!state.desktopSerato.active) {
          await startDesktopSeratoSync(false);
        } else {
          await syncDesktopSeratoStatus();
        }
      } else {
        await autoConfigureSeratoBridge(false);
      }
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

  function buildTrackOptionLabel(track) {
    return `${track.title} - ${track.artist} • ${Number(track.bpm || 0).toFixed(2)} BPM • ${track.camelot_key || track.musical_key || "-"}`;
  }

  function buildTransitionFilteredTracks(which) {
    const filter = String(which === "a" ? state.transitionFilters.a : state.transitionFilters.b || "")
      .trim()
      .toLowerCase();
    if (!filter) return state.tracks.slice();
    return state.tracks.filter((track) => {
      const haystack = `${track.title || ""} ${track.artist || ""} ${track.genre || ""} ${track.camelot_key || track.musical_key || ""} ${track.bpm || ""}`.toLowerCase();
      return haystack.includes(filter);
    });
  }

  function renderTransitionTrackPreview(track, node, label) {
    if (!node) return;
    if (!track) {
      node.innerHTML = `<div class="coach-tip">${label}: aucune track sélectionnée</div>`;
      return;
    }
    node.innerHTML = `
      <div class="coach-tip"><strong>${esc(track.title)}</strong> • ${esc(track.artist)}</div>
      <div class="coach-tip">${Number(track.bpm || 0).toFixed(2)} BPM • ${esc(track.camelot_key || track.musical_key || "-")} • note ${Number(track.note || 0).toFixed(1)}/10</div>
      <div class="coach-tip">Énergie ${Number(track.energy || 0).toFixed(1)} • Genre ${esc(track.genre || "unknown")}</div>
    `;
  }

  function ensureSelectOptions() {
    if (!state.tracks.length) {
      const emptyOption = `<option value="">Aucun morceau local</option>`;
      if (el.trackASelect) el.trackASelect.innerHTML = emptyOption;
      if (el.trackBSelect) el.trackBSelect.innerHTML = emptyOption;
      if (el.analysisTrackSelect) el.analysisTrackSelect.innerHTML = emptyOption;
      if (el.analyzeBtn) el.analyzeBtn.disabled = true;
      return;
    }

    const optionsA = buildTransitionFilteredTracks("a")
      .map((track) => `<option value="${Number(track.id) || 0}">${esc(buildTrackOptionLabel(track))}</option>`)
      .join("");
    const optionsB = buildTransitionFilteredTracks("b")
      .map((track) => `<option value="${Number(track.id) || 0}">${esc(buildTrackOptionLabel(track))}</option>`)
      .join("");
    const previousA = Number(el.trackASelect?.value || 0);
    const previousB = Number(el.trackBSelect?.value || 0);
    el.trackASelect.innerHTML = optionsA || `<option value="">Aucun résultat</option>`;
    el.trackBSelect.innerHTML = optionsB || `<option value="">Aucun résultat</option>`;
    const analysisOptions = state.tracks
      .map((track) => `<option value="${Number(track.id) || 0}">${esc(track.title)} - ${esc(track.artist)}</option>`)
      .join("");
    el.analysisTrackSelect.innerHTML = analysisOptions;

    const deckAId = state.serato.deckA?.track_id;
    const deckBId = state.serato.deckB?.track_id;

    if (deckAId && getTrackById(deckAId) && el.trackASelect.querySelector(`option[value="${deckAId}"]`)) {
      el.trackASelect.value = String(deckAId);
      el.analysisTrackSelect.value = String(deckAId);
    } else if (previousA && el.trackASelect.querySelector(`option[value="${previousA}"]`)) {
      el.trackASelect.value = String(previousA);
    } else if (state.tracks[0]) {
      el.trackASelect.value = String(state.tracks[0].id);
      el.analysisTrackSelect.value = String(state.tracks[0].id);
    }

    if (deckBId && getTrackById(deckBId) && deckBId !== Number(el.trackASelect.value) && el.trackBSelect.querySelector(`option[value="${deckBId}"]`)) {
      el.trackBSelect.value = String(deckBId);
    } else if (previousB && el.trackBSelect.querySelector(`option[value="${previousB}"]`) && previousB !== Number(el.trackASelect.value)) {
      el.trackBSelect.value = String(previousB);
    } else {
      const fallback = buildTransitionFilteredTracks("b").find((track) => track.id !== Number(el.trackASelect.value));
      if (fallback) el.trackBSelect.value = String(fallback.id);
    }
    if (el.analyzeBtn) el.analyzeBtn.disabled = false;
    renderTransitionTrackPreview(getTrackById(el.trackASelect.value), el.trackAPreview, "Track A");
    renderTransitionTrackPreview(getTrackById(el.trackBSelect.value), el.trackBPreview, "Track B");
  }

  async function loadTracks() {
    const payload = await api("GET", "/api/library/tracks?limit=1000");
    state.tracks = payload.tracks || [];
    state.tracksById = new Map(state.tracks.map((track) => [track.id, track]));
    ensureSelectOptions();
    renderSessionBuilder();
  }

  async function runUnifiedSearch() {
    const query = (el.searchInput.value || "").trim();

    if (!query) {
      state.localSearchResults = state.tracks.slice(0, 120);
      state.globalSearchResults = [];
      state.globalSearchById = new Map();
      renderLibraryLocal();
      renderLibraryGlobal();
      if (state.searchTab !== "local") setSearchTab("local");
      return;
    }

    try {
      const payload = await api("GET", `/api/search/unified?q=${encodeURIComponent(query)}&limit=40`);
      state.localSearchResults = payload.local || [];
      state.globalSearchResults = payload.global || [];
      state.globalSearchById = new Map((state.globalSearchResults || []).map((track) => [Number(track.id), track]));
      renderLibraryLocal();
      renderLibraryGlobal();
      renderMatchesPane();
      enrichGlobalResultsLive();
    } catch (error) {
      console.error(error);
      showToast(`Recherche impossible: ${humanizeError(error)}`);
    }
  }

  function upsertGlobalSearchTrack(track) {
    const id = Number(track?.id || 0);
    if (!id) return;
    const nextRows = (state.globalSearchResults || []).map((row) => (Number(row?.id || 0) === id ? { ...row, ...track } : row));
    state.globalSearchResults = nextRows;
    state.globalSearchById.set(id, { ...(state.globalSearchById.get(id) || {}), ...track });
  }

  function getGlobalSearchTrack(externalId) {
    const id = Number(externalId || 0);
    if (!id) return null;
    return state.globalSearchById.get(id) || state.globalSearchResults.find((row) => Number(row?.id || 0) === id) || null;
  }

  async function enrichGlobalResultsLive() {
    const nonce = Number(state.searchEnrichmentNonce || 0) + 1;
    state.searchEnrichmentNonce = nonce;
    const targets = (state.globalSearchResults || []).slice(0, 8).map((row) => Number(row?.id || 0)).filter(Boolean);
    for (const externalId of targets) {
      if (state.searchEnrichmentNonce !== nonce) return;
      try {
        const detail = await api("GET", `/api/external/${externalId}?deep=true&matches_limit=6`);
        if (state.searchEnrichmentNonce !== nonce) return;
        const external = detail?.external || null;
        if (!external) continue;
        upsertGlobalSearchTrack(external);
        if (Number(state.selectedExternalDetail?.external?.id || 0) === Number(external.id)) {
          state.selectedExternalDetail = detail;
          state.selectedExternalMatches = detail.libraryMatches || [];
          if (state.analysisExternalTrack && Number(state.analysisExternalTrack.id || 0) === Number(external.id)) {
            state.analysisExternalTrack = external;
            renderAnalysis();
          }
          renderMatchesPane();
        }
        renderLibraryGlobal();
      } catch (_) {
        // best effort: keep quick search data if deep enrichment fails
      }
    }
  }

  function renderLibraryLocal() {
    const source = state.localSearchResults.length ? state.localSearchResults : state.tracks.slice(0, 120);
    const rows = source.filter(trackPassesFilters);
    if (!rows.length) {
      el.trackResults.innerHTML = `<article class="track-card">Aucun morceau local trouvé. Lance d'abord l'analyse de ta bibliothèque.</article>`;
      return;
    }

    el.trackResults.innerHTML = rows
      .map(
        (track) => `
      <article class="track-card" data-local-track-id="${track.id}">
        <div style="font-size:1.02rem; font-weight:760;">${esc(track.title)}</div>
        <div style="color:var(--text-secondary); margin-top:4px;">${esc(track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip metric-chip metric-genre">${esc(track.genre)}</span>
          <span class="chip metric-chip metric-bpm">${Number(track.bpm).toFixed(2)} BPM</span>
          <span class="chip metric-chip metric-key">${esc(track.camelot_key || track.musical_key || "-")}</span>
          <span class="chip metric-chip metric-note">${Number(track.note).toFixed(1)}/10</span>
        </div>
        <div style="font-size:0.77rem; color:var(--text-secondary); margin-top:8px;">${esc((track.tags || []).join(" • "))}</div>
        <div class="compat-badge ${compatClass(track.note * 10)}">Confiance analyse ${((track.features?.analysis_confidence || 0) * 100).toFixed(0)}%</div>
        <div class="row" style="margin-top:10px;">
          <button class="btn glow-btn" type="button" data-local-analyze="${track.id}">Analyser</button>
          <button class="btn ghost" type="button" data-local-remove="${track.id}">Retirer</button>
        </div>
        <div class="track-reveal">Ouvre l'ADN complet, les meilleurs mix-in/mix-out et l'usage en set.</div>
      </article>
    `
      )
      .join("");
  }

  function renderLibraryGlobal() {
    const rows = state.globalSearchResults.filter(trackPassesFilters);
    if (!rows.length) {
      el.globalResults.innerHTML = `<article class="track-card">Aucun résultat externe. Essaie une requête comme "Anyma Syren".</article>`;
      return;
    }

    el.globalResults.innerHTML = rows
      .map(
        (track) => `
      <article class="track-card" data-external-track-id="${track.id}">
        <div style="font-size:1.02rem; font-weight:760;">${esc(track.title)}</div>
        <div style="color:var(--text-secondary); margin-top:4px;">${esc(track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip metric-chip metric-genre">${esc(track.genre || "unknown")}</span>
          <span class="chip metric-chip metric-bpm">${track.bpm ? `${Number(track.bpm).toFixed(2)} BPM` : "BPM est."}</span>
          <span class="chip metric-chip metric-key">${esc(track.camelot_key || track.musical_key || "Key est.")}</span>
          <span class="chip metric-chip metric-note">${track.note ? `${Number(track.note).toFixed(1)}/10` : "Note est."}</span>
          <span class="chip">IA ${(Number(track?.intelligence?.features?.analysis_confidence || track?.confidence || 0) * 100).toFixed(0)}%</span>
        </div>
        <div style="font-size:0.77rem; color:var(--text-secondary); margin-top:8px;">source: ${esc(track.source)}</div>
        <div class="compat-badge ${compatClass(Number(track.current_track_compatibility || 0))}">
          ${track.current_track_compatibility ? `${Number(track.current_track_compatibility).toFixed(1)}% avec track en cours` : "Pas encore de match track en cours"}
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn glow-btn" type="button" data-external-open="${track.id}">Fiche IA</button>
          <button class="btn ghost" type="button" data-external-analyze="${track.id}">Ouvrir Analyse</button>
          <button class="btn ghost" type="button" data-external-import="${track.id}">Ajouter à ma bibliothèque</button>
        </div>
        <div class="track-reveal">Clique pour ouvrir la fiche externe + compatibilité avec ta bibliothèque.</div>
      </article>
    `
      )
      .join("");
  }

  function renderMatchesPane() {
    const rows = (state.selectedExternalMatches || []).filter((row) => trackPassesFilters(row.track));
    if (!rows.length) {
      el.matchesResults.innerHTML = `<article class="track-card">Sélectionne un morceau externe pour calculer les matches locaux.</article>`;
      return;
    }

    el.matchesResults.innerHTML = rows
      .map(
        (row) => `
      <article class="track-card">
        <div style="font-size:1.02rem; font-weight:760;">${esc(row.track.title)}</div>
        <div style="color:var(--text-secondary); margin-top:4px;">${esc(row.track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip metric-chip metric-bpm">${Number(row.track.bpm).toFixed(2)} BPM</span>
          <span class="chip metric-chip metric-key">${esc(row.track.camelot_key || row.track.musical_key || "-")}</span>
        </div>
        <div class="compat-badge ${compatClass(row.compatibility)}">${row.compatibility}% • ${row.difficulty}</div>
        <div class="track-reveal">Conseil transition: start ${formatTime(row.analysis.mixPoints.startB)} • mix ${formatTime(row.analysis.mixPoints.mixPoint)}.</div>
      </article>
    `
      )
      .join("");
  }

  async function openExternalDetail(externalId, deep = true, allowFallback = true) {
    try {
      el.externalDetailCard.classList.remove("hidden");
      el.externalDetailBody.innerHTML = typingIndicatorMarkup("Maya analyse le morceau externe...");
      el.externalDetailHints.innerHTML = "";
      const detail = await api("GET", `/api/external/${externalId}?deep=${deep ? "true" : "false"}&matches_limit=6`);
      state.selectedExternalDetail = detail;
      state.selectedExternalMatches = detail.libraryMatches || [];

      const external = detail.external;
      upsertGlobalSearchTrack(external);
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
          <div class="coach-tip"><strong>Mood:</strong> ${esc(mood || "estimé")}</div>
          <div class="coach-tip"><strong>Structure:</strong> ${esc(structure)}</div>
          <div class="coach-tip"><strong>Tags:</strong> ${esc(tags || "aucun")}</div>
          <div class="coach-tip"><strong>Compatibilité track en cours:</strong> ${compatibility ? `${compatibility.compatibility}%` : "indisponible"}</div>
          ${compatibility ? `<div class="coach-tip"><strong>Transition conseillée:</strong> start ${formatTime(compatibility.mixPoints.startB)} • mix ${formatTime(compatibility.mixPoints.mixPoint)} • drop ${formatTime(compatibility.mixPoints.dropAlign)}</div>` : ""}
        </div>
      `;

      el.externalDetailHints.innerHTML = (detail.libraryMatches || [])
        .slice(0, 4)
        .map(
          (row) => `<div class="coach-tip">Meilleur match local: ${esc(row.track.artist)} - ${esc(row.track.title)} (${row.compatibility}%)</div>`
        )
        .join("");

      el.externalDetailCard.classList.remove("hidden");
      renderMatchesPane();
      return detail;
    } catch (error) {
      if (deep && allowFallback) {
        return openExternalDetail(externalId, false, false);
      }
      console.error(error);
      showToast(`Impossible d'ouvrir la fiche externe: ${humanizeError(error)}`);
      return null;
    }
  }

  function openSelectedExternalInAnalysis() {
    const external = state.selectedExternalDetail?.external || state.globalSearchResults[0] || null;
    if (!external) {
      showToast("Aucun morceau externe sélectionné");
      return;
    }
    if (!state.selectedExternalDetail?.external) {
      state.selectedExternalDetail = { external, currentCompatibility: null, libraryMatches: [] };
    }
    state.analysisExternalTrack = external;
    if (el.analysisSourceTag) {
      el.analysisSourceTag.innerHTML = `<div class="coach-tip">Source: recherche externe (${esc(external.source || "web")})</div>`;
    }
    navigateTo("analysis");
    renderAnalysis();
  }

  async function openExternalFromSearch(externalId, openInAnalysis = false) {
    const id = Number(externalId || 0);
    if (!id) return;
    const quick = getGlobalSearchTrack(id);
    if (quick) {
      state.selectedExternalDetail = { external: quick, currentCompatibility: null, libraryMatches: [] };
      if (openInAnalysis) {
        state.analysisExternalTrack = quick;
        navigateTo("analysis");
        renderAnalysis();
      }
    }
    const detail = await openExternalDetail(id, true, true);
    if (!detail?.external) return;
    if (openInAnalysis) {
      state.analysisExternalTrack = detail.external;
      navigateTo("analysis");
      renderAnalysis();
    }
  }

  async function saveExternalTo(listName, action = "save") {
    const detail = state.selectedExternalDetail;
    if (!detail?.external?.id) {
      showToast("Ouvre d'abord un morceau externe");
      return;
    }
    try {
      await api("POST", `/api/external/${detail.external.id}/save`, { list_name: listName, action, note: "" });
      showToast(action === "save" ? `Ajouté dans ${listName}` : `Retiré de ${listName}`);
      await refreshHistory();
      await refreshAccountDashboard();
    } catch (error) {
      console.error(error);
      showToast(action === "save" ? "Ajout impossible" : "Suppression impossible");
    }
  }

  async function importExternalToLibrary(externalId) {
    const id = Number(externalId || state.selectedExternalDetail?.external?.id || 0);
    if (!id) {
      showToast("Aucun morceau externe sélectionné");
      return;
    }
    try {
      await api("POST", `/api/external/${id}/import-local`, {});
      await loadTracks();
      await refreshRecommendations();
      renderLibraryLocal();
      renderSessionBuilder();
      showToast("Morceau ajouté à ta bibliothèque locale");
    } catch (error) {
      showToast(`Import impossible: ${humanizeError(error)}`);
    }
  }

  async function testExternalWithLibrary() {
    const detail = state.selectedExternalDetail;
    if (!detail?.external?.id) {
      showToast("Ouvre d'abord un morceau externe");
      return;
    }
    try {
      const payload = await api("GET", `/api/external/${detail.external.id}/matches?limit=12`);
      state.selectedExternalMatches = payload.matches || [];
      renderMatchesPane();
      setSearchTab("matches");
      showToast("Matching bibliothèque prêt");
    } catch (error) {
      console.error(error);
      showToast("Matching impossible");
    }
  }

  async function findSimilarExternal() {
    const detail = state.selectedExternalDetail;
    if (!detail?.external?.id) {
      showToast("Ouvre d'abord un morceau externe");
      return;
    }

    try {
      const payload = await api("GET", `/api/external/${detail.external.id}/similar?limit=12`);
      state.globalSearchResults = payload.similar || [];
      state.globalSearchById = new Map((state.globalSearchResults || []).map((track) => [Number(track.id), track]));
      renderLibraryGlobal();
      setSearchTab("global");
      showToast("Morceaux similaires chargés");
      enrichGlobalResultsLive();
    } catch (error) {
      console.error(error);
      showToast("Recherche similaire impossible");
    }
  }

  async function removeLocalTrack(trackId) {
    const id = Number(trackId || 0);
    if (!id) return;
    try {
      await api("DELETE", `/api/library/tracks/${id}`);
      state.sessionBuilder.selectedTrackIds = state.sessionBuilder.selectedTrackIds.filter((value) => Number(value) !== id);
      await loadTracks();
      await runUnifiedSearch();
      await refreshRecommendations();
      renderSessionBuilder();
      showToast("Morceau retiré de ta bibliothèque");
    } catch (error) {
      showToast(`Suppression impossible: ${String(error.message || error)}`);
    }
  }

  async function removeExternalListItem(itemId) {
    const id = Number(itemId || 0);
    if (!id) return;
    try {
      await api("DELETE", `/api/external/list-items/${id}`);
      await refreshHistory();
      await refreshAccountDashboard();
      showToast("Élément supprimé");
    } catch (error) {
      showToast(`Suppression impossible: ${String(error.message || error)}`);
    }
  }

  function getSessionSelectedTracks() {
    return (state.sessionBuilder.selectedTrackIds || []).map((id) => getTrackById(id)).filter(Boolean);
  }

  async function analyzeSessionBuilderTransitions() {
    const tracks = getSessionSelectedTracks();
    if (!el.sessionBuilderTransitions) return;
    if (tracks.length < 2) {
      el.sessionBuilderTransitions.innerHTML = `<div class="coach-tip">Ajoute au moins 2 morceaux pour calculer les transitions IA.</div>`;
      state.sessionBuilder.analyses = [];
      return;
    }

    el.sessionBuilderTransitions.innerHTML = `<div class="coach-tip">${typingIndicatorMarkup("Calcul IA des transitions de la session...")}</div>`;
    const analyses = [];
    for (let idx = 0; idx < tracks.length - 1; idx += 1) {
      const a = tracks[idx];
      const b = tracks[idx + 1];
      try {
        const payload = await api("POST", "/api/transition/preview", { track_a_id: a.id, track_b_id: b.id });
        analyses.push({
          from: a,
          to: b,
          analysis: payload.analysis,
        });
      } catch (_) {
        analyses.push({
          from: a,
          to: b,
          analysis: null,
        });
      }
    }
    state.sessionBuilder.analyses = analyses;
    el.sessionBuilderTransitions.innerHTML = analyses
      .map((row, index) => {
        if (!row.analysis) {
          return `<div class="coach-tip">${index + 1}. ${esc(row.from.title)} → ${esc(row.to.title)}: analyse indisponible</div>`;
        }
        const mp = row.analysis.mixPoints || {};
        return `<div class="coach-tip">${index + 1}. ${esc(row.from.title)} → ${esc(row.to.title)} • ${row.analysis.compatibility}% • ${esc(row.analysis.difficulty)} • start ${formatTime(mp.startB || 0)} / mix ${formatTime(mp.mixPoint || 0)}</div>`;
      })
      .join("");
  }

  function scheduleSessionBuilderAnalysis() {
    clearTimeout(scheduleSessionBuilderAnalysis.timer);
    scheduleSessionBuilderAnalysis.timer = setTimeout(() => {
      analyzeSessionBuilderTransitions();
    }, 180);
  }

  function addTrackToSession(trackId) {
    const id = Number(trackId || 0);
    if (!id || !getTrackById(id)) return;
    state.sessionBuilder.selectedTrackIds.push(id);
    renderSessionBuilder();
    scheduleSessionBuilderAnalysis();
  }

  function removeTrackFromSession(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.sessionBuilder.selectedTrackIds.length) return;
    state.sessionBuilder.selectedTrackIds.splice(idx, 1);
    renderSessionBuilder();
    scheduleSessionBuilderAnalysis();
  }

  function moveTrackInSession(index, direction) {
    const idx = Number(index);
    const dir = Number(direction);
    if (!Number.isInteger(idx) || !Number.isInteger(dir)) return;
    const next = idx + dir;
    if (idx < 0 || idx >= state.sessionBuilder.selectedTrackIds.length) return;
    if (next < 0 || next >= state.sessionBuilder.selectedTrackIds.length) return;
    const list = state.sessionBuilder.selectedTrackIds;
    [list[idx], list[next]] = [list[next], list[idx]];
    renderSessionBuilder();
    scheduleSessionBuilderAnalysis();
  }

  function clearSessionBuilder() {
    state.sessionBuilder.selectedTrackIds = [];
    state.sessionBuilder.analyses = [];
    renderSessionBuilder();
    scheduleSessionBuilderAnalysis();
  }

  function renderSessionBuilder() {
    if (!el.sessionBuilderAvailable || !el.sessionBuilderSelected || !el.sessionBuilderTotal) return;
    state.sessionBuilder.selectedTrackIds = (state.sessionBuilder.selectedTrackIds || []).filter((id) => Boolean(getTrackById(id)));
    const selectedIds = state.sessionBuilder.selectedTrackIds || [];
    const selectedSet = new Set(selectedIds.map((value) => Number(value)));
    const available = state.tracks.filter((track) => !selectedSet.has(Number(track.id)));

    el.sessionBuilderAvailable.innerHTML = available.length
      ? available
          .slice(0, 120)
          .map(
            (track) => `
        <div class="history-row">
          <div>
            <div style="font-weight:700;">${esc(track.title)}</div>
            <div style="font-size:0.8rem;">${esc(track.artist)} • ${Number(track.bpm || 0).toFixed(2)} BPM • ${esc(track.camelot_key || track.musical_key || "-")}</div>
          </div>
          <button class="btn ghost" type="button" data-session-add="${track.id}">Ajouter</button>
        </div>
      `
          )
          .join("")
      : `<div class="coach-tip">Aucun morceau disponible.</div>`;

    const selectedTracks = getSessionSelectedTracks();
    el.sessionBuilderSelected.innerHTML = selectedTracks.length
      ? selectedTracks
          .map(
            (track, index) => `
        <div class="history-row">
          <div>
            <div style="font-weight:700;">${index + 1}. ${esc(track.title)}</div>
            <div style="font-size:0.8rem;">${esc(track.artist)} • ${formatTime(track.duration || 0)} • ${Number(track.bpm || 0).toFixed(2)} BPM</div>
          </div>
          <div class="row">
            <button class="btn ghost" type="button" data-session-move="${index}" data-session-dir="-1">↑</button>
            <button class="btn ghost" type="button" data-session-move="${index}" data-session-dir="1">↓</button>
            <button class="btn ghost" type="button" data-session-remove="${index}">Retirer</button>
          </div>
        </div>
      `
          )
          .join("")
      : `<div class="coach-tip">Aucun morceau sélectionné.</div>`;

    const totalSeconds = selectedTracks.reduce((acc, track) => acc + Number(track.duration || 0), 0);
    el.sessionBuilderTotal.textContent = `Durée totale: ${formatHms(totalSeconds)}`;
  }

  function renderTransitionResult(data) {
    if (!data) {
      el.transitionResult.innerHTML = `<div style="color:var(--text-secondary)">Sélectionne 2 tracks puis clique ANALYSER.</div>`;
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
      showToast("Track A et Track B doivent être différents.");
      return;
    }

    try {
      el.transitionResult.innerHTML = `<div class="coach-list"><div class="coach-tip">${typingIndicatorMarkup("Maya analyse la transition...")}</div></div>`;
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
      showToast("Analyse de transition impossible");
    }
  }

  function renderAnalysis() {
    const external = state.analysisExternalTrack || null;
    const selectedLocal = external ? null : getTrackById(el.analysisTrackSelect?.value);
    const track = external || selectedLocal || state.tracks[0] || null;
    const isExternal = Boolean(external);
    if (el.analysisSourceTag) {
      const sourceText = isExternal
        ? `Source: recherche externe (${external?.source || "web"})`
        : "Source: bibliothèque DJ";
      el.analysisSourceTag.innerHTML = `<div class="coach-tip">${esc(sourceText)}</div>`;
    }
    if (!track) {
      el.analysisKpis.innerHTML = "";
      el.analysisDna.innerHTML = `<div class="analysis-item"><span style="color:var(--text-secondary)">Aucun morceau analysé</span><strong>-</strong></div>`;
      el.analysisOutlook.innerHTML = "";
      el.analysisMixHints.innerHTML = "";
      renderTrackWaveform(null, el.analysisWaveform, el.analysisStructure, el.analysisWaveformLabel);
      return;
    }

    const features = isExternal ? track.intelligence?.features || {} : track.features || {};
    const confidence = isExternal ? Number(track.confidence || features.analysis_confidence || 0) : Number(features.analysis_confidence || 0);
    const keyValue = track.camelot_key || track.musical_key || "-";
    const durationValue = Number(track.duration || 0);
    const kpis = [
      { label: "BPM", value: Number(track.bpm).toFixed(2), tone: "bpm" },
      { label: "Clé", value: keyValue, tone: "key" },
      { label: "Énergie", value: `${Number(track.energy || 0).toFixed(1)}/10`, tone: "energy" },
      { label: "Note", value: `${Number(track.note).toFixed(1)}/10`, tone: "note" },
      { label: "Durée", value: formatTime(durationValue), tone: "confidence" },
      { label: "Confiance", value: `${(confidence * 100).toFixed(0)}%`, tone: "confidence" },
      { label: "Dance", value: `${Number(features.danceability || 0).toFixed(1)}/10`, tone: "dance" },
    ];

    el.analysisKpis.innerHTML = kpis
      .map(
        (item) => `
      <div class="kpi-tile metric-${esc(item.tone)}">
        <div class="kpi-label">${esc(item.label)}</div>
        <div class="kpi-value metric-${esc(item.tone)}">${esc(item.value)}</div>
      </div>
    `
      )
      .join("");

    const dnaRows = [
      ["Genre", track.genre || "unknown"],
      ["Tags", (track.tags || []).join(" • ") || "none"],
      ["Clé", keyValue],
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

    const localMatches = (state.selectedExternalMatches || []).slice(0, 4).map((row) => ({
      track: row.track,
      compatibility: row.compatibility,
      difficulty: row.difficulty,
    }));
    const fallbackRecs = isExternal ? localMatches : state.recommendations.slice(0, 3);
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
      : `<div class="history-row"><span>Aucune recommandation.</span><small>-</small></div>`;

    const phrase16 = Math.max(8, Math.round((16 * 60) / Math.max(1, Number(track.bpm))));
    const phrase32 = Math.max(12, Math.round((32 * 60) / Math.max(1, Number(track.bpm))));
    const hints = [
      `16 mesures à ${formatTime(phrase16)}, 32 mesures à ${formatTime(phrase32)} pour verrouiller la phrase.`,
      `Ligne harmonique: utilise ${keyValue} avant de switcher le deck.`,
      `${Number(track.energy) >= 8 ? "Peak-time" : Number(track.energy) >= 7 ? "Main-room" : "Warm-up"} détecté par le moteur IA.`,
      `Sub ${(features.bass || 0).toFixed(1)}/10, mélodique ${(features.melodic || 0).toFixed(1)}/10, percussion ${(features.percussion || 0).toFixed(1)}/10.`,
    ];

    el.analysisMixHints.innerHTML = hints.map((tip) => `<div class="coach-tip">${esc(tip)}</div>`).join("");
    renderTrackWaveform(track, el.analysisWaveform, el.analysisStructure, el.analysisWaveformLabel);
  }

  function renderNowPlaying() {
    const bridgeConnected = state.serato?.status === "connected";
    const deckA = bridgeConnected ? state.serato.deckA : null;
    const deckB = bridgeConnected ? state.serato.deckB : null;
    const current = bridgeConnected ? currentDeckTrack(deckA) : null;
    const next = bridgeConnected ? currentDeckTrack(deckB) : null;

    if (!current) {
      el.nowTrackName.textContent = "Aucun morceau";
      el.nowTrackArtist.textContent = state.desktopSerato.available
        ? "Ouvre Serato DJ Pro puis charge Deck A pour activer le live."
        : "Connecte Serato pour récupérer le titre en direct";
      el.nowBpm.textContent = "-- BPM";
      el.nowKey.textContent = "--";
      el.nowNote.textContent = "Note --/10";
      el.nowEnergy.textContent = "Énergie --";
      el.nowGenre.textContent = "--";
      el.nextTrackName.textContent = "En attente Deck B";
      el.nextTrackArtist.textContent = "--";
      el.nextBpm.textContent = "-- BPM";
      el.nextKey.textContent = "--";
      el.nextNote.textContent = "Note --/10";
      el.nextCompatibility.textContent = "--%";
      el.nextCompatibilityBar.style.width = "0%";
      el.deckProgressBar.style.width = "0%";
      el.deckPosition.textContent = "--:--";
      el.deckRemaining.textContent = "Restant --:--";
      el.nowCoach.innerHTML = `<div class="coach-tip">1 Connect Serato • 2 Load Deck A • 3 Load Deck B • 4 Start live coach.</div>`;
      el.nowRecommendations.innerHTML = `<div class="track-card">Aucune recommandation pour le moment.</div>`;
      setWaveMenuState(el.deckAWave, 0, false);
      setWaveMenuState(el.deckBWave, 0, false);
      renderTrackWaveform(null, el.nowWaveformA, el.nowStructureA, el.nowWaveformALabel);
      renderTrackWaveform(null, el.nowWaveformB, el.nowStructureB, el.nowWaveformBLabel);
      return;
    }

    el.nowTrackName.textContent = current.title;
    el.nowTrackArtist.textContent = current.artist;
    el.nowBpm.textContent = `${Number(deckA?.bpm || current.bpm || 0).toFixed(2)} BPM`;
    el.nowKey.textContent = current.camelot_key || current.musical_key || "-";
    el.nowNote.textContent = `Note ${Number(current.note || 0).toFixed(1)}/10`;
    el.nowEnergy.textContent = `Énergie ${Number(current.energy || 0).toFixed(1)}`;
    el.nowGenre.textContent = current.genre || "unknown";

    const position = Number(deckA?.position || 0);
    const duration = Number(current.duration || 0);
    const progress = duration > 0 ? (position / duration) * 100 : 0;
    el.deckProgressBar.style.width = `${clamp(progress, 0, 100)}%`;
    el.deckPosition.textContent = formatTime(position);
    el.deckRemaining.textContent = duration > 0 ? `Restant ${formatTime(Math.max(0, duration - position))}` : "Restant --:--";

    if (next) {
      el.nextTrackName.textContent = next.title;
      el.nextTrackArtist.textContent = next.artist;
      el.nextBpm.textContent = `${Number(next.bpm || 0).toFixed(2)} BPM`;
      el.nextKey.textContent = next.camelot_key || next.musical_key || "-";
      el.nextNote.textContent = `Note ${Number(next.note || 0).toFixed(1)}/10`;
    } else {
      el.nextTrackName.textContent = "En attente Deck B";
      el.nextTrackArtist.textContent = "--";
      el.nextBpm.textContent = "-- BPM";
      el.nextKey.textContent = "--";
      el.nextNote.textContent = "Note --/10";
    }

    renderTrackWaveform(current, el.nowWaveformA, el.nowStructureA, el.nowWaveformALabel);
    renderTrackWaveform(next, el.nowWaveformB, el.nowStructureB, el.nowWaveformBLabel);

    setWaveMenuState(el.deckAWave, Number(deckA?.bpm || current.bpm || 0), true);
    setWaveMenuState(el.deckBWave, Number(deckB?.bpm || next?.bpm || 0), Boolean(deckB && next));

    const recs = state.recommendations.slice(0, 6);
    if (!recs.length) {
      el.nextCompatibility.textContent = "--%";
      el.nextCompatibilityBar.style.width = "0%";
      el.nowCoach.innerHTML = `<div class="coach-tip">Analyse une transition pour activer les suggestions live.</div>`;
      el.nowRecommendations.innerHTML = `<div class="track-card">Aucune recommandation IA disponible.</div>`;
      return;
    }

    const first = recs[0];
    el.nextCompatibility.textContent = `${Number(first.compatibility).toFixed(1)}%`;
    el.nextCompatibilityBar.style.width = `${first.compatibility}%`;

    const coachLines =
      state.liveCoach?.analysis?.coach || state.activeTransition?.analysis?.coach || ["IA runtime active", "Coach live basé sur la position deck et la fenêtre de mix"];
    el.nowCoach.innerHTML = coachLines.slice(0, 2).map((tip) => `<div class="coach-tip">${esc(tip)}</div>`).join("");

    el.nowRecommendations.innerHTML = recs
      .map(
        (item) => `
      <div class="track-card">
        <div style="font-weight:700">${esc(item.track.title)}</div>
        <div style="color:var(--text-secondary); font-size:0.84rem">${esc(item.track.artist)}</div>
        <div class="row" style="margin-top:8px;">
          <span class="chip metric-chip metric-bpm">${Number(item.track.bpm).toFixed(2)} BPM</span>
          <span class="chip metric-chip metric-key">${esc(item.track.camelot_key || item.track.musical_key || "-")}</span>
          <span class="chip metric-chip metric-note">${Number(item.track.note).toFixed(1)}/10</span>
          <span class="chip metric-chip metric-genre">${esc(item.track.genre)}</span>
        </div>
        <div class="compat-badge ${compatClass(item.compatibility)}">${item.compatibility}% • ${esc(item.difficulty)}</div>
        <div class="track-reveal">Survole pour prévisualiser le blend et clique dans Bibliothèque pour l'analyse complète.</div>
      </div>
    `
      )
      .join("");
  }

  function liveSetupChecklist() {
    const bridgeReady = state.serato?.status === "connected";
    const deckAReady = Boolean(state.serato?.deckA?.track_id || state.serato?.deckA?.title);
    const deckBReady = Boolean(state.serato?.deckB?.track_id || state.serato?.deckB?.title);
    const coachReady = Boolean(state.liveCoach);
    const rows = [
      { ok: bridgeReady, label: "1. Connect Serato", hint: bridgeReady ? "Bridge connecté" : "Clique Connecter Serato dans Session" },
      { ok: deckAReady, label: "2. Load Deck A", hint: deckAReady ? "Deck A détecté" : "Charge un morceau sur Deck A" },
      { ok: deckBReady, label: "3. Load Deck B", hint: deckBReady ? "Deck B détecté" : "Charge un morceau sur Deck B" },
      { ok: coachReady, label: "4. Start Live Coach", hint: coachReady ? "Coach live actif" : "Lance mode LIVE quand decks A/B sont chargés" },
    ];
    return `<div class="live-setup">${rows
      .map(
        (row) => `
      <div class="live-setup-step ${row.ok ? "ready" : ""}">
        <strong>${esc(row.label)}</strong>
        <span class="state">${row.ok ? "OK" : "À faire"}</span>
      </div>
      <div class="coach-tip" style="margin-top:-4px;">${esc(row.hint)}</div>
    `
      )
      .join("")}</div>`;
  }

  function renderLiveOverlay() {
    const bridgeConnected = state.serato?.status === "connected";
    const deckA = bridgeConnected ? state.serato.deckA : null;
    const current = bridgeConnected ? currentDeckTrack(deckA) : null;
    if (!current) {
      el.liveTrackName.textContent = "Charge un track sur Deck A";
      el.liveBpm.textContent = "-- BPM";
      el.liveKey.textContent = "--";
      el.liveNote.textContent = "Note --/10";
      el.liveEnergy.textContent = "Énergie --";
      el.liveMixWindow.textContent = "Coach live indisponible";
      el.liveCountdown.textContent = "Checklist live à suivre";
      el.liveAlert.textContent = "Maya suggère: connecte Serato puis charge Deck A et Deck B.";
      el.liveAlert.classList.add("show");
      el.liveCoachList.innerHTML = liveSetupChecklist();
      el.liveSuggestions.innerHTML = "";
      return;
    }

    el.liveTrackName.textContent = current.title;
    el.liveBpm.textContent = `${Number(deckA?.bpm || current.bpm || 0).toFixed(2)} BPM`;
    el.liveKey.textContent = current.camelot_key || current.musical_key || "-";
    el.liveNote.textContent = `Note ${Number(current.note || 0).toFixed(1)}/10`;
    el.liveEnergy.textContent = `Énergie ${Number(current.energy || 0).toFixed(1)}`;

    const coach = state.liveCoach;
    if (!coach) {
      el.liveMixWindow.textContent = "Coach live indisponible";
      el.liveCountdown.textContent = "Connecte Serato + charge Deck A/B pour activer le coaching";
      el.liveAlert.textContent = "Maya suggère: suis les 4 étapes de setup live.";
      el.liveAlert.classList.add("show");
      el.liveCoachList.innerHTML = liveSetupChecklist();
      el.liveSuggestions.innerHTML = "";
      return;
    }

    const mix = coach.analysis?.mixPoints || {};
    el.liveMixWindow.textContent = `${formatTime(mix.startB || 0)} -> ${formatTime(mix.mixPoint || 0)}`;
    el.liveCountdown.textContent = coach.message || "Coach live actif";
    el.liveAlert.textContent = `Maya suggère: ${coach.message || "Surveille le timing de transition."}`;
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
      : `<div class="history-row"><span>Aucun événement.</span><small>-</small></div>`;

    const session = state.activeSession;
    if (!session) {
      el.sessionStatusDetail.textContent = `Session inactive. Saves externes: ${state.history.externalSavedCount || 0}.`;
    } else {
      el.sessionStatusDetail.textContent = `Session #${session.id} active depuis ${new Date(session.started_at).toLocaleTimeString()} • saves externes ${state.history.externalSavedCount || 0}.`;
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
      el.profileCloudStatus.textContent = cloudOk ? "Prêt" : "Hors ligne";
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
        <div class="row" style="margin-top:8px;">
          <button class="btn ghost" type="button" data-remove-list-item="${row.id}">Supprimer</button>
        </div>
      </div>
    `);

    renderProfileStack(el.profilePrepCrate, data.favorites?.prepCrate || [], (row) => `
      <div class="profile-stack-item">
        <strong>${esc(row.artist || "Unknown")} - ${esc(row.title || "Unknown")}</strong>
        <span>${esc(row.list_name || "prep_crate")} • ${Number(row.note || 0).toFixed(1)}/10 • ${esc(row.genre || "unknown")}</span>
        <div class="row" style="margin-top:8px;">
          <button class="btn ghost" type="button" data-remove-list-item="${row.id}">Supprimer</button>
        </div>
      </div>
    `);
  }

  function updateTopStatus() {
    const bridgeMap = {
      connected: ["connected", `mode ${state.serato.mode}${state.serato.lastSeen ? ` • vu ${new Date(state.serato.lastSeen).toLocaleTimeString()}` : ""}`],
      connecting: ["disconnected", "connexion..."],
      disconnected: ["disconnected", "déconnecté"],
      error: ["error", `erreur ${state.serato.lastError || "inconnue"}`],
    };
    const bridgeStatus = bridgeMap[state.serato.status] || ["disconnected", state.serato.status];
    setStatusPill(el.bridgeStatus, el.bridgeStatusText, bridgeStatus[0], "Serato", bridgeStatus[1]);

    const openaiText = state.ai.openaiEnabled
      ? state.ai.openaiConnected
        ? "OpenAI connecté"
        : "OpenAI configuré (test en attente)"
      : "OpenAI optionnel (non requis)";
    const internetText = state.ai?.internetEnrichment?.active ? "internet metadata actif" : "internet metadata off";
    const aiText = `IA cloud connectée • moteur local ${state.ai.localModelActive ? "actif" : "off"} • ${openaiText} • ${internetText}`;
    const aiStatus = state.ai.localModelActive ? "connected" : "disconnected";
    setStatusPill(el.socketStatus, el.socketStatusText, aiStatus, "AI", aiText);

    const relayInfo = state.seratoRelay?.wsUrl
      ? ` • relais ${state.seratoRelay.connected ? "actif" : "off"} (${state.seratoRelay.wsUrl})`
      : "";
    const desktopInfo = state.desktopSerato.available
      ? ` • desktop ${state.desktopSerato.active ? "actif" : "off"}${
          state.desktopSerato.historyPath ? ` (${state.desktopSerato.historyPath})` : ""
        }${state.desktopSerato.lastError ? ` [${state.desktopSerato.lastError}]` : ""}`
      : "";
    const wsLine = `Mode bridge: ${state.serato.mode}. Statut: ${state.serato.status}${
      state.serato.lastError ? ` (${state.serato.lastError})` : ""
    }${relayInfo}${desktopInfo}`;
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
      if (state.desktopSerato.available) {
        await syncDesktopSeratoStatus();
      }
      state.serato = await api("GET", "/api/serato/status");
      const liveTrackIds = [state.serato?.deckA?.track_id, state.serato?.deckB?.track_id].filter(Boolean).map((value) => Number(value));
      const missing = liveTrackIds.some((id) => !getTrackById(id));
      const now = Date.now();
      if (missing && now - Number(state.seratoLibrarySyncAt || 0) > 4500) {
        state.seratoLibrarySyncAt = now;
        await loadTracks();
      }
      renderNowPlaying();
      renderLiveOverlay();
      updateTopStatus();
      if (el.wsStatusDetail) {
        const bridgeReady = state.serato?.status === "connected";
        const deckAReady = Boolean(state.serato?.deckA?.track_id || state.serato?.deckA?.title);
        const deckBReady = Boolean(state.serato?.deckB?.track_id || state.serato?.deckB?.title);
        if (!bridgeReady) {
          if (state.desktopSerato.available) {
            const desktopLine = state.desktopSerato.active
              ? "Auto-sync desktop actif. Ouvre Serato DJ Pro puis charge Deck A / Deck B."
              : "Auto-sync desktop inactif. Relance Maya Mixa et ouvre Serato DJ Pro.";
            el.wsStatusDetail.textContent = `${desktopLine} 1 Connect Serato • 2 Load Deck A • 3 Load Deck B • 4 Start live coach.`;
          } else {
            el.wsStatusDetail.textContent =
              "1 Connect Serato • 2 Load Deck A • 3 Load Deck B • 4 Start live coach (mode LIVE).";
          }
        } else if (!deckAReady || !deckBReady) {
          el.wsStatusDetail.textContent =
            `Serato connecté. ${deckAReady ? "Deck A OK" : "Load Deck A"} • ${deckBReady ? "Deck B OK" : "Load Deck B"} • active ensuite le mode LIVE.`;
        }
      }
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
      state.ai = {
        ...state.ai,
        localModelActive: true,
        openaiEnabled: false,
        openaiConnected: false,
        openaiMessage: humanizeError(error),
      };
      updateTopStatus();
    }
  }

  async function scanLibrary() {
    const path = (el.libraryPathInput.value || "").trim();
    if (!path) {
      showToast("Saisis d'abord le chemin de ta bibliothèque.");
      return;
    }

      el.scanStatus.innerHTML = `${typingIndicatorMarkup("Maya scanne et analyse les morceaux...")}`;
    try {
      const start = await api("POST", "/api/library/scan", { path, recursive: true, limit: 0 });
      const jobId = start?.job?.id;
      if (!jobId) throw new Error("Création du job de scan impossible");

      let finalJob = null;
      const timeoutAt = Date.now() + 1000 * 60 * 30;
      while (Date.now() < timeoutAt) {
        const payload = await api("GET", `/api/library/scan/jobs/${encodeURIComponent(jobId)}`);
        const job = payload?.job;
        if (!job) throw new Error("Job de scan introuvable");
        const progress = job.candidates
          ? `${job.processed}/${job.candidates}`
          : `${job.processed || 0}`;
        el.scanStatus.textContent = `Scan ${job.status}: ${progress} fichiers • analysés ${job.analyzed || 0} • erreurs ${job.errors_count || 0}${job.truncated ? " • tronqué (limite sécurité)" : ""}`;
        if (job.status === "completed") {
          finalJob = job;
          break;
        }
        if (job.status === "failed") {
          throw new Error(job.message || "Scan impossible");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!finalJob) throw new Error("Timeout scan");

      await loadTracks();
      await runUnifiedSearch();
      await refreshRecommendations();
      await refreshHistory();
      await refreshAccountDashboard();
      showToast("Scan bibliothèque terminé.");
    } catch (error) {
      console.error(error);
      const msg = String(error.message || error);
      el.scanStatus.textContent = `Scan impossible: ${msg}`;
      showToast(`Scan impossible: ${msg}`);
    }
  }

  async function syncAppleCatalog() {
    if (el.appleSyncBtn) el.appleSyncBtn.disabled = true;
    try {
      const payload = await api("POST", "/api/library/apple/sync?seeds_limit=12&per_query_limit=4", {});
      state.lastAppleSyncAt = new Date().toISOString();
      setAppleSyncTimestamp(state.lastAppleSyncAt);
      const discovered = Number(payload?.uniqueExternalTracks || payload?.discovered || 0);
      el.scanStatus.textContent = `Sync Apple Music terminée: ${discovered} morceaux externes mis à jour.`;
      await runUnifiedSearch();
      await refreshHistory();
      await refreshAccountDashboard();
      showToast(`Sync Apple Music OK (${discovered})`);
    } catch (error) {
      showToast(`Sync Apple Music impossible: ${String(error.message || error)}`);
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

  function stopSeratoRelay() {
    const socket = state.seratoRelay?.socket;
    if (socket) {
      try {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      } catch (_) {
        // No-op.
      }
    }
    state.seratoRelay = { socket: null, wsUrl: "", mode: "none", connected: false, forwarding: false };
  }

  async function startSeratoRelay(wsUrl) {
    const endpoint = String(wsUrl || "").trim();
    if (!endpoint) throw new Error("URL WebSocket locale requise (ex: ws://127.0.0.1:8787)");
    stopSeratoRelay();
    const socket = new WebSocket(endpoint);
    state.seratoRelay = { socket, wsUrl: endpoint, mode: "relay_websocket", connected: false, forwarding: false };
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        state.seratoRelay.connected = false;
        reject(new Error("Timeout relais"));
      }, 2500);
      socket.onopen = () => {
        clearTimeout(timeoutId);
        state.seratoRelay.connected = true;
        showToast("Relais Serato local connecté");
        resolve(true);
      };
      socket.onerror = () => {
        clearTimeout(timeoutId);
        state.seratoRelay.connected = false;
        reject(new Error("Erreur de connexion relais"));
      };
    });

    socket.onclose = () => {
      state.seratoRelay.connected = false;
    };
    socket.onerror = () => {
      state.seratoRelay.connected = false;
    };
    socket.onmessage = async (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data || "{}");
      } catch (_) {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      if (state.seratoRelay.forwarding) return;
      state.seratoRelay.forwarding = true;
      try {
        await api("POST", "/api/serato/push", { payload, source: "browser_ws" });
      } catch (_) {
        // Bridge push failures should not crash UI.
      } finally {
        state.seratoRelay.forwarding = false;
      }
    };
  }

  async function autoConfigureSeratoBridge(force = false) {
    if (state.desktopSerato.available) return;
    const now = Date.now();
    const retryMs = state.serato?.status === "connected" ? 22000 : state.liveMode ? 3500 : 7000;
    if (!force && now - Number(state.seratoAutoConnectAt || 0) < retryMs) return;
    state.seratoAutoConnectAt = now;

    const seenAtMs = Date.parse(state.serato?.lastSeen || "");
    if (!force && state.serato?.status === "connected" && Number.isFinite(seenAtMs) && now - seenAtMs < 12000) return;

    try {
      await api("POST", "/api/serato/connect", { mode: "push", ws_url: "", history_path: "", feed_path: "" });
    } catch (_) {
      // Keep best effort for automatic runtime.
    }

    if (state.seratoRelay.connected) return;
    const preferred = String(el.wsUrlInput?.value || "").trim();
    const candidates = [preferred, "ws://127.0.0.1:8787", "ws://localhost:8787"]
      .map((url) => String(url || "").trim())
      .filter(Boolean)
      .filter((url, idx, arr) => arr.indexOf(url) === idx);

    for (const candidate of candidates) {
      try {
        await startSeratoRelay(candidate);
        if (el.wsUrlInput) el.wsUrlInput.value = candidate;
        await refreshSerato();
        updateTopStatus();
        return;
      } catch (_) {
        stopSeratoRelay();
      }
    }

    if (el.wsStatusDetail) {
      el.wsStatusDetail.textContent = "Mode auto: en attente du bridge local Serato (ws://127.0.0.1:8787).";
    }
  }

  async function connectBridge() {
    if (state.desktopSerato.available) {
      try {
        const started = await startDesktopSeratoSync(true);
        if (!started) throw new Error("Auto-sync desktop indisponible");
        state.serato = await api("POST", "/api/serato/connect", { mode: "push", ws_url: "", history_path: "", feed_path: "" });
        updateTopStatus();
        showToast("Auto-sync Serato desktop activé");
        await refreshSerato();
        await refreshLiveCoach();
        await refreshRecommendations();
        await refreshHistory();
        await refreshAccountDashboard();
      } catch (error) {
        showToast(`Connexion Serato desktop impossible: ${String(error.message || error)}`);
      }
      return;
    }

    const selectedMode = el.seratoModeSelect?.value || "websocket";
    const useRelay = selectedMode === "relay_websocket";
    const relayUrl = String(el.wsUrlInput?.value || "").trim() || "ws://127.0.0.1:8787";
    const payload = {
      mode: useRelay ? "push" : selectedMode,
      ws_url: useRelay ? relayUrl : String(el.wsUrlInput?.value || "").trim(),
      history_path: String(el.historyPathInput?.value || "").trim(),
      feed_path: String(el.feedPathInput?.value || "").trim(),
    };

    try {
      if (useRelay) {
        await startSeratoRelay(payload.ws_url);
      } else {
        stopSeratoRelay();
      }
      state.serato = await api("POST", "/api/serato/connect", payload);
      updateTopStatus();
      showToast(`Bridge en connexion (${selectedMode})`);
      await refreshSerato();
      await refreshLiveCoach();
      await refreshRecommendations();
      await refreshHistory();
      await refreshAccountDashboard();
    } catch (error) {
      console.error(error);
      stopSeratoRelay();
      showToast(`Connexion bridge impossible: ${String(error.message || error)}`);
    }
  }

  async function disconnectBridge() {
    try {
      stopSeratoRelay();
      if (state.desktopSerato.available) {
        await stopDesktopSeratoSync();
      }
      state.serato = await api("POST", "/api/serato/disconnect", {});
      state.liveCoach = null;
      updateTopStatus();
      renderLiveOverlay();
      await refreshHistory();
      await refreshAccountDashboard();
      showToast("Bridge déconnecté");
    } catch (error) {
      console.error(error);
    }
  }

  async function startSession() {
    try {
      state.activeSession = await api("POST", "/api/sessions/start", { name: "Session Maya Hive Live", profile_id: null });
      renderHistory();
      await refreshAccountDashboard();
      showToast(`Session #${state.activeSession.id} démarrée`);
    } catch (error) {
      console.error(error);
      showToast("Impossible de démarrer la session");
    }
  }

  async function endSession() {
    try {
      const done = await api("POST", "/api/sessions/end", {});
      state.activeSession = null;
      renderHistory();
      await refreshAccountDashboard();
      showToast(`Session #${done.id} terminée`);
    } catch (_) {
      showToast("Aucune session active");
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
      showToast(`Export impossible: ${String(error.message || error)}`);
    }
  }

  function bindLibraryDelegates() {
    on(el.trackResults, "click", (event) => {
      const removeBtn = event.target.closest("[data-local-remove]");
      if (removeBtn) {
        removeLocalTrack(removeBtn.getAttribute("data-local-remove"));
        return;
      }
      const analyzeBtn = event.target.closest("[data-local-analyze]");
      if (analyzeBtn) {
        const forcedId = analyzeBtn.getAttribute("data-local-analyze");
        if (forcedId) {
          state.analysisExternalTrack = null;
          el.analysisTrackSelect.value = forcedId;
          renderAnalysis();
          navigateTo("analysis");
        }
        return;
      }
      const card = event.target.closest("[data-local-track-id]");
      if (!card) return;
      const id = card.getAttribute("data-local-track-id");
      if (!id) return;
      state.analysisExternalTrack = null;
      el.analysisTrackSelect.value = id;
      renderAnalysis();
      navigateTo("analysis");
    });

    on(el.globalResults, "click", async (event) => {
      const importBtn = event.target.closest("[data-external-import]");
      if (importBtn) {
        const id = importBtn.getAttribute("data-external-import");
        if (id) await importExternalToLibrary(id);
        return;
      }
      const analyzeBtn = event.target.closest("[data-external-analyze]");
      if (analyzeBtn) {
        const id = analyzeBtn.getAttribute("data-external-analyze");
        if (id) await openExternalFromSearch(Number(id), true);
        return;
      }
      const openBtn = event.target.closest("[data-external-open]");
      if (openBtn) {
        const id = openBtn.getAttribute("data-external-open");
        if (id) await openExternalFromSearch(Number(id), false);
        return;
      }
      const card = event.target.closest("[data-external-track-id]");
      if (!card) return;
      const id = card.getAttribute("data-external-track-id");
      if (!id) return;
      await openExternalFromSearch(Number(id), false);
    });
  }

  function bindEvents() {
    el.navItems.forEach((item) => on(item, "click", () => navigateTo(item.dataset.screen)));

    on(el.mobileMenuBtn, "click", () => el.sidebar?.classList.toggle("open"));

    document.addEventListener("click", (event) => {
      if (window.innerWidth > 860) return;
      if (!el.sidebar) return;
      if (!el.sidebar.contains(event.target) && event.target !== el.mobileMenuBtn) {
        el.sidebar.classList.remove("open");
      }
    });

    on(el.liveToggle, "click", () => toggleLive());
    on(el.liveToggleSwitch, "change", (event) => {
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

    on(el.searchInput, "input", () => {
      clearTimeout(state.searchDebounce);
      state.searchDebounce = setTimeout(runUnifiedSearch, 280);
    });
    on(el.searchSubmitBtn, "click", runUnifiedSearch);
    on(el.appleSyncBtn, "click", syncAppleCatalog);

    [el.bpmFilterInput, el.keyFilterInput, el.energyFilterInput].filter(Boolean).forEach((input) => {
      input.addEventListener("input", () => {
        renderLibraryLocal();
        renderLibraryGlobal();
        renderMatchesPane();
      });
    });

    document.querySelectorAll("[data-quick-search]").forEach((button) => {
      button.addEventListener("click", () => {
        if (el.searchInput) el.searchInput.value = button.dataset.quickSearch || "";
        runUnifiedSearch();
      });
    });

    on(el.scanLibraryBtn, "click", scanLibrary);
    on(el.analyzeBtn, "click", analyzeTransition);
    on(el.analysisTrackSelect, "change", () => {
      state.analysisExternalTrack = null;
      renderAnalysis();
    });
    on(el.trackAFilterInput, "input", () => {
      state.transitionFilters.a = String(el.trackAFilterInput?.value || "");
      ensureSelectOptions();
    });
    on(el.trackBFilterInput, "input", () => {
      state.transitionFilters.b = String(el.trackBFilterInput?.value || "");
      ensureSelectOptions();
    });

    on(el.trackASelect, "change", () => {
      if (el.trackASelect.value === el.trackBSelect.value) {
        const fallback = state.tracks.find((track) => track.id !== Number(el.trackASelect.value));
        if (fallback) el.trackBSelect.value = String(fallback.id);
      }
      renderTransitionTrackPreview(getTrackById(el.trackASelect.value), el.trackAPreview, "Track A");
      refreshRecommendations();
    });

    on(el.trackBSelect, "change", () => {
      if (el.trackASelect.value === el.trackBSelect.value) showToast("Track B doit être différent de Track A");
      renderTransitionTrackPreview(getTrackById(el.trackBSelect.value), el.trackBPreview, "Track B");
    });

    on(el.wsConnectBtn, "click", connectBridge);
    on(el.wsDisconnectBtn, "click", disconnectBridge);

    on(el.startSessionBtn, "click", startSession);
    on(el.endSessionBtn, "click", endSession);
    on(el.exportJsonBtn, "click", () => exportCurrent("json"));
    on(el.exportCsvBtn, "click", () => exportCurrent("csv"));

    on(el.externalSaveWishlistBtn, "click", () => saveExternalTo("wishlist", "save"));
    on(el.externalSaveCrateBtn, "click", () => saveExternalTo("prep_crate", "save"));
    on(el.externalRemoveWishlistBtn, "click", () => saveExternalTo("wishlist", "remove"));
    on(el.externalRemoveCrateBtn, "click", () => saveExternalTo("prep_crate", "remove"));
    on(el.externalTestLibraryBtn, "click", testExternalWithLibrary);
    on(el.externalFindSimilarBtn, "click", findSimilarExternal);
    on(el.externalOpenAnalysisBtn, "click", async () => {
      const selectedId = Number(state.selectedExternalDetail?.external?.id || 0);
      if (selectedId) {
        await openExternalFromSearch(selectedId, true);
      } else {
        openSelectedExternalInAnalysis();
      }
    });
    on(el.externalImportLibraryBtn, "click", () => importExternalToLibrary());

    on(el.sessionBuilderClearBtn, "click", clearSessionBuilder);
    on(el.sessionBuilderAvailable, "click", (event) => {
      const btn = event.target.closest("[data-session-add]");
      if (!btn) return;
      addTrackToSession(btn.getAttribute("data-session-add"));
    });
    on(el.sessionBuilderSelected, "click", (event) => {
      const removeBtn = event.target.closest("[data-session-remove]");
      if (removeBtn) {
        removeTrackFromSession(removeBtn.getAttribute("data-session-remove"));
        return;
      }
      const moveBtn = event.target.closest("[data-session-move]");
      if (moveBtn) {
        moveTrackInSession(moveBtn.getAttribute("data-session-move"), moveBtn.getAttribute("data-session-dir"));
      }
    });

    on(el.authLoginTab, "click", () => setAuthTab("login"));
    on(el.authRegisterTab, "click", () => setAuthTab("register"));
    on(el.apiBaseSaveBtn, "click", saveApiBaseConfig);
    on(el.apiBaseTestBtn, "click", testApiBaseConnection);
    on(el.apiBaseInput, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveApiBaseConfig();
      }
    });
    on(el.googleAuthBtn, "click", () => startOAuthLogin("google"));
    on(el.appleAuthBtn, "click", () => startOAuthLogin("apple"));
    on(el.authLoginForm, "submit", loginSubmit);
    on(el.authRegisterForm, "submit", registerSubmit);
    on(el.forgotPasswordBtn, "click", openForgotFlow);
    on(el.authForgotForm, "submit", forgotPasswordSubmit);
    on(el.openResetTokenBtn, "click", () => openResetFlow());
    on(el.forgotBackBtn, "click", () => setAuthTab("login"));
    on(el.authResetForm, "submit", resetPasswordSubmit);
    on(el.resetBackBtn, "click", () => setAuthTab("login"));

    on(el.openAccountBtn, "click", () => navigateTo("account"));
    on(el.logoutBtn, "click", logoutSubmit);
    on(el.profileSaveBtn, "click", saveProfile);
    on(el.passwordSaveBtn, "click", changePassword);
    on(el.profileWishlist, "click", (event) => {
      const btn = event.target.closest("[data-remove-list-item]");
      if (!btn) return;
      removeExternalListItem(btn.getAttribute("data-remove-list-item"));
    });
    on(el.profilePrepCrate, "click", (event) => {
      const btn = event.target.closest("[data-remove-list-item]");
      if (!btn) return;
      removeExternalListItem(btn.getAttribute("data-remove-list-item"));
    });
    on(el.adminRefreshUsersBtn, "click", refreshAdminUsers);
    on(el.adminUsersTableBody, "click", (event) => {
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
    resetRuntimeData();
    await refreshAiStatus();
    await loadTracks();
    state.localSearchResults = state.tracks.slice(0, 120);
    renderLibraryLocal();
    renderLibraryGlobal();
    renderMatchesPane();
    renderSessionBuilder();
    scheduleSessionBuilderAnalysis();
    if (state.desktopSerato.available) {
      await startDesktopSeratoSync(true);
      startDesktopSeratoPolling();
      try {
        await api("POST", "/api/serato/connect", { mode: "push", ws_url: "", history_path: "", feed_path: "" });
      } catch (_) {
        // Keep app usable even if push bridge setup fails momentarily.
      }
    }
    await refreshSerato();
    if (!state.desktopSerato.available) {
      await autoConfigureSeratoBridge(true);
    }
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
    setTimeout(() => dismissBootLoader(true), BOOT_LOADER_MAX_MS);
    try {
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
          showToast("Backend indisponible. Vérifie la connexion cloud.");
        }
      } else {
        lockAppUi(true);
        navigateTo("now-playing");
        stopPollers();
      }
    } catch (error) {
      console.error(error);
      showToast("Initialisation impossible. Recharge l'application.");
    } finally {
      dismissBootLoader(false);
    }
  }

  initialLoad();
})();
