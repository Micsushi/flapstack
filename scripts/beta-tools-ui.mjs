// Actual UI with synthetic transport/session data. Never connects to a live profile.
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
const require = createRequire(import.meta.url)
const output = resolve(".local-evidence/beta-tools-ui", `${Date.now()}-${process.pid}`)
mkdirSync(output, { recursive: true })
const content =
  "Review notes\n\nKeep file search compact.\nPreserve keyboard selection and draft recovery.\n"
const stubs = {
  trpc: `import {useEffect} from 'react';
const noop=()=>{};const query=data=>({data,isLoading:false,isFetching:false,isError:false,error:null,refetch:async()=>{}});
const annotation={id:'comment-one',chatId:'sample',projectId:'sample',filePath:'src/search.ts',side:'right',startLine:24,endLine:28,body:'Keep the selected file stable when more results arrive.',version:1,diffHash:'sample-hash',freshness:'current',deletedAt:null,lastFeedbackVersion:null};
const mutation={isPending:false,mutate:(_input,options)=>options?.onSuccess?.({replayEnabled:false,serializedState:'Sample workspace\\r\\n> npm run check\\r\\nAll checks passed.\\r\\n> '}),mutateAsync:async()=>({})};
const metadataQuery=query({projectId:'sample'}),annotationQuery=query({annotations:[annotation],diffHash:'sample-hash'}),fileQuery=query([{id:'readme',label:'README.md',path:'README.md',type:'file',repository:'local'}]);
export const trpc={chats:{getMetadata:{useQuery:()=>metadataQuery}},diffAnnotations:{list:{useQuery:()=>annotationQuery}},files:{search:{useQuery:()=>fileQuery}},external:{openInApp:{useMutation:()=>mutation},openFileInEditor:{useMutation:()=>mutation}},terminal:new Proxy({stream:{useSubscription:()=>{}},replay:{useSubscription:(_input,handlers)=>{useEffect(()=>{window.fixtureDisconnect=handlers.onComplete;return()=>{delete window.fixtureDisconnect}},[])}}},{get:(target,key)=>target[key]||{useMutation:()=>mutation}})};
export const trpcClient={};`,
  worker: `export default class extends Worker { constructor(){super('./editor.worker.js')} }`,
  agentsAtoms: `import {atom} from 'jotai';export const recentlyOpenedFilesAtom=atom(['C:/sample/src/search.ts','C:/sample/notes.txt']),fileViewerWordWrapAtom=atom(true),fileViewerMinimapAtom=atom(false),fileViewerLineNumbersAtom=atom(true),fileViewerDisplayModeAtom=atom('full-page');`,
  globalAtoms: `import {atom} from 'jotai';export const preferredEditorAtom=atom('vscode'),fullThemeDataAtom=atom(null);`,
  terminalAtoms: `import {atom} from 'jotai';export const terminalCwdAtom=atom({}),terminalsAtom=atom({}),activeTerminalIdAtom=atom({});`,
  beta: `export const useBetaFeatures=()=>({workspaceEditing:true,streamedFileSearch:false});`,
  draft: `import {useState} from 'react';const initial=${JSON.stringify(content)};export function useWorkspaceDraft(){const [content,setContent]=useState(initial),[saved,setSaved]=useState(initial),[autosave,setAutosave]=useState(false);const state={phase:'ready',content,draft:{},disk:{content:saved,sha256:'sample-sha'},busy:false,conflict:false,error:null,interruptedSave:false,autosave,autosaveAllowed:true};return {state,setAutosave,session:{getSnapshot:()=>state,setContent:value=>{setContent(value);return true},save:async()=>setSaved(content),flush:async()=>true,refreshDisk:async()=>{},hasUnpersistedText:()=>false,needsRetry:()=>false}}}`,
  fileContent: `export const useFileContent=()=>({content:${JSON.stringify(content)},isLoading:false,error:null,refetch:()=>{}});export const getErrorMessage=()=>'';`,
  fileRefresh: `export const useFileChangeRefresh=()=>{};`,
  themes: `const theme={currentTheme:null};export const useVSCodeTheme=()=>theme;`,
  themeMode: `const theme={resolvedTheme:'dark',theme:'dark',setTheme:()=>{}};export const useTheme=()=>theme;`,
  hotkeys: `export const useResolvedHotkeyDisplay=()=>'';`,
  mention: `export const getFileIconByExtension=()=>null;`,
  copy: `import React from 'react';export const CopyButton=({text})=>React.createElement('button',{'aria-label':'Copy file content',onClick:()=>navigator.clipboard.writeText(text),className:'px-2 text-xs'},'Copy');`,
  image: `export const ImageViewer=()=>null;`,
  markdown: `export const MarkdownViewer=()=>null;`,
}
const rules = [
  [/^next-themes$/, "themeMode"],
  [/\?worker$/, "worker"],
  [/\/trpc$/, "trpc"],
  [/\/agents\/atoms$/, "agentsAtoms"],
  [/^@\/lib\/atoms$/, "globalAtoms"],
  [/use-beta-features$/, "beta"],
  [/use-workspace-draft$/, "draft"],
  [/use-file-content$/, "fileContent"],
  [/use-file-change-refresh$/, "fileRefresh"],
  [/\/themes$/, "themes"],
  [/\/hotkeys$/, "hotkeys"],
  [/agents-file-mention$/, "mention"],
  [/message-action-buttons$/, "copy"],
  [/image-viewer$/, "image"],
  [/markdown-viewer$/, "markdown"],
]
const { build } = await import("esbuild")
await build({
  entryPoints: ["node_modules/monaco-editor/esm/vs/editor/editor.worker.js"],
  outfile: resolve(output, "editor.worker.js"),
  bundle: true,
  platform: "browser",
})
await build({
  entryPoints: ["tests/fixtures/beta-tools-ui.tsx"],
  outfile: resolve(output, "fixture.js"),
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  loader: { ".ttf": "file", ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "isolated-tools-data",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (
            args.path === "./atoms" &&
            args.importer.replaceAll("\\", "/").endsWith("/terminal/terminal.tsx")
          )
            return { path: "terminalAtoms", namespace: "sample" }
          const match = rules.find(([rule]) => rule.test(args.path))
          return match ? { path: match[1], namespace: "sample" } : undefined
        })
        builder.onLoad({ filter: /.*/, namespace: "sample" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
          resolveDir: process.cwd(),
        }))
      },
    },
  ],
})
const postcss = (await import("postcss")).default,
  tailwind = (await import("tailwindcss")).default,
  autoprefixer = (await import("autoprefixer")).default
