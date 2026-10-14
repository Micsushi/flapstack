// Owned offscreen preview. All messages are sample data; no live bridge or provider.
const { resolve } = require("node:path")
const { mkdirSync, writeFileSync } = require("node:fs")
const { spawn } = require("node:child_process")
const assert = require("node:assert/strict")
const output =
  process.env.FLAPSTACK_MOBILE_UI_OUTPUT ||
  resolve(".local-evidence/mobile-chat-ui", `${Date.now()}-${process.pid}`)
if (!process.versions.electron) {
  ;(async () => {
    mkdirSync(output, { recursive: true })
    require("esbuild").buildSync({
      entryPoints: ["src/main/lib/mobile-bridge/pwa.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: resolve(output, "assets.cjs"),
    })
    const asset = require(resolve(output, "assets.cjs")).getMobileCompanionAsset
    writeFileSync(
      resolve(output, "index.html"),
      asset("/").body.replace(
        '<script type="module" src="/mobile-app.js"></script>',
        '<script src="fixture.js"></script>',
      ),
    )
    writeFileSync(
      resolve(output, "fixture.js"),
      asset("/mobile-app.js").body +
        String.raw`
socket = {readyState:1, send:()=>{}};
sessionCredential = {session:{sessionId:'preview',deviceId:'preview',scopeVersion:1}};
setOnline(true);
applyEnvelope({kind:'snapshot',freshUntil:Date.now()+300000,items:[
 {kind:'project',id:'example',name:'Example project',version:1},
 {kind:'chat',id:'chat',name:'Simplify the settings screen',version:1},
 {kind:'chat',id:'chat-2',name:'Review the latest changes',version:1}
]});
window.showPreviewChat=()=>{
openChat('chat');
applyConversation({chatId:'chat',subChatId:'conversation',conversations:[{id:'conversation',name:null}],before:null,pageBefore:null,status:'idle',messages:[
 {id:'1',role:'user',text:'Can you simplify the settings screen and keep the same fonts and colors as the workboard?'},
 {id:'2',role:'assistant',text:'I updated the settings screen to use the shared controls and typography. Connection details now stay inside their own section.\n\nYour saved preferences are preserved. The layout also fits a phone screen.'},
 {id:'3',role:'user',text:'Check the chat screen too.'},
 {id:'4',role:'assistant',text:'I’ll check the composer, conversation history, and how the screen behaves when the connection drops.'}
]});};
`,
    )
    const env = { ...process.env, FLAPSTACK_MOBILE_UI_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(process.env.FLAPSTACK_UI_ELECTRON || require("electron"), [__filename], {
      env,
      stdio: "inherit",
      windowsHide: true,
    })
    const timer = setTimeout(() => child.kill(), 60000)
    const code = await new Promise((done, reject) => {
      child.once("exit", done)
      child.once("error", reject)
    })
    clearTimeout(timer)
    if (code) throw Error(`Mobile preview failed (${code})`)
    console.log(output)
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, nativeTheme } = require("electron")
  app.setPath("userData", resolve(output, "profile"))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 390,
      height: 844,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    })
    try {
      for (const theme of ["light", "dark"]) {
        nativeTheme.themeSource = theme
        await win.loadFile(resolve(output, "index.html"))
        for (const screen of ["list", "chat", "new"]) {
          if (screen === "chat") await win.webContents.executeJavaScript("window.showPreviewChat()")
          if (screen === "new")
            await win.webContents.executeJavaScript("document.getElementById('new-chat').click()")
          win.webContents.invalidate()
          await new Promise((done) => setTimeout(done, 500))
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.documentElement.scrollWidth > innerWidth + 1",
            ),
            false,
          )
          writeFileSync(
            resolve(output, `${screen}-${theme}.png`),
            (await win.webContents.capturePage()).toPNG(),
          )
        }
      }
      console.log(
        "PASS: phone conversation list, chat and composer in both themes; no horizontal overflow.",
      )
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      win.destroy()
      app.exit(process.exitCode || 0)
    }
  })
}
