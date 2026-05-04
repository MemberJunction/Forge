# Apple App Signing & Developer Program — Step-by-Step Plan

**Date:** 2026-03-23
**Status:** Draft
**App ID:** `com.memberjunction.forge`

---

## Overview

MJ Forge currently builds unsigned macOS binaries. To distribute outside of direct developer-to-developer sharing (i.e., avoid the "app is damaged" / "unidentified developer" Gatekeeper warnings), we need:

1. An Apple Developer Program membership
2. A Developer ID signing certificate
3. Notarization with Apple's notary service
4. (Optional, future) Mac App Store distribution

This plan covers **Developer ID distribution** (direct download from GitHub Releases), which matches our current CI/CD pipeline.

---

## Current State

| Item | Status |
|------|--------|
| Hardened Runtime | Enabled in `electron-builder.yml` |
| Entitlements plist | Configured at `resources/entitlements.mac.plist` |
| Code signing identity | **Not configured** |
| Notarization | **Not configured** |
| Apple Developer account | **Not enrolled** |
| CI/CD (GitHub Actions) | Working — `.github/workflows/build-release.yml` |

---

## Part 1: Apple Developer Program Enrollment

### Step 1 — Create or use an Apple ID

- Go to [appleid.apple.com](https://appleid.apple.com) and create an Apple ID (or use an existing one).
- Enable **two-factor authentication** (required for the Developer Program).

### Step 2 — Enroll in the Apple Developer Program

- Go to [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/).
- Choose enrollment type:
  - **Individual** ($99/year) — if publishing under a personal name.
  - **Organization** ($99/year) — if publishing under a company name. Requires a D-U-N-S number (free to obtain from Dun & Bradstreet, takes 1-2 weeks).
- Complete enrollment and payment.
- Wait for Apple approval (usually 24-48 hours, sometimes longer for organizations).

### Step 3 — Note your Team ID

- Once enrolled, go to [developer.apple.com/account](https://developer.apple.com/account).
- Navigate to **Membership Details**.
- Record your **Team ID** (10-character alphanumeric string, e.g., `ABC1234DEF`). You'll need this for `electron-builder.yml`.

---

## Part 2: Create Signing Certificates

### Step 4 — Create a Developer ID Application certificate

This is the certificate used to sign apps distributed **outside** the Mac App Store.

**Option A — Via Xcode (easiest):**

1. Open Xcode → Settings → Accounts.
2. Select your Apple ID → your team.
3. Click **Manage Certificates**.
4. Click **+** → **Developer ID Application**.
5. Xcode creates the certificate and installs it in your Keychain.

**Option B — Via Apple Developer portal:**

1. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list).
2. Click **+** to create a new certificate.
3. Select **Developer ID Application**.
4. Follow the prompts to create a Certificate Signing Request (CSR) using Keychain Access:
   - Open **Keychain Access** → Certificate Assistant → Request a Certificate from a Certificate Authority.
   - Enter your email, select **Saved to disk**, and save the `.certSigningRequest` file.
5. Upload the CSR to the portal.
6. Download the resulting `.cer` file and double-click to install it in your Keychain.

### Step 5 — Verify the certificate is installed

```bash
security find-identity -v -p codesigning
```

You should see an entry like:

```
1) ABCDEF1234567890ABCDEF1234567890ABCDEF12 "Developer ID Application: Your Name (TEAMID)"
```

Record the full identity string — this is your **signing identity**.

### Step 6 — Export the certificate as .p12 (needed for CI)

1. Open **Keychain Access**.
2. Find your **Developer ID Application** certificate (under "My Certificates").
3. Right-click → **Export**.
4. Save as `.p12` format.
5. Set a strong password — you'll need this for CI.
6. Store the `.p12` file securely (e.g., 1Password, a secrets vault). **Never commit it to the repo.**

---

## Part 3: Configure Local Signing

### Step 7 — Update `electron-builder.yml`

Add the following to the `mac` section in `electron-builder.yml`:

```yaml
mac:
  category: public.app-category.developer-tools
  icon: resources/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  darkModeSupport: true
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: zip
      arch:
        - x64
        - arm64
  # Add these lines:
  identity: "Developer ID Application: YOUR NAME (TEAMID)"
  notarize: true
```

The `identity` field tells electron-builder which certificate to use. The `notarize: true` field enables automatic notarization (electron-builder v24+).

### Step 8 — Set up notarization credentials locally

electron-builder uses `@electron/notarize` under the hood. You need to provide Apple ID credentials via environment variables:

```bash
# Option A: App-specific password (recommended)
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABC1234DEF"
```

**To create an app-specific password:**

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In & Security → App-Specific Passwords.
2. Click **Generate** and name it (e.g., "MJ Forge Notarization").
3. Copy the generated password.

### Step 9 — Test a local signed build

```bash
npm run build
node scripts/prepare-package.js
npx electron-builder --mac --config electron-builder.yml
```

Verify the output:

```bash
# Check code signature
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/MJ Forge.app"

# Check notarization status
spctl --assess --type execute --verbose "release/mac-arm64/MJ Forge.app"

# Should output: accepted, source=Notarized Developer ID
```

---

## Part 4: Configure CI/CD Signing (GitHub Actions)

### Step 10 — Add secrets to GitHub repository

Go to your GitHub repo → Settings → Secrets and variables → Actions → **New repository secret** and add:

| Secret Name | Value |
|-------------|-------|
| `CSC_LINK` | Base64-encoded `.p12` certificate (see below) |
| `CSC_KEY_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from Step 8 |
| `APPLE_TEAM_ID` | Your 10-character Team ID |

**To base64-encode your .p12:**

```bash
base64 -i certificate.p12 -o certificate-base64.txt
# Copy the contents of certificate-base64.txt into the CSC_LINK secret
```

### Step 11 — Update the GitHub Actions workflow

Update `.github/workflows/build-release.yml` to pass signing/notarization secrets to electron-builder:

```yaml
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            build_flag: --mac
          - os: windows-latest
            build_flag: --win

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build
      - run: node scripts/prepare-package.js

      - name: Build Electron app
        run: npx electron-builder ${{ matrix.build_flag }} --config electron-builder.yml
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS signing & notarization (ignored on Windows runners)
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}

      - name: Upload artifacts
        uses: softprops/action-gh-release@v2
        with:
          files: |
            release/*.dmg
            release/*.zip
            release/*.exe
            release/*.blockmap
          fail_on_unmatched_files: false
```

### Step 12 — Test CI build

1. Create and push a new tag:
   ```bash
   git tag v0.3.3-beta.1
   git push origin v0.3.3-beta.1
   ```
2. Monitor the GitHub Actions run.
3. Download the resulting DMG from the GitHub Release.
4. On a **different Mac** (one that hasn't built the app), open the DMG and try to launch the app.
5. macOS should **not** show an "unidentified developer" warning.

---

## Part 5: Ongoing Maintenance

### Certificate renewal

- Developer ID Application certificates are valid for **5 years**.
- Set a calendar reminder to renew before expiration.
- When renewing, update the `CSC_LINK` secret in GitHub with the new `.p12`.

### Apple Developer Program renewal

- The $99/year membership must be renewed annually.
- If it lapses, your signing certificate still works, but you **cannot notarize new builds** or create new certificates.

### Entitlements review

Current entitlements in `resources/entitlements.mac.plist` are appropriate for an Electron app with Keychain and network access:

| Entitlement | Why |
|-------------|-----|
| `allow-jit` | V8 JIT compilation |
| `allow-unsigned-executable-memory` | Electron/Chromium requirement |
| `disable-library-validation` | Loading third-party native modules (keytar, etc.) |
| `network.client` | SQL Server connections, AI API calls |
| `network.server` | Electron dev server (could remove in prod if not needed) |
| `files.user-selected.read-write` | File open/save dialogs |
| `keychain-access-groups` | Credential storage |

---

## Quick Reference: Environment Variables

| Variable | Where Used | Purpose |
|----------|-----------|---------|
| `CSC_LINK` | CI only | Base64 .p12 certificate |
| `CSC_KEY_PASSWORD` | CI only | .p12 password |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Local (optional) | Set to `false` to skip signing locally |
| `APPLE_ID` | CI + local | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | CI + local | App-specific password for notarization |
| `APPLE_TEAM_ID` | CI + local | 10-char team identifier |

---

## Checklist

- [ ] Apple ID with 2FA enabled
- [ ] Apple Developer Program enrolled ($99/year)
- [ ] Team ID recorded
- [ ] Developer ID Application certificate created
- [ ] Certificate installed in local Keychain
- [ ] Certificate exported as .p12 for CI
- [ ] `electron-builder.yml` updated with identity and notarize fields
- [ ] App-specific password created for notarization
- [ ] Local signed build tested and verified
- [ ] GitHub secrets configured (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
- [ ] GitHub Actions workflow updated with signing env vars
- [ ] CI build tested with a beta tag
- [ ] Signed DMG verified on a clean Mac (no Gatekeeper warning)
