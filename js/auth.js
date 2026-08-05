import { supabase, supabaseConfigured } from './supabaseClient.js';
import {
  clearPendingSync,
  hydrateFromSupabase,
  migrateLocalIfCloudEmpty,
  setSyncEnabled,
  setSyncedUserId,
  storeGet,
  storeSetLocal,
} from './optimisticStore.js';
import {
  clearCachedSession,
  getCachedSession,
  isCachedSessionValid,
  restoreClientSession,
  setCachedSession,
} from './sessionCache.js';

let currentUser = null;
let authMode = 'signin';
let signOutTimer = null;
let sessionSetupPromise = null;
let lastSetupKey = '';
let explicitSignOut = false;

export function getCurrentUser() {
  return currentUser;
}

export function isAuthRequired() {
  return supabaseConfigured;
}

export function openSettingsModal() {
  if (typeof window.renderStatsPanel === 'function') window.renderStatsPanel();
  syncSettingsProfilePreview();
  document.getElementById('settingsModal')?.classList.remove('hidden');
}

function syncSettingsProfilePreview() {
  const src = document.getElementById('profilePic');
  const dst = document.getElementById('settingsProfilePic');
  const ph = document.getElementById('settingsProfilePlaceholder');
  if (!dst || !ph) return;
  if (src?.src && !src.classList.contains('hidden')) {
    dst.src = src.src;
    dst.classList.remove('hidden');
    ph.classList.add('hidden');
  } else {
    dst.classList.add('hidden');
    dst.removeAttribute('src');
    ph.classList.remove('hidden');
  }
}

export function applyProfileAvatar(user) {
  const img = document.getElementById('profilePic');
  const placeholder = document.getElementById('profilePlaceholder');
  if (!img || !placeholder) return;

  const oauthUrl =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    user?.user_metadata?.avatar;

  const savedPic = oauthUrl || storeGet('profile_picture');

  if (savedPic) {
    img.src = savedPic;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    img.removeAttribute('src');
    placeholder.classList.remove('hidden');
  }
  syncSettingsProfilePreview();
}

function isSignedIn() {
  return Boolean(currentUser) || isCachedSessionValid();
}

function setAuthStatus(text, isError = false) {
  const el = document.getElementById('authStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('auth-status--error', isError);
}

function setAppLocked(locked) {
  document.body.classList.toggle('auth-locked', locked && supabaseConfigured);
}

export function showAuthModal() {
  if (isSignedIn()) return;
  const modal = document.getElementById('authModal');
  modal?.classList.remove('hidden');
  modal?.classList.add('auth-modal--required');
  document.getElementById('authModalClose')?.classList.add('hidden');
  setAuthMode('signin');
}

function hideAuthModal() {
  if (supabaseConfigured && !isSignedIn()) return;
  const modal = document.getElementById('authModal');
  modal?.classList.add('hidden');
  modal?.classList.remove('auth-modal--required');
  document.getElementById('authModalClose')?.classList.remove('hidden');
  setAuthStatus('');
}

function setAuthMode(mode) {
  authMode = mode === 'signup' ? 'signup' : 'signin';
  const title = document.getElementById('authModalTitle');
  const primary = document.getElementById('authPrimaryBtn');
  const hint = document.getElementById('authModeHint');
  const tabs = document.querySelectorAll('.auth-mode-tab');

  tabs.forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.mode === authMode);
  });

  if (title) title.textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  if (primary) primary.textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  if (hint) {
    hint.textContent =
      authMode === 'signup'
        ? 'Create an account to sync tasks, habits, and reflections across devices.'
        : 'Sign in to use your dashboard. Tasks, habits, and reflections sync automatically across devices.';
  }

  const passwordInput = document.getElementById('authPassword');
  if (passwordInput) {
    passwordInput.autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
  }
  setAuthStatus('');
}

function updateAccountUI(user) {
  currentUser = user || null;
  const signedInPanel = document.getElementById('authSignedIn');
  const signedOutPanel = document.getElementById('authSignedOut');
  const emailEl = document.getElementById('authUserEmail');
  const settingsAccount = document.getElementById('settingsAccountSection');
  const settingsSignIn = document.getElementById('settingsSignInSection');

  if (user) {
    signedInPanel?.classList.remove('hidden');
    signedOutPanel?.classList.add('hidden');
    settingsAccount?.classList.remove('hidden');
    settingsSignIn?.classList.add('hidden');
    if (emailEl) emailEl.textContent = user.email || 'Signed in';
    applyProfileAvatar(user);
  } else {
    signedInPanel?.classList.add('hidden');
    signedOutPanel?.classList.remove('hidden');
    settingsAccount?.classList.add('hidden');
    settingsSignIn?.classList.remove('hidden');
    applyProfileAvatar(null);
  }
}

