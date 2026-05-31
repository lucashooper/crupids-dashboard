import { supabase, supabaseConfigured } from './supabaseClient.js';
import {
  hydrateFromSupabase,
  migrateLocalIfCloudEmpty,
  setSyncedUserId,
  storeGet,
  storeSet,
} from './optimisticStore.js';

let currentUser = null;
let authMode = 'signin';

const OFFLINE_DISMISS_KEY = 'auth_offline_dismissed_v1';

export function getCurrentUser() {
  return currentUser;
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
}

function setAuthStatus(text, isError = false) {
  const el = document.getElementById('authStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('auth-status--error', isError);
}

function showAuthModal() {
  document.getElementById('authModal')?.classList.remove('hidden');
  setAuthMode('signin');
}

function hideAuthModal() {
  document.getElementById('authModal')?.classList.add('hidden');
  setAuthStatus('');
}

function openSettingsAccount() {
  const settingsModal = document.getElementById('settingsModal');
  settingsModal?.classList.remove('hidden');
  document.getElementById('settingsAccountSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function handleAccountClick() {
  if (currentUser) {
    openSettingsAccount();
    return;
  }
  showAuthModal();
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
        : 'Sign in to sync tasks, habits, and reflections across your devices. Changes save locally first, then sync in the background.';
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
  const openAuthBtn = document.getElementById('openAuthBtn');

  if (user) {
    signedInPanel?.classList.remove('hidden');
    signedOutPanel?.classList.add('hidden');
    settingsAccount?.classList.remove('hidden');
    if (emailEl) emailEl.textContent = user.email || 'Signed in';
    applyProfileAvatar(user);

    if (openAuthBtn) {
      const short = user.email ? user.email.split('@')[0] : 'Synced';
      openAuthBtn.textContent = short.length > 12 ? `${short.slice(0, 11)}…` : short;
      openAuthBtn.title = `Signed in as ${user.email || 'your account'} — click for account`;
      openAuthBtn.classList.add('account-btn--synced');
      openAuthBtn.setAttribute('aria-label', `Account: ${user.email || 'signed in'}`);
    }
  } else {
    signedInPanel?.classList.add('hidden');
    signedOutPanel?.classList.remove('hidden');
    settingsAccount?.classList.add('hidden');
    applyProfileAvatar(null);

    if (openAuthBtn) {
      openAuthBtn.textContent = 'Account';
      openAuthBtn.title = 'Sign in to sync across devices';
      openAuthBtn.classList.remove('account-btn--synced');
      openAuthBtn.setAttribute('aria-label', 'Sign in to sync across devices');
    }
  }
}

async function handleSignIn(email, password) {
  if (!supabase) {
    setAuthStatus('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.', true);
    return;
  }
  setAuthStatus('Signing in…');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthStatus(error.message, true);
    return;
  }
  setSyncedUserId(data.user?.id);
  if (data.user?.id) {
    await hydrateFromSupabase(data.user.id);
    await migrateLocalIfCloudEmpty(data.user.id);
  }
  updateAccountUI(data.user);
  hideAuthModal();
  setAuthStatus('');
  window.dispatchEvent(new CustomEvent('auth-changed'));
}

async function handleSignUp(email, password) {
  if (!supabase) {
    setAuthStatus('Supabase is not configured.', true);
    return;
  }
  setAuthStatus('Creating account…');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthStatus(error.message, true);
    return;
  }
  if (data.session?.user) {
    setSyncedUserId(data.session.user.id);
    await hydrateFromSupabase(data.session.user.id);
    await migrateLocalIfCloudEmpty(data.session.user.id);
    updateAccountUI(data.session.user);
    hideAuthModal();
    setAuthStatus('');
    window.dispatchEvent(new CustomEvent('auth-changed'));
    return;
  }
  setAuthStatus('Check your email to confirm your account, then sign in.');
  setAuthMode('signin');
}

async function handleSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  setSyncedUserId(null);
  updateAccountUI(null);
  hideAuthModal();
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

export function initAuth() {
  const modal = document.getElementById('authModal');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const signOutBtn = document.getElementById('authSignOutBtn');
  const offlineBtn = document.getElementById('authOfflineBtn');
  const openAuthBtn = document.getElementById('openAuthBtn');
  const profileWrap = document.getElementById('profilePicWrap');
  const authClose = document.getElementById('authModalClose');

  openAuthBtn?.addEventListener('click', handleAccountClick);
  profileWrap?.addEventListener('dblclick', (e) => {
    if (!supabaseConfigured) return;
    e.preventDefault();
    handleAccountClick();
  });

  authClose?.addEventListener('click', hideAuthModal);
  offlineBtn?.addEventListener('click', () => {
    storeSet(OFFLINE_DISMISS_KEY, true);
    hideAuthModal();
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) hideAuthModal();
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

  if (!supabaseConfigured) {
    document.getElementById('syncHint')?.classList.add('hidden');
    if (openAuthBtn) openAuthBtn.style.display = 'none';
    return;
  }

  supabase.auth.getSession().then(({ data: { session } }) => {
    setSyncedUserId(session?.user?.id ?? null);
    updateAccountUI(session?.user ?? null);
    const dismissed = storeGet(OFFLINE_DISMISS_KEY);
    if (!session?.user && !dismissed) showAuthModal();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    setSyncedUserId(session?.user?.id ?? null);
    updateAccountUI(session?.user ?? null);
    if (session?.user) hideAuthModal();
  });
}

export function wireProfileUpload() {
  const wrap = document.getElementById('profilePicWrap');
  const img = document.getElementById('profilePic');
  const placeholder = document.getElementById('profilePlaceholder');
  const upload = document.getElementById('profileUpload');

  applyProfileAvatar(currentUser);

  wrap?.addEventListener('click', () => upload?.click());

  upload?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result;
      if (!dataUrl) return;
      img.src = dataUrl;
      img.classList.remove('hidden');
      placeholder.classList.add('hidden');
      storeSet('profile_picture', dataUrl);
    };
    reader.readAsDataURL(file);
  });
}
