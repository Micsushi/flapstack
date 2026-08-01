export const IMPORTED_FILE_MIME_TYPES = [
  "application/gzip",
  "application/octet-stream",
  "application/pdf",
  "application/wasm",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/calendar",
  "text/csv",
  "text/css",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/typescript",
  "text/xml",
] as const

export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024
export const MAX_ATTACHMENT_IMAGE_PIXELS = 40_000_000
export const MAX_ATTACHMENT_IMAGE_DIMENSION = 32_768

const importedFileMimeTypes = new Set<string>(IMPORTED_FILE_MIME_TYPES)
const FALLBACK_FILE_MIME_TYPE = "application/octet-stream"
const MAX_DECLARED_MIME_TYPE_LENGTH = 255

export function normalizeNonImageAttachmentMimeType(declaredMimeType: string): string {
  if (declaredMimeType.length > MAX_DECLARED_MIME_TYPE_LENGTH) return FALLBACK_FILE_MIME_TYPE
  const normalized = declaredMimeType.trim().toLowerCase()
  return importedFileMimeTypes.has(normalized) ? normalized : FALLBACK_FILE_MIME_TYPE
}
