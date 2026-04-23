(function () {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const overlay      = document.getElementById('settings-overlay');
  const btnSettings  = document.getElementById('btn-settings');
  const profileList  = document.getElementById('profile-list');
  const addForm      = document.getElementById('add-profile-form');
  const btnAdd       = document.getElementById('btn-add-profile');
  const btnSave      = document.getElementById('btn-save-profile');
  const btnCancel    = document.getElementById('btn-cancel-profile');
  const inpName      = document.getElementById('add-profile-name');
  const inpUser      = document.getElementById('add-profile-user');
  const inpEmail     = document.getElementById('add-profile-email');
  const inpKey       = document.getElementById('add-profile-key');
  const scopeRadios  = document.querySelectorAll('input[name="scope"]');

  // ── State ─────────────────────────────────────────────────────────────────
  let _data = { active: null, lastScope: 'local', profiles: [] };

  // ── Open / close ──────────────────────────────────────────────────────────
  async function openModal() {
    _data = await window.electronAPI.gitProfileList();
    renderProfileList();
    restoreScopeToggle();
    addForm.classList.add('hidden');
    overlay.classList.remove('hidden');
    overlay.focus();
  }

  function closeModal() {
    overlay.classList.add('hidden');
  }

  // ── Render profile list ───────────────────────────────────────────────────
  function renderProfileList() {
    profileList.innerHTML = '';
    if (_data.profiles.length === 0) {
      profileList.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px 10px;">No profiles yet. Click + to add one.</div>';
      return;
    }
    for (const profile of _data.profiles) {
      const isActive = profile.id === _data.active;
      const row = document.createElement('div');
      row.className = 'profile-row' + (isActive ? ' active' : '');
      row.dataset.profileId = profile.id;

      const info = document.createElement('div');
      info.className = 'profile-row-info';
      info.innerHTML = `
        <div class="profile-row-name">${escHtml(profile.name)}</div>
        <div class="profile-row-meta">${escHtml(profile.gitUser)} · ${escHtml(profile.gitEmail)}</div>
      `;

      const del = document.createElement('button');
      del.className = 'profile-row-delete';
      del.title = 'Delete profile';
      del.textContent = '🗑';
      if (isActive) del.style.display = 'none';

      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteProfile(profile.id);
      });

      if (!isActive) {
        row.addEventListener('click', () => switchProfile(profile.id));
      }

      row.appendChild(info);
      row.appendChild(del);
      profileList.appendChild(row);
    }
  }

  // ── Scope toggle ──────────────────────────────────────────────────────────
  function restoreScopeToggle() {
    for (const r of scopeRadios) {
      r.checked = r.value === (_data.lastScope || 'local');
    }
  }

  function getSelectedScope() {
    for (const r of scopeRadios) {
      if (r.checked) return r.value;
    }
    return 'local';
  }

  // ── Switch profile ────────────────────────────────────────────────────────
  async function switchProfile(profileId) {
    const scope = getSelectedScope();

    const cwdEvent = new CustomEvent('requestActiveCwd', { bubbles: true, detail: { resolve: null } });
    let cwd = '';
    cwdEvent.detail.resolve = (v) => { cwd = v; };
    document.dispatchEvent(cwdEvent);

    const result = await window.electronAPI.gitProfileSwitch({ profileId, scope, cwd });

    if (result.ok) {
      _data.active    = profileId;
      _data.lastScope = scope;
      updateSettingsBtn(result.profile.name);
      renderProfileList();
    }

    document.dispatchEvent(new CustomEvent('gitProfileSwitched', { detail: result }));

    if (result.ok) closeModal();
  }

  // ── Delete profile ────────────────────────────────────────────────────────
  async function deleteProfile(profileId) {
    _data.profiles = _data.profiles.filter(p => p.id !== profileId);
    await window.electronAPI.gitProfileSave(_data);
    renderProfileList();
  }

  // ── Update titlebar button label ──────────────────────────────────────────
  function updateSettingsBtn(profileName) {
    btnSettings.textContent = profileName ? `⚙ ${profileName}` : '⚙ Settings';
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  btnSettings.addEventListener('click', openModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
  });

  // ── Add form ──────────────────────────────────────────────────────────────
  btnAdd.addEventListener('click', () => {
    addForm.classList.toggle('hidden');
    if (!addForm.classList.contains('hidden')) inpName.focus();
  });

  btnCancel.addEventListener('click', () => {
    addForm.classList.add('hidden');
    clearAddForm();
  });

  btnSave.addEventListener('click', saveNewProfile);

  addForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveNewProfile();
    if (e.key === 'Escape') {
      addForm.classList.add('hidden');
      clearAddForm();
    }
  });

  async function saveNewProfile() {
    const name  = inpName.value.trim();
    const user  = inpUser.value.trim();
    const email = inpEmail.value.trim();
    const key   = inpKey.value.trim();

    if (!name || !user || !email) return;

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const profile = { id, name, gitUser: user, gitEmail: email, signingKey: key };

    _data.profiles.push(profile);
    await window.electronAPI.gitProfileSave(_data);
    clearAddForm();
    addForm.classList.add('hidden');
    renderProfileList();
  }

  function clearAddForm() {
    inpName.value = inpUser.value = inpEmail.value = inpKey.value = '';
  }

  // ── Init: load active profile name into titlebar button ───────────────────
  window.electronAPI.gitProfileList().then((data) => {
    _data = data;
    const active = data.profiles.find(p => p.id === data.active);
    if (active) updateSettingsBtn(active.name);
  });

})();
