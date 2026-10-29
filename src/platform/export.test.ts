import { describe, expect, it } from 'vitest';
import { exportDocument, type ExportDeps } from './export';

function fakeDeps(native: boolean) {
  const calls: string[] = [];
  const deps: ExportDeps = {
    isNative: () => native,
    writeCache: async (name, data) => {
      calls.push(`write:${name}:${data}`);
      return `file:///cache/${name}`;
    },
    share: async (uri, title) => {
      calls.push(`share:${uri}:${title}`);
    },
    download: (name, data) => {
      calls.push(`download:${name}:${data}`);
    },
  };
  return { deps, calls };
}

describe('exportDocument', () => {
  it('on Android writes livenotes.json to the cache and opens the share sheet', async () => {
    const { deps, calls } = fakeDeps(true);
    await exportDocument('{"v":1}', { deps });
    expect(calls).toEqual(['write:livenotes.json:{"v":1}', 'share:file:///cache/livenotes.json:LiveNotes export']);
  });

  it('on the web downloads the file', async () => {
    const { deps, calls } = fakeDeps(false);
    await exportDocument('{"v":1}', { deps });
    expect(calls).toEqual(['download:livenotes.json:{"v":1}']);
  });

  it('a cancelled share sheet is not an error', async () => {
    const { deps } = fakeDeps(true);
    deps.share = async () => {
      throw new Error('Share canceled');
    };
    await expect(exportDocument('{}', { deps })).resolves.toBeUndefined();
  });
});