const cssPath = resolve("src/renderer/styles/globals.css")
const css = readFileSync(cssPath, "utf8").replace(
  '@import "./agents-styles.css";',
  readFileSync(resolve("src/renderer/styles/agents-styles.css"), "utf8"),
)
writeFileSync(
  resolve(output, "theme.css"),
  (
    await postcss([tailwind(require(resolve("tailwind.config.js"))), autoprefixer]).process(css, {
      from: cssPath,
    })
  ).css,
)
writeFileSync(
  resolve(output, "index.html"),
  '<!doctype html><html class="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
)
writeFileSync(
  resolve(output, "main.cjs"),
  `
const {app,BrowserWindow,session}=require('electron');const {writeFileSync}=require('node:fs');const {resolve}=require('node:path');const output=__dirname;app.setPath('userData',resolve(output,'profile'));const pause=ms=>new Promise(r=>setTimeout(r,ms));const report={samples:[],errors:[],syntheticData:true};let win;
app.whenReady().then(async()=>{try{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',(_e,level,message)=>{if(level===3)report.errors.push(message)});
for(const [label,width,height] of [['desktop',1280,800],['narrow',390,844]]){win.setSize(width,height);for(const surface of ['search','editor','comments','terminal']){await win.loadFile(resolve(output,'index.html'),{query:{surface}});await pause(1500);const sample=await win.webContents.executeJavaScript("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.body.innerText.slice(0,400),rendered:!!document.querySelector('[data-fixture-surface]'),monaco:!!document.querySelector('.monaco-editor'),xterm:!!document.querySelector('.xterm')})");if(!sample.rendered)throw Error('Surface failed: '+surface);writeFileSync(resolve(output,surface+'-'+label+'.png'),(await win.webContents.capturePage()).toPNG());report.samples.push({surface,label,...sample});if(surface==='terminal'){await win.webContents.executeJavaScript('window.fixtureDisconnect?.()');await pause(150);writeFileSync(resolve(output,surface+'-'+label+'-reconnect.png'),(await win.webContents.capturePage()).toPNG())}if(surface==='comments'){await win.webContents.executeJavaScript("document.querySelector('input[type=checkbox]')?.click()");await pause(150);writeFileSync(resolve(output,surface+'-'+label+'-selected.png'),(await win.webContents.capturePage()).toPNG())}}}report.hidden=!win.isVisible();report.status=report.errors.length?'errors':'captured';writeFileSync(resolve(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status}));}catch(error){report.failure=String(error);writeFileSync(resolve(output,'failure.json'),JSON.stringify(report,null,2));process.exitCode=1}finally{if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)}});
`,
)
console.log(`Prepared isolated tools fixture: ${output}`)
if (process.argv.includes("--prepare-only")) process.exit(0)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(
  process.env.FLAPSTACK_UI_ELECTRON || require("electron"),
  [resolve(output, "main.cjs")],
  { env, stdio: "inherit", windowsHide: true },
)
const deadline = setTimeout(() => child.kill(), 60000)
const code = await new Promise((res, rej) => {
  child.once("error", rej)
  child.once("close", res)
})
clearTimeout(deadline)
writeFileSync(
  resolve(output, "cleanup.json"),
  JSON.stringify({ exitCode: code, exited: child.exitCode !== null || child.signalCode !== null }),
)
if (code !== 0) throw Error(`Tools fixture failed (${code})`)
