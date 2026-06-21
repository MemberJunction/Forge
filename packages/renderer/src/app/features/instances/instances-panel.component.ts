import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
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

interface CreateForm {
  name: string;
  branch: string;
  baseRef: string;
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
            </p>
          </form>
        }

        <ul>
          @for (i of state.instances(); track i.slug) {
            <li [class.active]="i.slug === state.selectedSlug()" (click)="state.select(i.slug)">
              <span class="dot" [class]="i.status"></span>
              <div class="meta">
                <strong>{{ i.name }}</strong>
                <small>{{ i.branch }} · API :{{ i.ports.api }}</small>
              </div>
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
          </div>

          <!-- Event log -->
          <div class="card log">
            <h3>Activity <button mat-button (click)="state.clearLog()">Clear</button></h3>
            <div class="log-lines">
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
    `,
  ],
})
export class InstancesPanelComponent implements OnInit, OnDestroy {
  readonly state = inject(InstancesStateService);
  readonly identity = inject(IdentityStateService);

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

  readonly steps: { key: SetupStep; label: string }[] = [
    { key: 'deps', label: 'Install dependencies' },
    { key: 'build', label: 'Build workspace' },
    { key: 'migrate', label: 'Run migrations (mj migrate)' },
    { key: 'codegen', label: 'Run CodeGen (mj codegen)' },
  ];

  ngOnInit(): void {
    this.state.startListening();
    void this.state.refresh();
    void this.identity.refresh();
  }

  ngOnDestroy(): void {
    this.state.stopListening();
  }

  toggleCreate(): void {
    this.creating.update(v => !v);
  }

  async submitCreate(): Promise<void> {
    if (!this.form.name.trim()) return;
    const config: InstanceConfig = {
      name: this.form.name.trim(),
      branch: this.form.branch.trim() || undefined,
      baseRef: this.form.baseRef.trim() || undefined,
    };
    const record = await this.state.create(config);
    if (record) {
      this.creating.set(false);
      this.form = {
        name: '',
        branch: '',
        baseRef: InstancesPanelComponent.TEMP_DEFAULT_BASE_REF,
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
}
