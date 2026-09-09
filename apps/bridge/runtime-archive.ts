import { createHash } from "node:crypto";
import { open, rm } from "node:fs/promises";
import path from "node:path";

export async function downloadVerifiedArchive(
  response: Response,
  destination: string,
  pinned: { bytes: number; checksum: string },
) {
  if (!response.ok || !response.body) throw new Error("Runtime download failed");
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== pinned.bytes) {
    await response.body.cancel();
    throw new Error("Runtime download size mismatch");
  }
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let received = 0;
  let file;
  try {
    file = await open(destination, "wx", 0o600);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > pinned.bytes) throw new Error("Runtime download exceeds pinned size");
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (!bytesWritten) throw new Error("Runtime archive write failed");
        offset += bytesWritten;
      }
    }
    if (received !== pinned.bytes) throw new Error("Runtime download size mismatch");
    if (hash.digest("hex") !== pinned.checksum)
      throw new Error("Runtime checksum verification failed");
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (file) {
      await file.close();
      file = undefined;
      await rm(destination, { force: true });
    }
    throw error;
  } finally {
    await file?.close();
    reader.releaseLock();
  }
}

export function validateArchivePath(name: string) {
  const parts = name.replace(/\/$/, "").split("/");
  if (!name || name.includes("\\") || /[\x00-\x1f:<>"|?*]/.test(name) ||
      path.posix.isAbsolute(name) || parts.some((part) =>
        !part || part === "." || part === ".." || /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error("Unsafe archive paths");
}

export type ZipEntry = { name: string; bytes: number; externalAttributes: number };
export function validateZipEntries(entries: ZipEntry[], maxBytes: number) {
  let total = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    validateArchivePath(entry.name);
    const mode = (entry.externalAttributes >>> 16) & 0xf000;
    if ((mode && mode !== 0x8000 && mode !== 0x4000) || (entry.externalAttributes & 0x400))
      throw new Error("Unsafe archive links or special files");
    const key = entry.name.replace(/\/$/, "").toLowerCase();
    if (names.has(key)) throw new Error("Duplicate archive path");
    names.add(key);
    total += entry.bytes;
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || total > maxBytes)
      throw new Error("Runtime archive exceeds extraction limit");
  }
  return total;
}

export async function validateZipArchive(archive: string, maxBytes: number) {
  const file = await open(archive, "r");
  try {
    const size = (await file.stat()).size;
    const read = async (length: number, position: number) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error("Truncated runtime ZIP");
      return buffer;
    };
    const tail = await read(Math.min(size, 65557), Math.max(0, size - 65557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error("Invalid runtime ZIP");
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) ||
        tail.readUInt16LE(end + 8) !== count || count === 0xffff ||
        directorySize > 16 * 1024 ** 2 || directoryOffset + directorySize > size - tail.length + end)
      throw new Error("Unsupported runtime ZIP structure");
    const directory = await read(directorySize, directoryOffset);
    const entries: ZipEntry[] = [];
    let offset = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50)
        throw new Error("Invalid runtime ZIP directory");
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > directory.length || directory.readUInt16LE(offset + 8) & 1 ||
          directory.readUInt16LE(offset + 34) || directory.readUInt32LE(offset + 20) === 0xffffffff ||
          directory.readUInt32LE(offset + 24) === 0xffffffff ||
          directory.readUInt32LE(offset + 42) >= directoryOffset)
        throw new Error("Unsupported runtime ZIP entry");
      const name = new TextDecoder("utf-8", { fatal: true }).decode(directory.subarray(offset + 46, offset + 46 + nameLength));
      entries.push({ name, bytes: directory.readUInt32LE(offset + 24), externalAttributes: directory.readUInt32LE(offset + 38) });
      offset = next;
    }
    if (offset !== directory.length || !entries.some((entry) => entry.name === "ollama.exe"))
      throw new Error("Runtime ZIP is missing ollama.exe or has an invalid directory");
    return validateZipEntries(entries, maxBytes);
  } finally {
    await file.close();
  }
}

// Paths travel as environment data, never as PowerShell source or interpolated arguments.
export const WINDOWS_EXTRACT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:CANIRUNAI_ARCHIVE)
try {
  $root = [System.IO.Path]::GetFullPath($env:CANIRUNAI_STAGING).TrimEnd('\') + '\'
  foreach ($entry in $archive.Entries) {
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $entry.FullName))
    if (!$target.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive paths' }
    if ($entry.FullName.EndsWith('/')) {
      [System.IO.Directory]::CreateDirectory($target) | Out-Null
    } else {
      [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
  }
} finally { $archive.Dispose() }
`;

export function windowsExtractionCommand(archive: string, staging: string, env = process.env) {
  const root = env.SystemRoot && /^[a-z]:\\Windows$/i.test(env.SystemRoot) ? env.SystemRoot : "C:\\Windows";
  return {
    file: path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_EXTRACT_SCRIPT],
    options: { shell: false as const, windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024,
      env: { ...env, CANIRUNAI_ARCHIVE: archive, CANIRUNAI_STAGING: staging } },
  };
}
