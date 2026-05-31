import { supabase, supabaseConfigured } from './supabaseClient.js';
import {
  hydrateFromSupabase,
  migrateLocalIfCloudEmpty,
  setSyncedUserId,
  storeGet,
  storeSet,
} from './optimisticStore.js';

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
}

function hideAuthModal() {
  document.getElementById('authModal')?.classList.add('hidden');
}

function updateAccountUI(user) {
  const signedIn = document.getElementById('authSignedIn');
  const signedOut = document.getElementById('authSignedOut');
  const emailEl = document.getElementById('authUserEmail');
  const settingsAccount = document.getElementById('settingsAccountSection');

  if (user) {
    signedIn?.classList.remove('hidden');
    signedOut?.classList.add('hidden');
    settingsAccount?.classList.remove('hidden');
    if (emailEl) emailEl.textContent = user.email || 'Signed in';
    applyProfileAvatar(user);
  } else {
    signedIn?.classList.add('hidden');
    signedOut?.classList.remove('hidden');
    settingsAccount?.classList.add('hidden');
    applyProfileAvatar(null);
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
}

async function handleSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  setSyncedUserId(null);
  updateAccountUI(null);
  window.dispatchEvent(new CustomEvent('auth-changed'));
}

export function initAuth() {
  const modal = document.getElementById('authModal');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const signUpBtn = document.getElementById('authSignUpBtn');
  const signOutBtn = document.getElementById('authSignOutBtn');
  const offlineBtn = document.getElementById('authOfflineBtn');
  const openAuthBtn = document.getElementById('openAuthBtn');
  const profileWrap = document.getElementById('profilePicWrap');
  const authClose = document.getElementById('authModalClose');

  openAuthBtn?.addEventListener('click', showAuthModal);
  profileWrap?.addEventListener('dblclick', (e) => {
    if (!supabaseConfigured) return;
    e.preventDefault();
    showAuthModal();
  });

  authClose?.addEventListener('click', hideAuthModal);
  offlineBtn?.addEventListener('click', hideAuthModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) hideAuthModal();
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = emailInput?.value?.trim();
    const password = passwordInput?.value;
    if (!email || !password) {
      setAuthStatus('Enter email and password.', true);
      return;
    }
    handleSignIn(email, password);
  });

  signUpBtn?.addEventListener('click', () => {
    const email = emailInput?.value?.trim();
    const password = passwordInput?.value;
    if (!email || !password) {
      setAuthStatus('Enter email and password.', true);
      return;
    }
    if (password.length < 6) {
      setAuthStatus('Password must be at least 6 characters.', true);
      return;
    }
    handleSignUp(email, password);
  });

  signOutBtn?.addEventListener('click', handleSignOut);
  document.getElementById('authSignOutBtnModal')?.addEventListener('click', handleSignOut);

  if (!supabaseConfigured) {
    document.getElementById('syncHint')?.classList.add('hidden');
    return;
  }

  supabase.auth.getSession().then(({ data: { session } }) => {
    setSyncedUserId(session?.user?.id ?? null);
    updateAccountUI(session?.user ?? null);
    if (!session?.user) showAuthModal();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    setSyncedUserId(session?.user?.id ?? null);
    updateAccountUI(session?.user ?? null);
  });
}

export function wireProfileUpload() {
  const wrap = document.getElementById('profilePicWrap');
  const img = document.getElementById('profilePic');
  const placeholder = document.getElementById('profilePlaceholder');
  const upload = document.getElementById('profileUpload');

  applyProfileAvatar(null);

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
