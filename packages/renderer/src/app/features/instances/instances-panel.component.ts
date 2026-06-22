import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { DevPersona, InstanceConfig, SetupStep } from '@mj-forge/shared';
import { InstancesStateService } from '../../core/state/instances.state';
import { IdentityStateService } from '../../core/state/identity.state';
import { OpenAppsStateService } from '../../core/state/open-apps.state';

/** One editable row in the dev-link dependency prompt. */
interface DepRow {
  name: string;
  versionRange: string;
  /** How to satisfy it: plain install (default) or dev-link. */
  mode: 'installed' | 'dev';
  /** GitHub URL (or local path) to satisfy it from (prefilled from the manifest). */
  source: string;
}

interface CreateForm {
  name: string;
  branch: string;
  baseRef: string;
  /** The instance's single open-app mode (dev-link primary, install for consume-only). */
  appMode: 'dev' | 'installed';
}

/** Inputs for adding a new Open App (dev-link or plain install). */
interface LinkForm {
  /** GitHub URL or local path to the app. */
  appRef: string;
  /** How to add it: `dev` = dev-link local source; `installed` = plain `mj app install`. */
  mode: 'dev' | 'installed';
  /** Bypass the app's MJ version-range check when dev-linking (dev mode only). */
  ignoreVersionRange: boolean;
  /** Allow a reserved `__`-prefixed schema on install (first-party MJ apps; install mode only). */
  allowDoubleUnderscore: boolean;
}

interface PersonaForm {
  name: string;
  /** Local part of the dev email (before the @). */
  emailLocal: string;
  /** Domain part — locked to the enforced dev domain until the user overrides. */
  emailDomain: string;
  /** True once the user has acknowledged the override modal and edited the domain. */
  domainUnlocked: boolean;
  roles: string;
}

/**
 * Enforced dev email domain. Non-routable `.local` so a leaked persona row can
 * never authenticate against a real IdP (see the dev-identity security model).
 */
const DEV_EMAIL_DOMAIN = 'mjdev.local';

/**
 * MJ Dev Manager — the full Instances control panel: list, detail/control
 * panel with staged setup actions, service launcher, running-process tracker,
 * and a live event log. Used both as the `/instances` route and inside a dialog.
 */
