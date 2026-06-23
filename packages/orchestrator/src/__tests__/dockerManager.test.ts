import { describe, it, expect } from 'vitest';
import { DockerManager } from '../../dist/index.js';

/**
 * Minimal Dockerode stand-in: returns a fixed container list from listContainers.
 * Only the surface DockerManager.listManaged touches is implemented.
 */
function fakeDocker(containers: unknown[]) {
  return {
    listContainers: async () => containers,
  } as unknown as ConstructorParameters<typeof DockerManager>[0];
}

const C = (name: string, slug: string, state = 'running') => ({
  Names: [`/${name}`],
  Labels: { 'mjdev.managed': 'true', 'mjdev.slug': slug },
  State: state,
});

describe('DockerManager.listManaged — workspace prefix scoping', () => {
  // A daemon shared by a production workspace (mjdev-*) and an isolated dev one (mjdev-dev-*).
  const mixed = [C('mjdev-accounting-dev', 'accounting-dev'), C('mjdev-dev-probe', 'probe')];

  it('production prefix sees ONLY mjdev-<slug>, never the dev workspace overlap', async () => {
    const prod = new DockerManager(fakeDocker(mixed), 'mjdev');
    const got = await prod.listManaged();
    expect(got.map(c => c.name)).toEqual(['mjdev-accounting-dev']);
  });

  it('dev prefix sees ONLY mjdev-dev-<slug>, never the production containers', async () => {
    const dev = new DockerManager(fakeDocker(mixed), 'mjdev-dev');
    const got = await dev.listManaged();
    expect(got.map(c => c.name)).toEqual(['mjdev-dev-probe']);
  });

  it('ignores managed containers whose name does not match prefix+slug exactly', async () => {
    // A stray/hand-renamed managed container must not be acted on by either workspace.
    const odd = [C('something-else', 'accounting-dev'), C('mjdev-', '')];
    const prod = new DockerManager(fakeDocker(odd), 'mjdev');
    expect(await prod.listManaged()).toEqual([]);
  });
});
