export async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    if (!window.desktopApi?.clipboardWrite) throw error
    await window.desktopApi.clipboardWrite(text)
  }
}