@Component({
  selector: 'app-instances-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressBarModule,
  ],
  template: `
    <div class="mjdev">
      <!-- ── Left: instance list ─────────────────────────────── -->
      <aside class="list">
        <header>
          <h2>
            Instances <span class="count">{{ state.runningCount() }} running</span>
          </h2>
          <button mat-icon-button matTooltip="New instance" (click)="toggleCreate()">
            <mat-icon>add</mat-icon>
          </button>
        </header>

        <!-- Active developer identity (Phase 2) -->
        <div class="identity-bar">
          <label class="who">
            <span>Identity</span>
            <select
              [ngModel]="identity.activePersona()?.id || ''"
              (ngModelChange)="setActivePersona($event)"
              name="activePersona"
            >
              @for (p of identity.personas(); track p.id) {
                <option [value]="p.id">{{ p.name }} ({{ p.email }})</option>
              } @empty {
                <option value="" disabled>No personas yet</option>
              }
            </select>
          </label>
          <button mat-icon-button matTooltip="Manage personas" (click)="toggleManagePersonas()">
            <mat-icon>manage_accounts</mat-icon>
          </button>
        </div>

        @if (managingPersonas()) {
          <div class="persona-manage">
            <ul class="persona-list">
              @for (p of identity.personas(); track p.id) {
                <li>
                  <span
                    >{{ p.name }} <small>{{ p.email }}</small></span
                  >
                  <button mat-icon-button matTooltip="Delete" (click)="confirmDeletePersona(p)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </li>
              }
            </ul>
            <form class="create" (ngSubmit)="submitPersona()">
              <h3>Add persona</h3>
              <label
                >Name<input
                  [(ngModel)]="personaForm.name"
                  name="pname"
                  placeholder="Admin"
                  required
              /></label>
              <label class="email-label">
                Email
                <div class="email-row">
                  <input
                    class="email-local"
                    [(ngModel)]="personaForm.emailLocal"
                    name="pemaillocal"
                    placeholder="admin"
                    required
                  />
                  <span class="at">&#64;</span>
                  @if (personaForm.domainUnlocked) {
                    <input
                      class="email-domain"
                      [(ngModel)]="personaForm.emailDomain"
                      name="pemaildomain"
                      [placeholder]="devEmailDomain"
                      required
                    />
                  } @else {
                    <span class="email-domain locked">{{ devEmailDomain }}</span>
                    <button
                      mat-icon-button
                      type="button"
                      class="domain-edit"
                      matTooltip="Use a different email domain (advanced)"
                      (click)="requestEmailOverride()"
                    >
                      <mat-icon>edit</mat-icon>
                    </button>
                  }
                </div>
              </label>
              <label
                >Roles <small>(comma-separated)</small
                ><input [(ngModel)]="personaForm.roles" name="proles" placeholder="Owner"
              /></label>
              <div class="row">
                <button
                  mat-flat-button
                  color="primary"
                  type="submit"
                  [disabled]="!personaForm.name || !personaForm.emailLocal || identity.busy()"
                >
                  Add persona
                </button>
              </div>
              <p class="hint">
                Dev users (not real accounts). Use <code>Owner</code> for full access, or names like
                <code>Developer, UI</code> to test limited roles.
              </p>
            </form>
          </div>
        }

        @if (showEmailOverrideModal()) {
          <div class="modal-backdrop" (click)="cancelEmailOverride()">
            <div class="modal" (click)="$event.stopPropagation()">
              <h3>Use a non-dev email domain?</h3>
              <p>
                Dev personas default to <code>&#64;{{ devEmailDomain }}</code
                >, a non-routable address that can never authenticate against a production identity
                provider.
              </p>
              <p class="warn">
                Dev credentials that align with <strong>real</strong> emails can be authenticated
                against a production IdP.
                <strong>Never sync dev credentials into metadata or migrations.</strong>
              </p>
              <label>
                Type <code>I understand</code> to continue
                <input
                  [(ngModel)]="overrideConfirmText"
                  name="overrideconfirm"
                  placeholder="I understand"
                  autocomplete="off"
                />
              </label>
              <div class="row">
                <button
                  mat-flat-button
                  color="warn"
                  type="button"
                  [disabled]="!overrideConfirmed"
                  (click)="acceptEmailOverride()"
                >
                  I understand
                </button>
                <button mat-button type="button" (click)="cancelEmailOverride()">Cancel</button>
              </div>
            </div>
          </div>
        }

        @if (creating()) {
          <form class="create" (ngSubmit)="submitCreate()">
            <h3>New instance</h3>
            <label
              >Name<input [(ngModel)]="form.name" name="name" placeholder="feature-x" required
            /></label>
            <label
              >Branch <small>(optional)</small
              ><input [(ngModel)]="form.branch" name="branch" placeholder="feature/x"
            /></label>
            <label
              >Base ref <small>(for new branch)</small
              ><input [(ngModel)]="form.baseRef" name="baseRef" placeholder="HEAD"
            /></label>
            <label
              >Open-app mode
              <select [(ngModel)]="form.appMode" name="appMode">
                <option value="dev">Dev-link — develop apps from local source</option>
                <option value="installed">Install — consume published apps</option>
              </select>
            </label>
            <div class="row">
              <button
                mat-flat-button
                color="primary"
                type="submit"
                [disabled]="!form.name || state.busy()"
              >
                Provision
              </button>
              <button mat-button type="button" (click)="toggleCreate()">Cancel</button>
            </div>
            <p class="hint">
              Provisions a SQL container, git worktree, and config. Heavy setup runs afterward.
              {{
                form.appMode === 'dev'
                  ? ' Apps will be dev-linked (editable source) — the primary mode.'
                  : ' Apps will be installed from published releases (consume-only).'
              }}
            </p>
          </form>
        }

        <ul>
          @for (i of state.instances(); track i.slug) {
            <li [class.active]="i.slug === state.selectedSlug()" (click)="selectInstance(i.slug)">
              <span class="dot" [class]="i.status"></span>
              <div class="meta">
                <strong>{{ i.name }}</strong>
                <small>{{ i.branch }} · API :{{ i.ports.api }}</small>
              </div>
              <mat-icon
                class="mode-icon"
                [matTooltip]="
                  (i.appMode ?? 'dev') === 'installed'
                    ? 'Install mode — consumes published apps'
                    : 'Dev-link mode — develops apps from local source'
                "
                >{{ (i.appMode ?? 'dev') === 'installed' ? 'inventory_2' : 'link' }}</mat-icon
              >
            </li>
          } @empty {
            <li class="empty">No instances yet. Click + to create one.</li>
          }
        </ul>
      </aside>

      <!-- ── Right: detail / control panel ───────────────────── -->
      <section class="detail">
        @if (state.selected(); as inst) {
          <header class="detail-head">
            <div>
              <h2>
                {{ inst.name }}
                <span class="status-pill" [class]="inst.status">{{ inst.status }}</span>
              </h2>
              <code>{{ inst.worktreePath }}</code>
            </div>
            <div class="actions">
              <button mat-stroked-button (click)="state.openInVSCode(inst.slug)">
                <mat-icon>code</mat-icon> VS Code
              </button>
              @if (inst.status === 'running') {
                <button
                  mat-stroked-button
                  (click)="state.stop(inst.slug)"
                  [disabled]="state.busy()"
                >
                  <mat-icon>stop</mat-icon> Stop
                </button>
              } @else {
                <button
                  mat-stroked-button
                  (click)="state.start(inst.slug)"
                  [disabled]="state.busy()"
                >
                  <mat-icon>play_arrow</mat-icon> Start
                </button>
              }
              <button
                mat-stroked-button
                color="warn"
                (click)="confirmDelete(inst.slug)"
                [disabled]="state.busy()"
              >
                <mat-icon>delete</mat-icon> Delete
              </button>
            </div>
          </header>

          @if (state.busy()) {
            <mat-progress-bar mode="indeterminate" />
          }

          <!-- Post-provision "run full setup" prompt -->
          @if (showSetupPrompt() && state.pendingSetup().length) {
            <div class="banner">
              <mat-icon>rocket_launch</mat-icon>
              <span
                >Instance provisioned. Run the full setup (deps → migrate → codegen → build)
                now?</span
              >
              <button mat-flat-button color="primary" (click)="runFull(inst.slug)">
                Run full setup
              </button>
              <button mat-button (click)="showSetupPrompt.set(false)">Dismiss</button>
            </div>
          }

          <div class="grid">
            <!-- Ports / connection -->
            <div class="card">
              <h3>Ports &amp; connection</h3>
              <dl>
                <dt>SQL Server</dt>
                <dd>localhost:{{ inst.ports.sql }}</dd>
                <dt>MJAPI</dt>
                <dd>localhost:{{ inst.ports.api }}</dd>
                <dt>MJExplorer</dt>
                <dd>localhost:{{ inst.ports.explorer }}</dd>
                <dt>Database</dt>
                <dd>{{ inst.dbName }}</dd>
                <dt>Container</dt>
                <dd>{{ inst.container.name }}</dd>
              </dl>
            </div>

            <!-- Identity (Phase 2) -->
            <div class="card">
              <h3>Identity</h3>
              <label class="who">
                <span>Acts as</span>
                <select
                  [ngModel]="inst.personaId || ''"
                  (ngModelChange)="changeInstancePersona(inst.slug, $event)"
                  name="instPersona"
                >
                  <option value="">
                    Use active ({{ identity.activePersona()?.name || 'none' }})
                  </option>
                  @for (p of identity.personas(); track p.id) {
                    <option [value]="p.id">{{ p.name }} ({{ p.email }})</option>
                  }
                </select>
              </label>
              <div class="row wrap">
                <button
                  mat-flat-button
                  color="primary"
                  (click)="identity.openExplorer(inst.slug)"
                  [disabled]="identity.busy()"
                >
                  <mat-icon>open_in_browser</mat-icon> Open Explorer as…
                </button>
                <button
                  mat-stroked-button
                  (click)="identity.copyApiKey(inst.slug)"
                  [disabled]="identity.busy()"
                >
                  <mat-icon>key</mat-icon> Copy API key
                </button>
              </div>
              <p class="hint">
                Open Explorer needs MJAPI running. The API key is for CLI/agents
                (<code>x-api-key</code>).
              </p>

              <!-- App access (per persona; default-on, faithful to prod) -->
              <button
                mat-button
                class="app-access-toggle"
                (click)="toggleAppAccessPanel(inst.slug)"
                [disabled]="identity.busy()"
              >
                <mat-icon>apps</mat-icon>
                {{ identity.appAccess()?.slug === inst.slug ? 'Hide app access' : 'App access…' }}
              </button>
              @if (identity.appAccess()?.slug === inst.slug) {
                <div class="app-list">
                  @for (a of identity.appAccess()!.apps; track a.name) {
                    <label class="app-row">
                      <input
                        type="checkbox"
                        [checked]="a.granted"
                        [disabled]="identity.busy()"
                        (change)="
                          identity.toggleAppAccess(inst.slug, a.name, $any($event.target).checked)
                        "
                      />
                      <span>{{ a.name }}</span>
                    </label>
                  } @empty {
                    <p class="hint">No apps found (is the instance migrated?).</p>
                  }
                  <p class="hint">
                    Granted apps apply to this persona everywhere; default is all on.
                  </p>
                </div>
              }
            </div>

            <!-- Setup steps -->
            <div class="card">
              <h3>
                Setup
                <button
                  mat-button
                  color="primary"
                  class="full"
                  (click)="runFull(inst.slug)"
                  [disabled]="state.busy() || !state.pendingSetup().length"
                >
                  Run full setup
                </button>
              </h3>
              <ul class="steps">
                @for (step of steps; track step.key) {
                  <li>
                    <mat-icon class="{{ done(step.key) ? 'ok' : 'pending' }}">{{
                      done(step.key) ? 'check_circle' : 'radio_button_unchecked'
                    }}</mat-icon>
                    <span>{{ step.label }}</span>
                    <button
                      mat-button
                      (click)="state.runSetup(inst.slug, step.key)"
                      [disabled]="state.busy()"
                    >
                      Run
                    </button>
                  </li>
                }
              </ul>
            </div>

            <!-- Launcher -->
            <div class="card">
              <h3>Launcher</h3>
              <div class="row wrap">
                <button
                  mat-flat-button
                  color="primary"
                  (click)="state.startProcess(inst.slug, 'api')"
                >
                  <mat-icon>dns</mat-icon> MJAPI :{{ inst.ports.api }}
                </button>
                <button mat-flat-button (click)="state.startProcess(inst.slug, 'explorer')">
                  <mat-icon>web</mat-icon> MJExplorer :{{ inst.ports.explorer }}
                </button>
                <button mat-stroked-button [matMenuTriggerFor]="runMenu">
                  <mat-icon>play_circle</mat-icon> Run… <mat-icon>arrow_drop_down</mat-icon>
                </button>
                <mat-menu #runMenu="matMenu">
                  @for (s of state.scripts(); track s) {
                    <button mat-menu-item (click)="state.startProcess(inst.slug, { script: s })">
                      {{ s }}
                    </button>
                  } @empty {
                    <button mat-menu-item disabled>No scripts (install deps first)</button>
                  }
                </mat-menu>
              </div>
            </div>

            <!-- Running processes -->
            <div class="card">
              <h3>
                Running
                <button mat-icon-button (click)="state.refreshProcesses()">
                  <mat-icon>refresh</mat-icon>
                </button>
              </h3>
              <ul class="procs">
                @for (p of state.processes(); track p.id) {
                  <li>
                    <span class="dot" [class]="p.status"></span>
                    <span class="pl">{{ p.label }}</span>
                    <span class="port">{{ p.port ? ':' + p.port : '' }}</span>
                    <span class="pid">{{ p.status }}{{ p.pid ? ' · pid ' + p.pid : '' }}</span>
                    @if (p.status === 'running' || p.status === 'starting') {
                      <button mat-icon-button (click)="state.stopProcess(p.id)" matTooltip="Stop">
                        <mat-icon>stop</mat-icon>
                      </button>
                      <button
                        mat-icon-button
                        (click)="state.restartProcess(p.id)"
                        matTooltip="Restart"
                      >
                        <mat-icon>restart_alt</mat-icon>
                      </button>
                    } @else {
                      <button
                        mat-icon-button
                        (click)="state.restartProcess(p.id)"
                        matTooltip="Start"
                      >
                        <mat-icon>play_arrow</mat-icon>
                      </button>
                      <button
                        mat-icon-button
                        (click)="state.removeProcess(p.id)"
                        matTooltip="Remove"
                      >
                        <mat-icon>close</mat-icon>
                      </button>
                    }
                  </li>
                } @empty {
                  <li class="empty">Nothing running.</li>
                }
              </ul>
            </div>

            <!-- Open Apps (Phase B) — dev-link external apps for development -->
            <div class="card open-apps">
              <h3>
                Open Apps
                <button
                  mat-icon-button
                  matTooltip="Refresh linked apps"
                  (click)="openApps.refresh(inst.slug)"
                  [disabled]="openApps.busy()"
                >
                  <mat-icon>refresh</mat-icon>
                </button>
              </h3>

              <!-- Add an app in the INSTANCE's mode (single-mode topology). The
                   cross-mode override is tucked into Advanced, below. -->
              <form class="link-form" (ngSubmit)="submitLink(inst.slug)">
                <p class="mode-note">
                  <mat-icon>{{
                    (inst.appMode ?? 'dev') === 'installed' ? 'inventory_2' : 'link'
                  }}</mat-icon>
                  <span
                    >{{ (inst.appMode ?? 'dev') === 'installed' ? 'Install' : 'Dev-link' }} instance
                    — apps are added in
                    {{ (inst.appMode ?? 'dev') === 'installed' ? 'install' : 'dev-link' }}
                    mode.</span
                  >
                </p>
                <label
                  >App URL{{ linkForm.mode === 'dev' ? ' or local path' : '' }}
                  <input
                    [(ngModel)]="linkForm.appRef"
                    name="appRef"
                    [placeholder]="
                      linkForm.mode === 'dev'
                        ? 'https://github.com/org/app or /path/to/app'
                        : 'https://github.com/org/app'
                    "
                    list="open-app-recents"
                    autocomplete="off"
                  />
                  @if (openApps.recents().length) {
                    <datalist id="open-app-recents">
                      @for (r of openApps.recents(); track r) {
                        <option [value]="r"></option>
                      }
                    </datalist>
                  }
                </label>
                @if (linkForm.mode === 'dev') {
                  <label
                    class="inline"
                    matTooltip="Bypass the app's declared mjVersionRange check. Use only for off-tag development — when this instance's MJ version is outside the range the app declares it supports — to dev-link it anyway. Leave off normally; an incompatible MJ can cause runtime errors."
                  >
                    <input
                      type="checkbox"
                      [(ngModel)]="linkForm.ignoreVersionRange"
                      name="ignoreVersionRange"
                    />
                    <span>Ignore version range</span>
                  </label>
                }
                <label
                  class="inline"
                  matTooltip="Required for first-party MJ apps (e.g. bizapps-*) that use a reserved __mj_ schema"
                >
                  <input
                    type="checkbox"
                    [(ngModel)]="linkForm.allowDoubleUnderscore"
                    name="allowDoubleUnderscore"
                  />
                  <span>Allow reserved <code>__</code> schema</span>
                </label>
                <div class="row">
                  <button
                    mat-flat-button
                    color="primary"
                    type="submit"
                    [disabled]="!linkForm.appRef.trim() || openApps.busy()"
                  >
                    @if (linkForm.mode === 'dev') {
                      <mat-icon>link</mat-icon> Link app for development
                    } @else {
                      <mat-icon>download</mat-icon> Install app
                    }
                  </button>
                </div>
                <p class="hint">
                  {{
                    linkForm.mode === 'dev'
                      ? 'Dev-link runs the app from editable local source (edit → see it live).'
                      : 'Install pulls the published release + its open-app dependencies — for apps you only consume.'
                  }}
                </p>
                <details class="advanced">
                  <summary>Advanced</summary>
                  <label
                    >Add-mode override
                    <select [(ngModel)]="linkForm.mode" name="addMode">
                      <option value="dev">Dev-link</option>
                      <option value="installed">Install</option>
                    </select>
                  </label>
                  @if (linkForm.mode !== (inst.appMode ?? 'dev')) {
                    <p class="dep-warn">
                      ⚠ This differs from the instance's
                      <strong>{{
                        (inst.appMode ?? 'dev') === 'installed' ? 'install' : 'dev-link'
                      }}</strong>
                      mode. Mixing dev-link + install in one instance crashes npm's resolver
                      (requires <code>--legacy-peer-deps</code>) and is
                      <strong>completely unsupported</strong>. Use only if you know what you're
                      doing.
                    </p>
                  }
                </details>
              </form>

              @if (openApps.busy()) {
                <mat-progress-bar mode="indeterminate" />
              }

              <!-- Currently dev-linked apps -->
              <ul class="linked-list">
                @for (a of openAppsFor(inst.slug); track a.appName) {
                  <li>
                    <div class="linked-head">
                      <span class="mode-pill" [class]="a.mode">{{ a.mode }}</span>
                      <strong class="app-name">{{ a.appName }}</strong>
                      <span class="branch">{{ a.linkedBranch || '—' }}</span>
                      @if (a.ignoreVersionRangeUsed) {
                        <span
                          class="ver-badge"
                          matTooltip="Linked with version-range check bypassed"
                          >ver override</span
                        >
                      }
                    </div>
                    <div class="row wrap linked-actions">
                      @if (a.mode === 'dev') {
                        <button
                          mat-stroked-button
                          matTooltip="Switch this app's resolution mode (confirmation required — can create an unsupported mixed instance)"
                          (click)="
                            confirmSwitchMode(
                              inst.slug,
                              a.appName,
                              a.mode === 'dev' ? 'installed' : 'dev',
                              inst.appMode ?? 'dev'
                            )
                          "
                          [disabled]="openApps.busy()"
                        >
                          <mat-icon>swap_horiz</mat-icon>
                          {{ a.mode === 'dev' ? 'Use installed' : 'Use dev' }}
                        </button>
                        <button
                          mat-button
                          matTooltip="Validate schema against migrations"
                          (click)="openApps.drift(inst.slug, a.appName)"
                          [disabled]="openApps.busy()"
                        >
                          <mat-icon>fact_check</mat-icon> Check drift
                        </button>
                        <button
                          mat-button
                          matTooltip="Re-stamp migration tracking (no SQL re-run)"
                          (click)="confirmRepairSchema(inst.slug, a.appName)"
                          [disabled]="openApps.busy()"
                        >
                          <mat-icon>build</mat-icon> Repair schema
                        </button>
                        <button
                          mat-button
                          color="warn"
                          matTooltip="Drop and rebuild the schema from migrations (drops app data)"
                          (click)="confirmResetSchema(inst.slug, a.appName)"
                          [disabled]="openApps.busy()"
                        >
                          <mat-icon>restart_alt</mat-icon> Reset schema
                        </button>
                        <button
                          mat-button
                          color="warn"
                          (click)="confirmUnlink(inst.slug, a.appName)"
                          [disabled]="openApps.busy()"
                        >
                          <mat-icon>link_off</mat-icon> Unlink
                        </button>
                      } @else {
                        <button
                          mat-button
                          color="warn"
                          matTooltip="Uninstall this app (reverses the install; drops its schema + data unless kept)"
                          (click)="confirmRemove(inst.slug, a.appName)"
                          [disabled]="openApps.busy()"
                        >
                          <mat-icon>delete</mat-icon> Remove
                        </button>
                      }
                    </div>
                  </li>
                } @empty {
                  <li class="empty">No apps linked or installed yet.</li>
                }
              </ul>

              <!-- Live progress strip fed by app-* engine events -->
              @if (openApps.progress().length) {
                <div class="progress-strip">
                  @for (e of openApps.progress(); track $index) {
                    <div class="line {{ e.level }}">[{{ e.op }}] {{ e.message }}</div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Event log -->
          <div class="card log">
            <h3>Activity <button mat-button (click)="state.clearLog()">Clear</button></h3>
            <div class="log-lines" #logLines>
              @for (e of state.log(); track $index) {
                <div class="line {{ e.level }}">[{{ e.op }}] {{ e.message }}</div>
              }
            </div>
          </div>
        } @else {
          <div class="placeholder">
            <mat-icon>dashboard</mat-icon>
            <p>Select an instance, or create a new one.</p>
          </div>
        }
      </section>

      <!-- Unlink confirmation (with optional schema/data drop) -->
      @if (unlinkTarget(); as t) {
        <div class="modal-backdrop" (click)="cancelUnlink()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h3>Unlink "{{ t.appName }}"?</h3>
            <p>
              This stops developing <code>{{ t.appName }}</code> against instance
              <code>{{ t.slug }}</code> and restores it to its installed state.
            </p>
            <label class="inline">
              <input type="checkbox" [(ngModel)]="unlinkDropSchema" name="unlinkDropSchema" />
              <span>Also drop the app's schema and data</span>
            </label>
            @if (unlinkDropSchema) {
              <p class="warn">
                <strong>Destructive:</strong> the app's tables and all data in this instance will be
                permanently deleted.
              </p>
            }
            <div class="row">
              <button
                mat-flat-button
                [color]="unlinkDropSchema ? 'warn' : 'primary'"
                type="button"
                [disabled]="openApps.busy()"
                (click)="acceptUnlink()"
              >
                Unlink
              </button>
              <button mat-button type="button" (click)="cancelUnlink()">Cancel</button>
            </div>
          </div>
        </div>
      }

      <!-- Dev-link dependency prompt: choose install/dev-link for each missing dep -->
      @if (depPrompt(); as p) {
        <div class="modal-backdrop" (click)="cancelDepPrompt()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h3>"{{ p.appName }}" needs other apps</h3>
            <p>
              These open apps aren't in this instance yet. They'll be
              <strong>dev-linked alongside</strong> <code>{{ p.appName }}</code> (recommended —
              keeps the instance a consistent dev-link closure and lets you fix them if needed).
            </p>
            <ul class="dep-list">
              @for (d of p.deps; track d.name) {
                <li>
                  <div class="dep-head">
                    <strong>{{ d.name }}</strong> <span class="dep-ver">{{ d.versionRange }}</span>
                  </div>
                  <div class="dep-row">
                    <select [(ngModel)]="d.mode" name="depmode-{{ d.name }}">
                      <option value="dev">Dev-link (recommended)</option>
                      <option value="installed">Install (advanced)</option>
                    </select>
                    <input
                      [(ngModel)]="d.source"
                      name="depsrc-{{ d.name }}"
                      placeholder="https://github.com/org/app"
                      autocomplete="off"
                    />
                  </div>
                  @if (d.mode === 'installed') {
                    <p class="dep-warn">
                      ⚠ Installing a dependency of a dev-linked app creates a
                      <strong>mixed instance</strong>, which crashes npm's resolver. It requires the
                      <code>--legacy-peer-deps</code> escape hatch and is
                      <strong>completely unsupported</strong>. Only proceed if you know what you're
                      doing.
                    </p>
                  }
                </li>
              }
            </ul>
            @if (depPromptIncomplete) {
              <p class="hint">Every dependency needs a source URL.</p>
            }
            <div class="row">
              <button
                mat-flat-button
                color="primary"
                type="button"
                [disabled]="depPromptIncomplete || openApps.busy()"
                (click)="confirmDepPrompt()"
              >
                Add dependencies &amp; link
              </button>
              <button mat-button type="button" (click)="cancelDepPrompt()">Cancel</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        color: var(--text-primary, #ddd);
      }
      .mjdev {
        display: grid;
        grid-template-columns: 280px 1fr;
        height: 100%;
        min-height: 480px;
      }
      .list {
        border-right: 1px solid var(--border-color, #333);
        display: flex;
        flex-direction: column;
        overflow: auto;
      }
      .list header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
      }
      .list h2 {
        font-size: 14px;
        margin: 0;
      }
      .count {
        font-weight: normal;
        color: var(--text-secondary, #999);
        font-size: 11px;
        margin-left: 6px;
      }
      .list ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .list li {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
      }
      .list li.active {
        background: var(--bg-hover, #2a2d2e);
      }
      .list li.empty {
        color: var(--text-secondary, #888);
        font-size: 12px;
        cursor: default;
      }
      .meta {
        display: flex;
        flex-direction: column;
      }
      .meta small {
        color: var(--text-secondary, #999);
        font-size: 11px;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #777;
        flex: 0 0 auto;
      }
      .dot.running {
        background: #3fb950;
      }
      .dot.error {
        background: #f85149;
      }
      .dot.stopped {
        background: #777;
      }
      .dot.provisioning {
        background: #d29922;
      }
      .dot.starting {
        background: #d29922;
      }
      .create {
        padding: 12px;
        border-bottom: 1px solid var(--border-color, #333);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .create h3 {
        margin: 0;
        font-size: 13px;
      }
      .create label {
        display: flex;
        flex-direction: column;
        font-size: 12px;
        gap: 2px;
      }
      .create input {
        background: var(--bg-input, #1e1e1e);
        border: 1px solid var(--border-color, #444);
        color: inherit;
        padding: 6px;
        border-radius: 4px;
      }
      .create .hint,
      .hint {
        color: var(--text-secondary, #888);
        font-size: 11px;
        margin: 0;
      }
      .identity-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-color, #333);
      }
      .who {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 11px;
        flex: 1;
        color: var(--text-secondary, #888);
      }
      .who select {
        background: var(--bg-input, #1e1e1e);
        border: 1px solid var(--border-color, #444);
        color: var(--text-primary, #eee);
        padding: 5px;
        border-radius: 4px;
        font-size: 12px;
      }
      .persona-manage {
        border-bottom: 1px solid var(--border-color, #333);
      }
      .persona-list {
        list-style: none;
        margin: 0;
        padding: 4px 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .persona-list li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
      }
      .persona-list small {
        color: var(--text-secondary, #888);
        margin-left: 4px;
      }
      .detail {
        overflow: auto;
        padding: 16px;
      }
      .detail-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
      }
      .detail-head h2 {
        margin: 0 0 4px;
        font-size: 18px;
      }
      .detail-head code {
        color: var(--text-secondary, #999);
        font-size: 12px;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .status-pill,
      .status-pill.running {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: #30363d;
        text-transform: capitalize;
      }
      .status-pill.running {
        background: #1f6f33;
      }
      .status-pill.error {
        background: #6e2b27;
      }
      .status-pill.provisioning {
        background: #6e5611;
      }
      .banner {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--bg-hover, #20303f);
        border: 1px solid #2f5d88;
        border-radius: 6px;
        padding: 10px 12px;
        margin: 12px 0;
      }
      .banner span {
        flex: 1;
        font-size: 13px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
        margin-top: 12px;
      }
      .card {
        border: 1px solid var(--border-color, #333);
        border-radius: 6px;
        padding: 12px;
      }
      .card h3 {
        margin: 0 0 8px;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .card .full {
        font-size: 11px;
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
        margin: 0;
        font-size: 12px;
      }
      dt {
        color: var(--text-secondary, #999);
      }
      dd {
        margin: 0;
        font-family: monospace;
      }
      .steps,
      .procs {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .steps li,
      .procs li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        font-size: 12px;
      }
      .steps .ok {
        color: #3fb950;
      }
      .steps .pending {
        color: #777;
      }
      .steps li span {
        flex: 1;
      }
      .mat-icon,
      mat-icon {
        font-size: 18px;
        height: 18px;
        width: 18px;
      }
      .procs .pl {
        flex: 1;
      }
      .procs .port {
        font-family: monospace;
        color: #3fb950;
      }
      .procs .pid {
        color: var(--text-secondary, #888);
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .row.wrap {
        flex-wrap: wrap;
      }
      .app-access-toggle {
        margin-top: 4px;
      }
      .app-list {
        margin-top: 4px;
        max-height: 200px;
        overflow: auto;
        border: 1px solid var(--border, #333);
        border-radius: 4px;
        padding: 6px 8px;
      }
      .app-list .app-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        font-size: 13px;
        cursor: pointer;
      }
      .app-list .app-row input {
        cursor: pointer;
      }
      .email-label .email-row {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .email-row .email-local {
        flex: 1 1 40%;
        min-width: 0;
      }
      .email-row .at {
        opacity: 0.7;
      }
      .email-row .email-domain {
        flex: 1 1 50%;
      }
      .email-row .email-domain.locked {
        opacity: 0.7;
        font-family: monospace;
        white-space: nowrap;
      }
      .email-row .domain-edit {
        flex: 0 0 auto;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .modal {
        background: var(--bg-panel, #1e1e1e);
        border: 1px solid var(--border, #333);
        border-radius: 6px;
        padding: 18px 20px;
        max-width: 440px;
        width: 90%;
      }
      .modal h3 {
        margin: 0 0 8px;
      }
      .modal .warn {
        color: var(--warn, #e0a030);
      }
      .modal label {
        display: block;
        margin: 10px 0;
      }
      .modal input {
        width: 100%;
        margin-top: 4px;
      }
      .dep-list {
        list-style: none;
        margin: 10px 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 260px;
        overflow: auto;
      }
      .dep-head .dep-ver {
        font-family: monospace;
        font-size: 11px;
        color: var(--text-secondary, #999);
        margin-left: 6px;
      }
      .dep-row {
        display: flex;
        gap: 6px;
        margin-top: 4px;
      }
      .dep-row select {
        flex: 0 0 auto;
        background: var(--bg-input, #1e1e1e);
        border: 1px solid var(--border-color, #444);
        color: inherit;
        border-radius: 4px;
        padding: 6px;
      }
      .dep-row input {
        flex: 1;
        margin-top: 0;
      }
      .dep-warn {
        margin: 4px 0 0;
        font-size: 11px;
        color: var(--warn, #e0a030);
        background: rgba(224, 160, 48, 0.1);
        border: 1px solid #6e5611;
        border-radius: 4px;
        padding: 5px 7px;
      }
      /* Instance-mode icon in the list + the add-form mode note */
      .list li .mode-icon {
        margin-left: auto;
        font-size: 16px;
        height: 16px;
        width: 16px;
        color: var(--text-secondary, #888);
        flex: 0 0 auto;
      }
      .mode-note {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 4px;
        font-size: 12px;
        color: var(--text-secondary, #999);
      }
      .mode-note mat-icon {
        font-size: 16px;
        height: 16px;
        width: 16px;
      }
      .link-form .advanced {
        margin-top: 6px;
        font-size: 12px;
      }
      .link-form .advanced summary {
        cursor: pointer;
        color: var(--text-secondary, #888);
        font-size: 11px;
      }
      .link-form .advanced label {
        margin-top: 6px;
      }
      .log-lines {
        background: var(--bg-input, #161616);
        border-radius: 4px;
        padding: 8px;
        max-height: 180px;
        overflow: auto;
        font-size: 11px;
        font-family: monospace;
      }
      .log-lines .line {
        white-space: pre-wrap;
      }
      .log-lines .error {
        color: #f85149;
      }
      .log-lines .success {
        color: #3fb950;
      }
      .log-lines .warn {
        color: #d29922;
      }
      .log {
        margin-top: 12px;
      }
      .placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-secondary, #888);
        gap: 8px;
      }
      .placeholder mat-icon {
        font-size: 48px;
        height: 48px;
        width: 48px;
      }
      /* ── Open Apps card ────────────────────────────────────── */
      .open-apps {
        grid-column: 1 / -1;
      }
      .link-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 8px;
      }
      .link-form label {
        display: flex;
        flex-direction: column;
        font-size: 12px;
        gap: 2px;
      }
      .link-form input[type='text'],
      .link-form input:not([type]),
      .link-form select {
        background: var(--bg-input, #1e1e1e);
        border: 1px solid var(--border-color, #444);
        color: inherit;
        padding: 6px;
        border-radius: 4px;
      }
      /* Picking a value from the recents <datalist> makes Chrome apply autofill
         styling (a white background). Force the dark input bg + text back. */
      .link-form input:-webkit-autofill,
      .link-form input:-webkit-autofill:hover,
      .link-form input:-webkit-autofill:focus,
      .link-form input:autofill {
        -webkit-text-fill-color: var(--text-primary, #eee);
        -webkit-box-shadow: 0 0 0 1000px var(--bg-input, #1e1e1e) inset;
        box-shadow: 0 0 0 1000px var(--bg-input, #1e1e1e) inset;
        caret-color: var(--text-primary, #eee);
      }
      label.inline {
        flex-direction: row !important;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        cursor: pointer;
      }
      label.inline input {
        cursor: pointer;
      }
      .linked-list {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .linked-list > li {
        border: 1px solid var(--border-color, #333);
        border-radius: 6px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .linked-list > li.empty {
        border: none;
        padding: 4px 0;
        color: var(--text-secondary, #888);
        font-size: 12px;
      }
      .linked-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .linked-head .app-name {
        font-size: 13px;
      }
      .linked-head .branch {
        font-family: monospace;
        font-size: 11px;
        color: var(--text-secondary, #999);
      }
      .mode-pill {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: #30363d;
        text-transform: capitalize;
      }
      .mode-pill.dev {
        background: #1f6f33;
      }
      .mode-pill.installed {
        background: #2f5d88;
      }
      .ver-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 8px;
        background: #6e5611;
        color: var(--text-primary, #eee);
      }
      .linked-actions {
        gap: 6px;
      }
      .progress-strip {
        margin-top: 8px;
        background: var(--bg-input, #161616);
        border-radius: 4px;
        padding: 8px;
        max-height: 140px;
        overflow: auto;
        font-size: 11px;
        font-family: monospace;
      }
      .progress-strip .line {
        white-space: pre-wrap;
      }
      .progress-strip .error {
        color: #f85149;
      }
      .progress-strip .success {
        color: #3fb950;
      }
      .progress-strip .warn {
        color: #d29922;
      }
    `,
  ],
})
export class InstancesPanelComponent implements OnInit, OnDestroy {
  readonly state = inject(InstancesStateService);
  readonly identity = inject(IdentityStateService);
  readonly openApps = inject(OpenAppsStateService);

