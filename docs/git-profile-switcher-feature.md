The Electron app "Super Bash" is already built. Add a Git Profile Switcher:

## Feature Overview
A quick-switch system for git identities — useful when working across personal projects,
client projects, and team projects that need different git user.name / user.email / signing keys.

## UI
1. A "profile switcher" button in the titlebar showing the currently active git profile name
   (e.g. "Rayyan – Personal"). Clicking it opens a small dropdown/modal listing all saved profiles.
2. Each profile entry shows: profile name, git username, and email.
3. Active profile is highlighted in amber. One-click to switch.
4. A "+" button to add a new profile and a trash icon to delete existing ones (cannot delete active).

## Profile Storage
- Profiles saved to ~/.superbash/git-profiles.json with this schema:
  {
    "active": "personal",
    "profiles": [
      {
        "id": "personal",
        "name": "Rayyan – Personal",
        "gitUser": "rayyan",
        "gitEmail": "rayyan@example.com",
        "signingKey": ""
      },
      {
        "id": "vyxo",
        "name": "Rayyan – Vyxo",
        "gitUser": "rayyan-vyxo",
        "gitEmail": "rayyan@vyxo.in",
        "signingKey": ""
      }
    ]
  }
- signingKey is optional — if provided, also set git config user.signingkey and gpg.program.

## Switching Behavior
When a profile is selected:
1. Run the following via child_process.exec in the main process (NOT global git config —
   use --global only if scope is set to global, otherwise default to --local on the active pane's cwd):
     git config user.name "<gitUser>"
     git config user.email "<gitEmail>"
     (git config user.signingkey "<signingKey>" if provided)
2. Support two scopes selectable per-switch via a small toggle in the modal:
   - Local (default) — applies only to the current repo (--local)
   - Global — applies system-wide (--global)
3. After switching, print a confirmation line in the active terminal pane in amber:
   "Git profile switched to: Rayyan – Vyxo (rayyan@vyxo.in) [local]"
4. Update the titlebar button label to reflect the newly active profile.

## Per-Project Auto-Switch (optional but ship it)
- Add an optional "gitProfile" key to the .superbash project file:
  { "gitProfile": "vyxo" }
- When a .superbash file with this key is detected (from Prompt 4's cwd watcher),
  automatically switch to that profile for that pane — no manual click needed.
- Print the same amber confirmation line so the user knows it happened.

## Preloaded Example
Ship git-profiles.json in /examples with 3 example profiles:
personal, agency (Vyxo), and client-template (placeholder).

## Notes
- All git commands run in main process via IPC, never in renderer directly.
- Do not touch tabs, command palette, git status bar, broadcast mode, or any other existing feature.
- Style the profile switcher modal to match the existing black-and-gold Super Bash theme.