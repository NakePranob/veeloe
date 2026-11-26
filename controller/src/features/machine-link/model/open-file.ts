import { File } from "expo-file-system";
import { Linking } from "react-native";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeTypeOf(name: string): string {
  return MIME[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * Opens a downloaded file in the OS's own preview or its app for that type
 * (ADR 0050). Files the OS cannot preview still go to `Linking`, so a viewer
 * registered for the scheme can take them.
 */
export async function openDownloadedFile(file: File): Promise<void> {
  if (await File.canPreview(file)) {
    await File.preview(file, { title: file.name, mimeType: mimeTypeOf(file.name) });
    return;
  }
  // Only files the OS cannot preview reach here; a `file://` URL is not a viewer fallback on Android.
  await Linking.openURL(file.uri);
}