  /**
   * TODO(REMOVE BEFORE ANY PR): temporary default base ref so newly-created
   * instances are cut from the notifier-fix branch (which carries the MJExplorer
   * `MJNotificationService` injection fix needed for magic-link login). This is a
   * convenience for local testing only and MUST be dropped before the tool is
   * PR'd — it hardcodes a branch that may never merge. GUI-only; the CLI keeps no
   * default base (see mjdev create). NOTE: only takes effect once the notifier
   * fix is committed on that branch (a worktree checks out the branch's commit).
   */
  static readonly TEMP_DEFAULT_BASE_REF = 'fix-notifier-injection-bug';

  /** The activity-log scroll container (for stick-to-bottom). */
  private readonly logLines = viewChild<ElementRef<HTMLElement>>('logLines');

  readonly creating = signal(false);
  readonly showSetupPrompt = signal(false);
  readonly managingPersonas = signal(false);
  /** Email-override confirmation modal (typed "I understand" gate). */
  readonly showEmailOverrideModal = signal(false);
  overrideConfirmText = '';
  form: CreateForm = {
    name: '',
    branch: '',
    baseRef: InstancesPanelComponent.TEMP_DEFAULT_BASE_REF,
    appMode: 'dev',
  };
  personaForm: PersonaForm = {
    name: '',
    emailLocal: '',
    emailDomain: DEV_EMAIL_DOMAIN,
    domainUnlocked: false,
    roles: 'Owner',
  };
  /** Exposed for the template's domain placeholder + reset. */
  readonly devEmailDomain = DEV_EMAIL_DOMAIN;

