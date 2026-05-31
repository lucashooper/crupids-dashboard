import { supabase, supabaseConfigured } from './supabaseClient.js';
import {
  clearPendingSync,
  hydrateFromSupabase,
  migrateLocalIfCloudEmpty,
  setSyncEnabled,
  setSyncedUserId,
  storeGet,
  storeSet,
} from './optimisticStore.js';

let currentUser = null;
let authMode = 'signin';
let signOutTimer = null;
let sessionSetupPromise = null;

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
  const modal = document.getElementById('authModal');
  modal?.classList.remove('hidden');
  if (supabaseConfigured && !currentUser) {
    modal?.classList.add('auth-modal--required');
    document.getElementById('authModalClose')?.classList.add('hidden');
  }
  setAuthMode('signin');
}

function hideAuthModal() {
  if (supabaseConfigured && !currentUser) return;
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

function cancelPendingSignOut() {
  if (signOutTimer) {
    clearTimeout(signOutTimer);
    signOutTimer = null;
  }
}

function scheduleSignedOutUI() {
  cancelPendingSignOut();
  signOutTimer = setTimeout(async () => {
    signOutTimer = null;
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      console.info('[auth] Ignoring transient SIGNED_OUT — session still valid');
      updateAccountUI(session.user);
      setSyncedUserId(session.user.id);
      setSyncEnabled(true);
      setAppLocked(false);
      hideAuthModal();
      return;
    }
    console.info('[auth] Confirmed signed out');
    setSyncEnabled(false);
    setSyncedUserId(null);
    updateAccountUI(null);
    setAppLocked(true);
    showAuthModal();
    window.dispatchEvent(new CustomEvent('auth-changed'));
  }, 400);
}

async function finishAuthenticatedSession(session, { migrate = false } = {}) {
  const user = session?.user;
  if (!user?.id) return;

  cancelPendingSignOut();
  setSyncEnabled(false);
  clearPendingSync();
  setSyncedUserId(user.id);
  updateAccountUI(user);
  setAppLocked(false);
  hideAuthModal();

  if (sessionSetupPromise) await sessionSetupPromise;

  sessionSetupPromise = (async () => {
    try {
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

async function handleSignIn(email, password) {
  if (!supabase) {
    setAuthStatus('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.', true);
    return;
  }

  setAuthStatus('Signing in…');
  setSyncEnabled(false);
  clearPendingSync();
  cancelPendingSignOut();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  setAuthStatus('');
}

async function handleSignUp(email, password) {
  if (!supabase) {
    setAuthStatus('Supabase is not configured.', true);
    return;
  }

  setAuthStatus('Creating account…');
  setSyncEnabled(false);
  clearPendingSync();

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  if (data.session?.user) {
    setAuthStatus('');
    return;
  }

  setAuthStatus('Check your email to confirm your account, then sign in.');
  setAuthMode('signin');
}

async function handleSignOut() {
  if (!supabase) return;
  cancelPendingSignOut();
  setSyncEnabled(false);
  clearPendingSync();
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
    if (!supabaseConfigured || currentUser) hideAuthModal();
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal && (!supabaseConfigured || currentUser)) hideAuthModal();
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

      if (event === 'INITIAL_SESSION') {
        if (user) {
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
        finishAuthenticatedSession(session, { migrate: true });
        return;
      }

      if (event === 'TOKEN_REFRESHED' && user) {
        cancelPendingSignOut();
        setSyncedUserId(user.id);
        updateAccountUI(user);
        setAppLocked(false);
        hideAuthModal();
        if (!syncEnabled) setSyncEnabled(true);
        return;
      }

      if (event === 'SIGNED_OUT') {
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
    if (supabaseConfigured && !currentUser) {
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
      storeSet('profile_picture', dataUrl);
      syncSettingsProfilePreview();
    };
    reader.readAsDataURL(file);
  });
}