function applySignedInUI(session) {
  const user = session?.user;
  if (!user?.id) return;
  setCachedSession(session);
  restoreClientSession(session);
  cancelPendingSignOut();
  setSyncedUserId(user.id);
  updateAccountUI(user);
  setAppLocked(false);
  hideAuthModal();
}

function cancelPendingSignOut() {
  if (signOutTimer) {
    clearTimeout(signOutTimer);
    signOutTimer = null;
  }
}

function scheduleSignedOutUI() {
  cancelPendingSignOut();
  signOutTimer = setTimeout(() => {
    signOutTimer = null;
    if (explicitSignOut) {
      explicitSignOut = false;
      confirmSignedOutUI();
      return;
    }
    if (isCachedSessionValid()) {
      console.info('[auth] Keeping signed-in UI — access token still valid');
      applySignedInUI(getCachedSession());
      if (!sessionSetupPromise) setSyncEnabled(true);
      return;
    }
    confirmSignedOutUI();
  }, 300);
}

function confirmSignedOutUI() {
  console.info('[auth] Confirmed signed out');
  clearCachedSession();
  setSyncEnabled(false);
  setSyncedUserId(null);
  updateAccountUI(null);
  setAppLocked(true);
  showAuthModal();
  window.dispatchEvent(new CustomEvent('auth-changed'));
}

async function clearStaleAuthStorage() {
  if (!supabase) return;
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.warn('[auth] could not clear local auth storage:', err?.message || err);
  }
  clearCachedSession();
}

async function finishAuthenticatedSession(session, { migrate = false } = {}) {
  const user = session?.user;
  if (!user?.id || !session?.access_token) return;

  const setupKey = `${user.id}:${session.access_token.slice(0, 12)}`;
  if (setupKey === lastSetupKey && sessionSetupPromise) {
    await sessionSetupPromise;
    return;
  }
  lastSetupKey = setupKey;

  applySignedInUI(session);
  setSyncEnabled(false);
  clearPendingSync();

  if (sessionSetupPromise) await sessionSetupPromise;

  sessionSetupPromise = (async () => {
    try {
      await new Promise((r) => setTimeout(r, 150));
      await hydrateFromSupabase(user.id);
      if (migrate) await migrateLocalIfCloudEmpty(user.id);
    } catch (err) {
      console.warn('[auth] cloud sync failed:', err?.message || err);
      setAuthStatus('Signed in, but cloud sync had a problem. Your local data still works.', true);
    } finally {
      setSyncEnabled(true);
      window.dispatchEvent(new CustomEvent('auth-changed'));
    }
  })();

  await sessionSetupPromise;
  sessionSetupPromise = null;
}

async function formatAuthError(error) {
  const msg = error?.message || String(error || 'Auth failed');
  const status = error?.status;
  if (status === 429 || /security purposes|rate limit|too many requests/i.test(msg)) {
    return 'Too many sign-up / sign-in attempts. Wait a few minutes (sometimes up to an hour), then try again — or create the user in Supabase → Authentication → Users.';
  }
  return msg;
}

async function handleSignIn(email, password) {
  if (!supabase) {
    setAuthStatus('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).', true);
    return;
  }

  setAuthStatus('Signing in…');
  setSyncEnabled(false);
  clearPendingSync();
  cancelPendingSignOut();
  lastSetupKey = '';

  await clearStaleAuthStorage();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthStatus(await formatAuthError(error), true);
    return;
  }

  if (!data.session?.user) {
    setAuthStatus('Sign-in succeeded but no session was returned. Try again.', true);
    return;
  }

  setAuthStatus('');
  await finishAuthenticatedSession(data.session, { migrate: true });
}

async function handleSignUp(email, password) {
  if (!supabase) {
    setAuthStatus('Supabase is not configured.', true);
    return;
  }

  setAuthStatus('Creating account…');
  setSyncEnabled(false);
  clearPendingSync();
  await clearStaleAuthStorage();

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthStatus(await formatAuthError(error), true);
    return;
  }

  if (data.session?.user) {
    setAuthStatus('');
    await finishAuthenticatedSession(data.session, { migrate: true });
    return;
  }

  // Email confirmation is enabled in the Supabase project
  setAuthStatus('Account created. If email confirmation is on, check your inbox then sign in. Or disable “Confirm email” in Supabase Auth settings for instant access.');
  setAuthMode('signin');
}