  /** Open Apps — add-app form (dev-link or install) for the selected instance. */
  linkForm: LinkForm = {
    appRef: '',
    mode: 'dev',
    ignoreVersionRange: false,
    allowDoubleUnderscore: false,
  };
  /** The app pending unlink confirmation, or null when the modal is closed. */
  readonly unlinkTarget = signal<{ slug: string; appName: string } | null>(null);
  /**
   * Pending dev-link awaiting the dependency-choice modal: the app to link plus its
   * MISSING open-app deps (each with a chosen install/dev-link mode + source). Null
   * when no prompt is open. Dev-link doesn't auto-resolve deps, so the user picks how
   * to satisfy each prerequisite before the link proceeds.
   */
  readonly depPrompt = signal<{
    slug: string;
    appRef: string;
    ignoreVersionRange: boolean;
    allowDoubleUnderscore: boolean;
    appName: string;
    deps: DepRow[];
  } | null>(null);
  /** Whether the pending unlink should also drop the app's schema/data. */
  unlinkDropSchema = false;

  readonly steps: { key: SetupStep; label: string }[] = [
    { key: 'deps', label: 'Install dependencies' },
    { key: 'build', label: 'Build workspace' },
    { key: 'migrate', label: 'Run migrations (mj migrate)' },
    { key: 'codegen', label: 'Run CodeGen (mj codegen)' },
  ];

