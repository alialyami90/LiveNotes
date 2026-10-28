import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface ExportDeps {
  isNative(): boolean;
  /** Writes to the app cache and returns the file's URI. */
  writeCache(name: string, data: string): Promise<string>;
  share(uri: string, title: string): Promise<void>;
  download(name: string, data: string): void;
}

const FILE_NAME = 'livenotes.json';

function browserDownload(name: string, data: string) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

const capacitorDeps: ExportDeps = {
  isNative: () => Capacitor.isNativePlatform(),
  writeCache: async (path, data) =>
    (await Filesystem.writeFile({ path, data, directory: Directory.Cache, encoding: Encoding.UTF8 })).uri,
  share: async (uri, title) => {
    await Share.share({ title, files: [uri] });
  },
  download: browserDownload,
};

/** Blob downloads do nothing in an Android WebView, so native builds hand the file to the share sheet. */
export async function exportDocument(json: string, deps: ExportDeps = capacitorDeps): Promise<void> {
  if (!deps.isNative()) {
    deps.download(FILE_NAME, json);
    return;
  }
  const uri = await deps.writeCache(FILE_NAME, json);
  try {
    await deps.share(uri, 'LiveNotes export');
  } catch (e) {
    if (!(e instanceof Error && /cancel/i.test(e.message))) throw e;
  }
}