async function handleSignOut() {
  if (!supabase) return;
  explicitSignOut = true;
  cancelPendingSignOut();
  setSyncEnabled(false);
  clearPendingSync();
  clearCachedSession();
  lastSetupKey = '';
  await supabase.auth.signOut();
  setSyncedUserId(null);
  updateAccountUI(null);
  setAppLocked(true);
  showAuthModal();
  window.dispatchEvent(new CustomEvent('auth-changed'));
}

function handleAuthSubmit(email, password) {
  if (authMode === 'signup') {
    if (password.length < 6) {
      setAuthStatus('Password must be at least 6 characters.', true);
      return;
    }
    handleSignUp(email, password);
  } else {
    handleSignIn(email, password);
  }
}

function wireAuthFormListeners() {
  const modal = document.getElementById('authModal');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const passwordToggle = document.getElementById('authPasswordToggle');
  const signOutBtn = document.getElementById('authSignOutBtn');
  const authClose = document.getElementById('authModalClose');
  const settingsSignInBtn = document.getElementById('settingsSignInBtn');

  passwordToggle?.addEventListener('click', () => {
    if (!passwordInput) return;
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    passwordToggle.textContent = show ? '🙈' : '👁';
  });

  authClose?.addEventListener('click', () => {
    if (!supabaseConfigured || isSignedIn()) hideAuthModal();
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal && (!supabaseConfigured || isSignedIn())) hideAuthModal();
  });

  document.querySelectorAll('.auth-mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = emailInput?.value?.trim();
    const password = passwordInput?.value;
    if (!email || !password) {
      setAuthStatus('Enter email and password.', true);
      return;
    }
    handleAuthSubmit(email, password);
  });

  signOutBtn?.addEventListener('click', handleSignOut);
  document.getElementById('authSignOutBtnModal')?.addEventListener('click', handleSignOut);

  settingsSignInBtn?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.add('hidden');
    showAuthModal();
  });
}

export function initAuth() {
  wireAuthFormListeners();

  if (!supabaseConfigured) {
    console.info('[auth] Supabase not configured — running without sign-in.');
    document.getElementById('syncHint')?.classList.add('hidden');
    setAppLocked(false);
    return Promise.resolve(null);
  }

  setSyncEnabled(false);
  console.info('[auth] Waiting for session from storage…');

  return new Promise((resolve) => {
    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      console.info('[auth]', event, user?.email ?? 'signed out');

      if (session?.access_token) setCachedSession(session);

      if (event === 'INITIAL_SESSION') {
        if (user && session?.access_token) {
          finishAuthenticatedSession(session).then(() => resolve(session));
        } else {
          setSyncedUserId(null);
          setSyncEnabled(false);
          updateAccountUI(null);
          setAppLocked(true);
          showAuthModal();
          resolve(session);
        }
        return;
      }

      if (event === 'SIGNED_IN') {
        if (session?.access_token && session.access_token === getCachedSession()?.access_token) {
          applySignedInUI(session);
          return;
        }
        finishAuthenticatedSession(session, { migrate: true });
        return;
      }

      if (event === 'TOKEN_REFRESHED' && user && session?.access_token) {
        setCachedSession(session);
        cancelPendingSignOut();
        applySignedInUI(session);
        if (!sessionSetupPromise) setSyncEnabled(true);
        return;
      }

      if (event === 'SIGNED_OUT') {
        if (explicitSignOut) return;
        if (isCachedSessionValid()) {
          console.warn('[auth] Ignoring SIGNED_OUT — cached access token still valid');
          applySignedInUI(getCachedSession());
          return;
        }
        scheduleSignedOutUI();
      }
    });
  });
}

export function wireProfileUpload() {
  const wrap = document.getElementById('profilePicWrap');
  const upload = document.getElementById('profileUpload');
  const changeBtn = document.getElementById('settingsChangePhotoBtn');

  applyProfileAvatar(currentUser);

  wrap?.addEventListener('click', (e) => {
    e.preventDefault();
    if (supabaseConfigured && !isSignedIn()) {
      showAuthModal();
      return;
    }
    openSettingsModal();
  });

  changeBtn?.addEventListener('click', () => upload?.click());

  upload?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result;
      if (!dataUrl) return;
      const img = document.getElementById('profilePic');
      const placeholder = document.getElementById('profilePlaceholder');
      img.src = dataUrl;
      img.classList.remove('hidden');
      placeholder.classList.add('hidden');
      // Keep photos local-only — base64 in user_preferences was a major egress source.
      storeSetLocal('profile_picture', dataUrl);
      syncSettingsProfilePreview();
    };
    reader.readAsDataURL(file);
  });
}