  constructor() {
    // Load (and clear the progress strip for) the Open Apps card whenever the
    // selected instance changes, so the card always reflects the current slug.
    effect(() => {
      const slug = this.state.selectedSlug();
      if (slug) {
        this.openApps.clearProgress();
        void this.openApps.refresh(slug);
        // Default the add-app mode to the instance's single mode (enforces pure
        // topology); the cross-mode override lives in the advanced section.
        this.linkForm.mode = this.state.selected()?.appMode ?? 'dev';
      } else {
        this.openApps.clear();
      }
    });

    // Keep the activity log pinned to the newest entry — but only when the user is
    // already at/near the bottom, so it never yanks them away while reading history.
    effect(() => {
      const log = this.state.log();
      const el = this.logLines()?.nativeElement;
      if (!el || !log.length) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (nearBottom) setTimeout(() => (el.scrollTop = el.scrollHeight), 0);
    });
  }

  ngOnInit(): void {
    this.state.startListening();
    this.openApps.startListening();
    void this.state.refresh();
    void this.identity.refresh();
    // If an instance is already selected when the panel mounts, load its open apps
    // immediately (so they show on open, like the running-process list does).
    const slug = this.state.selectedSlug();
    if (slug) void this.openApps.refresh(slug);
  }

  ngOnDestroy(): void {
    this.state.stopListening();
    this.openApps.stopListening();
  }

