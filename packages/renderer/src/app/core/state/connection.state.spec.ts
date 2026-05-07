/**
 * Connection state — Phase 1 failing-test scaffolding for the
 * `multi-connection-first-class` change. These specs encode the contract
 * laid out in `openspec/changes/multi-connection-first-class/specs/connection-management/spec.md`.
 *
 * Phases 4-9 of the implementation flip the underlying state model; the
 * following tests must fail on the pre-Phase-4 code and pass once the
 * disconnect signature has been changed and per-connection state is wired.
 *
 * The tests deliberately avoid Angular's `TestBed` / zone.js — instantiating
 * `ConnectionStateService` through `Injector.create` keeps the suite under
 * the existing Vitest+node config without pulling in the Material snack-bar
 * graph or jsdom.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Angular partial-compiled libs (e.g. PlatformNavigation imported transitively
// via `toObservable`) need the JIT compiler available at module-load time.
// Importing `@angular/compiler` for side effects here registers it before any
// `@Injectable` declarations are touched.
import '@angular/compiler';
import { Injector, signal, type WritableSignal } from '@angular/core';
import { EMPTY, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `toObservable` requires `EffectScheduler` from a fully bootstrapped Angular
// platform. Tests here only exercise signals/computed/connect/disconnect — the
// observable wrappers (`profiles$`, `activeProfile$`, `isConnected$`) are
// untouched. Replace `toObservable` with an empty observable so the
// constructor-time initialisation in `ConnectionStateService` doesn't pull in
// the effect-scheduler graph.
vi.mock('@angular/core/rxjs-interop', () => ({
  toObservable: () => EMPTY,
  toSignal: (source: unknown) => source,
}));
import type { ConnectionProfile, DatabaseInfo } from '@mj-forge/shared';
import { ConnectionStateService } from './connection.state';
import { ExplorerStateService, type TreeNode } from './explorer.state';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { TabStateService } from './tab.state';

interface IpcHarness {
  service: IpcService;
  // Exposed spies so heartbeat / persistence specs can assert call shape.
  listDatabases: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  setAppState: ReturnType<typeof vi.fn>;
  getAppState: ReturnType<typeof vi.fn>;
}

interface IpcStubOpts {
  databasesByProfile?: Record<string, DatabaseInfo[]>;
  // Optional initial AppState returned by getAppState — used by persistence specs.
  appState?: Record<string, unknown>;
  // Mark `isAvailable` true so persistence-related code paths run; defaults false
  // (existing behaviour) so heartbeat / disconnect specs don't trigger saveState IPC.
  available?: boolean;
}

// Minimal IPC stub — methods return synchronous Observables so connect /
// disconnect / loadDatabases never block the test on real I/O. Exposes the
// underlying vitest spies on the harness so heartbeat / persistence tests can
// assert per-id call counts.
function makeIpcStub(opts: IpcStubOpts = {}): IpcHarness {
  const databasesByProfile = opts.databasesByProfile ?? {};
  const listDatabases = vi.fn((id: string) => of(databasesByProfile[id] ?? []));
  const connect = vi.fn(() => of(undefined));
  const setAppState = vi.fn(() => of(undefined));
  const getAppState = vi.fn(() => of(opts.appState ?? {}));
  const service = {
    isAvailable: opts.available ?? false,
    listConnections: () => of([] as ConnectionProfile[]),
    connect,
    disconnect: () => of(undefined),
    listDatabases,
    setAppState,
    getAppState,
  } as unknown as IpcService;
  return { service, listDatabases, connect, setAppState, getAppState };
}

function makeNotificationStub(): NotificationService {
  return {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
  } as unknown as NotificationService;
}

interface TabHarness {
  service: TabStateService;
  setActive: (tab: { type: string; connectionId?: string; databaseName?: string } | null) => void;
}

function makeTabStub(): TabHarness {
  // Real `tabState.activeTab` is a `Signal<Tab | null>`. Backing the stub with a
  // signal makes `focusedConnectionId = computed(...)` reactive in the same way
  // it is in production — without it, switching tabs wouldn't invalidate the
  // computed.
  const active = signal<{ type: string; connectionId?: string; databaseName?: string } | null>(
    null
  );
  const service = {
    activeTab: active,
  } as unknown as TabStateService;
  return {
    service,
    setActive: tab => active.set(tab),
  };
}

interface ExplorerHarness {
  service: ExplorerStateService;
  rootNodes: WritableSignal<TreeNode[]>;
}

function makeExplorerStub(): ExplorerHarness {
  // Real `ExplorerStateService` constructs `toObservable(this.rootNodes)` in field
  // initialisers, which requires an `EffectScheduler` from a fully-bootstrapped
  // Angular platform. The unit tests only exercise `addServerNode` / `removeServerNode`
  // / `rootNodes()`, so a hand-rolled stub backed by a real signal is enough.
  const rootNodes = signal<TreeNode[]>([]);
  const service = {
    rootNodes,
    addServerNode: (connectionId: string, serverName: string): void => {
      const node = {
        id: `server-${connectionId}`,
        name: serverName,
        type: 'server',
        connectionId,
        icon: 'dns',
        path: '',
        hasChildren: true,
        isExpanded: false,
        isLoading: false,
      } as TreeNode;
      rootNodes.update(prev => {
        const idx = prev.findIndex(n => n.connectionId === connectionId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = node;
          return next;
        }
        return [...prev, node];
      });
    },
    removeServerNode: (connectionId: string): void => {
      rootNodes.update(prev => prev.filter(n => n.connectionId !== connectionId));
    },
    expandNode: vi.fn(),
  } as unknown as ExplorerStateService;
  return { service, rootNodes };
}

function makeService(
  opts: {
    databasesByProfile?: Record<string, DatabaseInfo[]>;
    profiles?: ConnectionProfile[];
    appState?: Record<string, unknown>;
    ipcAvailable?: boolean;
  } = {}
): {
  service: ConnectionStateService;
  explorer: ExplorerHarness;
  tab: TabHarness;
  notification: NotificationService;
  ipc: IpcHarness;
} {
  const ipc = makeIpcStub({
    databasesByProfile: opts.databasesByProfile,
    appState: opts.appState,
    available: opts.ipcAvailable,
  });
  const notification = makeNotificationStub();
  const tab = makeTabStub();
  const explorer = makeExplorerStub();
  const injector = Injector.create({
    providers: [
      { provide: IpcService, useValue: ipc.service },
      { provide: NotificationService, useValue: notification },
      { provide: TabStateService, useValue: tab.service },
      { provide: ExplorerStateService, useValue: explorer.service },
      { provide: ConnectionStateService },
    ],
  });
  const service = injector.get(ConnectionStateService);
  // Seed profiles via the private signal so connect() finds them. Tests own
  // this break-the-encapsulation because the service has no public setter.
  if (opts.profiles?.length) {
    (service as unknown as { _profiles: { set: (v: ConnectionProfile[]) => void } })._profiles.set(
      opts.profiles
    );
  }
  return { service, explorer, tab, notification, ipc };
}

const profileA: ConnectionProfile = {
  id: 'profile-a',
  name: 'Profile A',
  engine: 'postgresql',
  server: 'host-a',
  port: 5432,
  authenticationType: 'sql',
  encrypt: false,
  trustServerCertificate: true,
  connectionTimeout: 30,
};
const profileB: ConnectionProfile = { ...profileA, id: 'profile-b', name: 'Profile B' };
const profileC: ConnectionProfile = { ...profileA, id: 'profile-c', name: 'Profile C' };

describe('ConnectionStateService — disconnect requires connectionId (Phase 4)', () => {
  beforeEach(() => {
    // Heartbeat uses real timers; fake them so the test doesn't leak intervals.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('disconnect(connectionId) must require an explicit connectionId argument', () => {
    // Spec: "Calling disconnect without an argument is a type error"
    // (specs/connection-management/spec.md scenario "Calling disconnect without an argument").
    // Once Phase 4 lands, the signature is `disconnect(connectionId: string): Promise<void>`,
    // so `disconnect.length` (the count of declared parameters before the first with a default)
    // is exactly 1. Pre-Phase-4 the method takes zero arguments.
    expect(ConnectionStateService.prototype.disconnect.length).toBe(1);
  });

  it('disconnects only the targeted profile when multiple are connected', async () => {
    // Spec: "Per-target disconnect" — disconnecting profile X SHALL affect only profile X.
    const { service, explorer, tab } = makeService({
      profiles: [profileA, profileB, profileC],
      databasesByProfile: {
        [profileA.id]: [{ name: 'db-a' } as DatabaseInfo],
        [profileB.id]: [{ name: 'db-b' } as DatabaseInfo],
        [profileC.id]: [{ name: 'db-c' } as DatabaseInfo],
      },
    });

    await service.connect(profileA.id);
    explorer.service.addServerNode(profileA.id, profileA.name);
    await service.connect(profileB.id);
    explorer.service.addServerNode(profileB.id, profileB.name);
    await service.connect(profileC.id);
    explorer.service.addServerNode(profileC.id, profileC.name);

    // Focus profile A (the latest connection in current code) but request that
    // profile B be disconnected.
    tab.setActive({ type: 'query', connectionId: profileA.id, databaseName: 'db-a' });

    await (service.disconnect as (id: string) => Promise<void>)(profileB.id);

    expect(service.isConnected(profileA.id)).toBe(true);
    expect(service.isConnected(profileB.id)).toBe(false);
    expect(service.isConnected(profileC.id)).toBe(true);
  });
});

describe('ConnectionStateService — explorer survives single disconnect (spec 1.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('disconnecting one of three connections leaves the other two server nodes in rootNodes', async () => {
    // Spec: "Sidebar tree visibility is independent of focus" + "Per-target disconnect" —
    // disconnecting A leaves B and C's tree nodes intact.
    const { service, explorer, tab } = makeService({
      profiles: [profileA, profileB, profileC],
      databasesByProfile: {
        [profileA.id]: [],
        [profileB.id]: [],
        [profileC.id]: [],
      },
    });

    await service.connect(profileA.id);
    explorer.service.addServerNode(profileA.id, profileA.name);
    await service.connect(profileB.id);
    explorer.service.addServerNode(profileB.id, profileB.name);
    await service.connect(profileC.id);
    explorer.service.addServerNode(profileC.id, profileC.name);

    tab.setActive({ type: 'query', connectionId: profileA.id, databaseName: undefined });

    await (service.disconnect as (id: string) => Promise<void>)(profileA.id);

    const connectionIds = explorer.rootNodes().map(n => n.connectionId);
    expect(connectionIds).toEqual(expect.arrayContaining([profileB.id, profileC.id]));
    expect(connectionIds).not.toContain(profileA.id);
  });
});

describe('ConnectionStateService — focusedConnectionId derives from active tab (spec 1.3)', () => {
  it('returns the active query tab connectionId', () => {
    const { service, tab } = makeService({ profiles: [profileA, profileB] });
    tab.setActive({ type: 'query', connectionId: profileA.id, databaseName: 'db-a' });
    expect(service.focusedConnectionId()).toBe(profileA.id);
    expect(service.focusedDatabaseName()).toBe('db-a');
  });

  it('updates when the active tab switches', () => {
    const { service, tab } = makeService({ profiles: [profileA, profileB] });
    tab.setActive({ type: 'query', connectionId: profileA.id, databaseName: 'db-a' });
    expect(service.focusedConnectionId()).toBe(profileA.id);
    tab.setActive({ type: 'query', connectionId: profileB.id, databaseName: 'db-b' });
    expect(service.focusedConnectionId()).toBe(profileB.id);
    expect(service.focusedDatabaseName()).toBe('db-b');
  });

  it('is null when the active tab is not a query tab', () => {
    const { service, tab } = makeService();
    tab.setActive({ type: 'welcome' });
    expect(service.focusedConnectionId()).toBeNull();
    expect(service.focusedDatabaseName()).toBeNull();
  });

  it('is null when there is no active tab', () => {
    const { service, tab } = makeService();
    tab.setActive(null);
    expect(service.focusedConnectionId()).toBeNull();
    expect(service.focusedDatabaseName()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — per-connection heartbeat
//
// `connect(profileId)` calls `loadDatabases(profileId)` synchronously, which
// itself invokes `ipc.listDatabases(profileId)`. Once the heartbeat starts,
// each 30s tick adds another `ipc.listDatabases(profileId)` call. To assert
// "did the heartbeat fire?" the tests count `listDatabases` calls *after* the
// initial connect, advance fake timers, and compare per-id counts.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;

function listDatabasesCallsFor(ipc: IpcHarness, connectionId: string): number {
  return ipc.listDatabases.mock.calls.filter(([id]) => id === connectionId).length;
}

describe('ConnectionStateService — per-connection heartbeat (spec 1.7)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs an independent heartbeat per connected profile', async () => {
    const { service, ipc } = makeService({
      profiles: [profileA, profileB],
      databasesByProfile: { [profileA.id]: [], [profileB.id]: [] },
    });

    await service.connect(profileA.id);
    await service.connect(profileB.id);

    const baselineA = listDatabasesCallsFor(ipc, profileA.id);
    const baselineB = listDatabasesCallsFor(ipc, profileB.id);

    // One heartbeat tick — both per-id intervals should fire.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    expect(listDatabasesCallsFor(ipc, profileA.id)).toBe(baselineA + 1);
    expect(listDatabasesCallsFor(ipc, profileB.id)).toBe(baselineB + 1);

    // Cleanup so the test doesn't leak intervals into the next describe block.
    service.ngOnDestroy();
  });

  it('disconnecting one profile stops only its heartbeat; the other keeps ticking', async () => {
    const { service, ipc } = makeService({
      profiles: [profileA, profileB],
      databasesByProfile: { [profileA.id]: [], [profileB.id]: [] },
    });

    await service.connect(profileA.id);
    await service.connect(profileB.id);

    await service.disconnect(profileA.id);

    const baselineA = listDatabasesCallsFor(ipc, profileA.id);
    const baselineB = listDatabasesCallsFor(ipc, profileB.id);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    // A's heartbeat is gone — no new pings for A.
    expect(listDatabasesCallsFor(ipc, profileA.id)).toBe(baselineA);
    // B's heartbeat continues — exactly one new ping for B.
    expect(listDatabasesCallsFor(ipc, profileB.id)).toBe(baselineB + 1);

    service.ngOnDestroy();
  });

  it('ngOnDestroy clears every per-connection heartbeat timer', async () => {
    const { service } = makeService({
      profiles: [profileA, profileB],
      databasesByProfile: { [profileA.id]: [], [profileB.id]: [] },
    });

    await service.connect(profileA.id);
    await service.connect(profileB.id);

    // Two intervals are scheduled by this point.
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);

    service.ngOnDestroy();

    // Allow any in-flight microtasks to settle so the assertion sees the post-
    // teardown timer queue, not the snapshot from before.
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — persistence migration (lastConnectionId → lastConnectedProfileIds[])
//
// `restoreState()` is the only path that reads the legacy `lastConnectionId`.
// The migration rule is: prefer `lastConnectedProfileIds`; fall back to a
// one-element list derived from `lastConnectionId` only when the new key is
// absent or empty.
// ---------------------------------------------------------------------------

describe('ConnectionStateService — persistence migration (spec 1.8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reconnects every id in lastConnectedProfileIds', async () => {
    const { service, ipc } = makeService({
      profiles: [profileA, profileB, profileC],
      databasesByProfile: { [profileA.id]: [], [profileB.id]: [], [profileC.id]: [] },
      ipcAvailable: true,
      appState: { lastConnectedProfileIds: [profileA.id, profileB.id] },
    });

    await service.restoreState();

    expect(service.isConnected(profileA.id)).toBe(true);
    expect(service.isConnected(profileB.id)).toBe(true);
    // C wasn't in the persisted list; not reconnected.
    expect(service.isConnected(profileC.id)).toBe(false);

    // Sanity: ipc.connect() invoked once per id in the list, not per profile.
    const connectIds = ipc.connect.mock.calls.map(([id]) => id);
    expect(connectIds).toEqual(expect.arrayContaining([profileA.id, profileB.id]));
    expect(connectIds).not.toContain(profileC.id);

    service.ngOnDestroy();
  });

  it('forward-migrates legacy lastConnectionId to a single-element restore list', async () => {
    const { service } = makeService({
      profiles: [profileA, profileB],
      databasesByProfile: { [profileA.id]: [], [profileB.id]: [] },
      ipcAvailable: true,
      // Legacy single-connection state — no `lastConnectedProfileIds` key.
      appState: { lastConnectionId: profileA.id },
    });

    await service.restoreState();

    expect(service.isConnected(profileA.id)).toBe(true);
    expect(service.isConnected(profileB.id)).toBe(false);

    service.ngOnDestroy();
  });

  it('prefers lastConnectedProfileIds when both old and new keys are present', async () => {
    const { service } = makeService({
      profiles: [profileA, profileB, profileC],
      databasesByProfile: { [profileA.id]: [], [profileB.id]: [], [profileC.id]: [] },
      ipcAvailable: true,
      appState: {
        lastConnectionId: profileC.id,
        lastConnectedProfileIds: [profileA.id, profileB.id],
      },
    });

    await service.restoreState();

    // The new key wins; the legacy key is ignored entirely when the new key
    // is non-empty — proves the migration is "forward-only, no double-restore".
    expect(service.isConnected(profileA.id)).toBe(true);
    expect(service.isConnected(profileB.id)).toBe(true);
    expect(service.isConnected(profileC.id)).toBe(false);

    service.ngOnDestroy();
  });
});