  toggleCreate(): void {
    this.creating.update(v => !v);
  }

  /**
   * Select an instance and refresh its open apps on EVERY click (parity with how
   * `state.select` always refreshes processes) — so the Open Apps list is current
   * the moment you open an instance, even on re-select. The constructor effect also
   * refreshes on selection change; this covers same-slug re-clicks.
   */
  selectInstance(slug: string): void {
    // Clear the previous instance's progress strip up front so it never bleeds across
    // instances, then select + load this instance's open apps.
    this.openApps.clearProgress();
    this.state.select(slug);
    void this.openApps.refresh(slug);
  }

  async submitCreate(): Promise<void> {
    if (!this.form.name.trim()) return;
    const config: InstanceConfig = {
      name: this.form.name.trim(),
      branch: this.form.branch.trim() || undefined,
      baseRef: this.form.baseRef.trim() || undefined,
      appMode: this.form.appMode,
    };
    const record = await this.state.create(config);
    if (record) {
      this.creating.set(false);
      this.form = {
        name: '',
        branch: '',
        baseRef: InstancesPanelComponent.TEMP_DEFAULT_BASE_REF,
        appMode: 'dev',
      };
      this.showSetupPrompt.set(true);
    }
  }

  done(step: SetupStep): boolean {
    const s = this.state.selected();
    if (!s) return false;
    return step === 'deps'
      ? s.setup.depsInstalled
      : step === 'migrate'
        ? s.setup.migrated
        : step === 'codegen'
          ? s.setup.codegen
          : s.setup.built;
  }

  runFull(slug: string): void {
    this.showSetupPrompt.set(false);
    void this.state.runSetup(slug, 'all');
  }

  confirmDelete(slug: string): void {
    if (confirm(`Delete instance "${slug}"? This removes its container, volume, and worktree.`)) {
      void this.state.delete(slug);
    }
  }

  // ── Developer identity (Phase 2) ──────────────────────────────────────────

  toggleManagePersonas(): void {
    this.managingPersonas.update(v => !v);
  }

  async submitPersona(): Promise<void> {
    const name = this.personaForm.name.trim();
    const local = this.personaForm.emailLocal.trim().replace(/@.*$/, '');
    const domain = this.personaForm.emailDomain.trim();
    if (!name || !local || !domain) return;
    const email = `${local}@${domain}`;
    const roles = this.personaForm.roles
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);
    const saved = await this.identity.savePersona({ id: '', name, email, roles } as DevPersona);
    if (saved)
      this.personaForm = {
        name: '',
        emailLocal: '',
        emailDomain: DEV_EMAIL_DOMAIN,
        domainUnlocked: false,
        roles: 'Owner',
      };
  }

  /** Open the typed-acknowledgement modal before unlocking the email domain. */
  requestEmailOverride(): void {
    this.overrideConfirmText = '';
    this.showEmailOverrideModal.set(true);
  }

  /** Whether the typed confirmation matches (case-insensitive "I understand"). */
  get overrideConfirmed(): boolean {
    return this.overrideConfirmText.trim().toLowerCase() === 'i understand';
  }

  /** Accept the override: unlock the domain field for free editing. */
  acceptEmailOverride(): void {
    if (!this.overrideConfirmed) return;
    this.personaForm.domainUnlocked = true;
    this.showEmailOverrideModal.set(false);
  }

  /** Cancel the override: keep the enforced dev domain. */
  cancelEmailOverride(): void {
    this.showEmailOverrideModal.set(false);
  }

  async setActivePersona(id: string): Promise<void> {
    if (id) await this.identity.setActive(id);
  }

  confirmDeletePersona(p: DevPersona): void {
    if (confirm(`Delete persona "${p.name}" (${p.email})?`)) {
      void this.identity.deletePersona(p.id);
    }
  }

  /** Per-instance persona override; empty string clears it (use active). */
  async changeInstancePersona(slug: string, personaId: string): Promise<void> {
    await this.identity.setInstancePersona(slug, personaId || undefined);
    await this.state.refresh();
  }

  /** Open/close the per-instance app-access list (loads it lazily on open). */
  toggleAppAccessPanel(slug: string): void {
    if (this.identity.appAccess()?.slug === slug) this.identity.clearAppAccess();
    else void this.identity.loadAppAccess(slug);
  }

  // ── Open Apps (Phase B) ───────────────────────────────────────────────────

  /** Linked apps for the given slug, only when the loaded list matches it. */
  openAppsFor(slug: string) {
    const loaded = this.openApps.linkedApps();
    return loaded?.slug === slug ? loaded.apps : [];
  }

  /** Add the app named in the form — dev-link or install per mode — then reset on success. */
  async submitLink(slug: string): Promise<void> {
    const appRef = this.linkForm.appRef.trim();
    if (!appRef) return;
    const mode = this.linkForm.mode;
    if (mode === 'installed') {
      // Install auto-resolves its transitive deps (engine) — no prompt needed.
      await this.openApps.install(slug, appRef, {
        allowDoubleUnderscore: this.linkForm.allowDoubleUnderscore,
      });
    } else {
      // Dev-link doesn't auto-resolve deps: pre-flight, then prompt for any missing.
      const resolved = await this.openApps.resolveDeps(slug, appRef);
      const missing = (resolved?.dependencies ?? []).filter(d => !d.present);
      if (missing.length) {
        this.depPrompt.set({
          slug,
          appRef,
          ignoreVersionRange: this.linkForm.ignoreVersionRange,
          allowDoubleUnderscore: this.linkForm.allowDoubleUnderscore,
          appName: resolved?.appName ?? appRef,
          // Same-mode closure: a dev-linked app's deps default to DEV-LINK too. Choosing
          // "install" for a dep creates an unsupported mixed instance (npm crash) — warned.
          deps: missing.map(d => ({
            name: d.name,
            versionRange: d.versionRange,
            mode: 'dev',
            source: d.repository ?? '',
          })),
        });
        return; // wait for the dependency-choice modal
      }
      await this.openApps.link(slug, appRef, {
        ignoreVersionRange: this.linkForm.ignoreVersionRange,
        allowDoubleUnderscore: this.linkForm.allowDoubleUnderscore,
      });
    }
    this.resetLinkFormIfClean(slug, mode);
  }

  /** Reset the add-app form only when the last op for this slug succeeded. */
  private resetLinkFormIfClean(slug: string, mode: 'dev' | 'installed'): void {
    if (this.openApps.activeSlug() === slug && !this.openApps.lastError()) {
      this.linkForm = { appRef: '', mode, ignoreVersionRange: false, allowDoubleUnderscore: false };
    }
  }

  /** True while any missing dependency lacks a source (blocks the confirm button). */
  get depPromptIncomplete(): boolean {
    const p = this.depPrompt();
    return !p || p.deps.some(d => !d.source.trim());
  }

  cancelDepPrompt(): void {
    this.depPrompt.set(null);
  }

  /** Satisfy the chosen dependencies in order, then dev-link the app. */
  async confirmDepPrompt(): Promise<void> {
    const p = this.depPrompt();
    if (!p || this.depPromptIncomplete) return;
    this.depPrompt.set(null);
    await this.openApps.linkWithDeps(
      p.slug,
      p.appRef,
      p.deps.map(d => ({ source: d.source.trim(), mode: d.mode })),
      { ignoreVersionRange: p.ignoreVersionRange, allowDoubleUnderscore: p.allowDoubleUnderscore }
    );
    this.resetLinkFormIfClean(p.slug, 'dev');
  }

  /**
   * Confirm a per-app mode switch. Switching an app to a mode different from the
   * instance's mode creates an UNSUPPORTED mixed instance (npm-resolver crash) — warn
   * loudly; switching back toward the instance's mode just restores consistency.
   */
  confirmSwitchMode(
    slug: string,
    appName: string,
    target: 'dev' | 'installed',
    instanceMode: 'dev' | 'installed'
  ): void {
    const createsMix = target !== instanceMode;
    const msg = createsMix
      ? `Switch "${appName}" to "${target}" mode?\n\nThis is a ${instanceMode}-mode instance, so this creates a MIXED instance — dev-linked + installed open apps in one instance crash npm's dependency resolver (require the --legacy-peer-deps escape hatch) and are COMPLETELY UNSUPPORTED.\n\nOnly continue if you know exactly what you're doing.`
      : `Switch "${appName}" back to "${target}" mode (matching this ${instanceMode}-mode instance)?`;
    if (confirm(msg)) void this.openApps.switchMode(slug, appName, target);
  }

  /** Uninstall an installed app after a destructive-action confirmation (drops schema). */
  confirmRemove(slug: string, appName: string): void {
    if (
      confirm(
        `Remove installed app "${appName}"? This uninstalls it and DROPS its schema and ` +
          `all its data in this instance. This cannot be undone.`
      )
    ) {
      void this.openApps.remove(slug, appName);
    }
  }

  /** Open the unlink confirmation modal for an app (drop-schema opt-in). */
  confirmUnlink(slug: string, appName: string): void {
    this.unlinkDropSchema = false;
    this.unlinkTarget.set({ slug, appName });
  }

  cancelUnlink(): void {
    this.unlinkTarget.set(null);
  }

  /** Perform the confirmed unlink, honoring the drop-schema choice. */
  async acceptUnlink(): Promise<void> {
    const target = this.unlinkTarget();
    if (!target) return;
    const drop = this.unlinkDropSchema;
    this.unlinkTarget.set(null);
    await this.openApps.unlink(target.slug, target.appName, drop);
  }

  /** Reset an app's schema after a destructive-action confirmation. */
  confirmResetSchema(slug: string, appName: string): void {
    if (
      confirm(
        `Reset schema for "${appName}"? This DROPS the app's schema and all its data, ` +
          `then rebuilds it from migrations. This cannot be undone.`
      )
    ) {
      void this.openApps.resetSchema(slug, appName);
    }
  }

  /** Repair an app's migration tracking after a confirmation. */
  confirmRepairSchema(slug: string, appName: string): void {
    if (
      confirm(
        `Repair schema tracking for "${appName}"? This re-stamps migration state ` +
          `but does NOT re-run SQL — use "Reset schema" for edited migrations.`
      )
    ) {
      void this.openApps.repairSchema(slug, appName);
    }
  }
}
