import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const output = resolve(".local-evidence/beta-react-ui", `${Date.now()}-${process.pid}`)
mkdirSync(output, { recursive: true })
const { build } = await import("esbuild")
const mock = String.raw`
const noop=()=>{};
const records=Array.from({length:6},(_,i)=>({id:'q'+i,kind:'question',history:[],title:['Which project should receive the prototype?','Should completed work remain visible by default?','Confirm the target environment before release'][i%3],state:i<3?'open':'answered',answer:i<3?'':'Keep the current setting.',answerSource:'owner',context:'Synthetic review context. This text belongs inside the expanded record.',choices:['Use current project','Choose another project'],projects:[{id:'fixture',name:'Sample project'}]}));
const snapshot={path:'projects/fixture/questions.json',revision:'fixture-only',document:{records}};
const query=data=>({data,isLoading:false,isFetching:false,isError:false,error:null,refetch:async()=>{}});
const base={useUtils:()=>({projectRecords:{read:{invalidate:noop,cancel:noop,setData:noop}},betaFeatures:{get:{setData:noop}}}),useQueries:()=>[query(snapshot)],projectRecords:{list:{useQuery:()=>query({documents:[{path:snapshot.path}]})},patch:{useMutation:()=>({isPending:false,mutateAsync:async()=>({snapshot})})}},betaFeatures:{get:{useQuery:()=>query({planning:true,orchestration:true})},set:{useMutation:()=>({isPending:false,mutate:noop})}}};
const plans={projectId:'fixture',rootPath:'C:/sandbox',fingerprint:'sample',sources:[{id:'plan',type:'markdown',path:'docs/plan.md',fingerprint:'sample',status:'current',stale:false,candidates:['Simplify the settings screen','Check keyboard navigation','Review the final previews'].map((title,i)=>({id:'plan-'+i,fingerprint:'p'+i,kind:'checklist',title,body:null,path:'docs/plan.md',line:i+1,depth:0,parentId:null,completed:i===0})),limitations:[],errors:[]}],limitations:[]};
const workspace={id:'workspace-1',name:'Design review',scope:{type:'project',projectId:'fixture'},owner:{kind:'manual'},layoutVersion:1,sortOrder:'a0',version:1,createdAt:1,updatedAt:1,archivedAt:null,layoutState:'ready',layout:null,layoutIssue:null};
const data={
 'automations.list':{items:['Nightly project review','Review outstanding questions','Check releases'].map((name,i)=>({id:'auto-'+i,draft:{name,description:null,trigger:{type:'schedule'},run:{harness:'codex'}},state:i===1?'draft':'active',approval:{state:i===1?'pending':'approved'}}))},'automations.inbox':{items:[],unreadCount:0},
 'planSources.refresh':plans,'planSources.sourceLinks':[],
 'projectVaults.listSections':['index','decisions','context'].map(sectionId=>({sectionId,sectionType:sectionId,title:{index:'Project overview',decisions:'Decisions',context:'Context'}[sectionId],relativePath:sectionId+'.md'})),
 'projectVaults.getPolicy':{locationMode:'app-managed',gitTrackingEnabled:false,vaultPath:'C:/sandbox/knowledge',centralPath:'C:/sandbox/knowledge'},
 'projectVaults.getContextSelection':{projectSectionIds:[]},
 'projectVaults.readSection':{version:1,content:'# Project overview\n\nA focused workspace for planning and reviewing work.\n\n## Current priorities\n\n- Keep tasks easy to scan.\n- Preserve drafts while switching views.\n- Review changes before applying them.',contentHash:'sample',currentContentHash:'sample',externallyModified:false},
 'savedWorkspaces.list':[workspace],'savedWorkspaces.get':workspace,'savedWorkspaces.getOperation':null,
 'changes.getRepositoryOverview':{defaultBranch:'main',branches:[],worktrees:[{path:'C:/sandbox/flapstack',branch:'codex/ui-simplification',head:'1234567890',isMain:false,isCurrent:true,isLocked:false,dirtyCount:3,stagedCount:0,modifiedCount:3,untrackedCount:0,conflictedCount:0},{path:'C:/installed/flapstack',branch:'main',head:'abcdef1234',isMain:true,isCurrent:false,isLocked:false,dirtyCount:0}]}
};
const empty=[]; const mutation={isPending:false,mutate:noop,mutateAsync:async()=>({})};
function branch(path=''){return new Proxy(()=>{}, {get:(_,key)=>key==='useQuery'?()=>query(data[path]??empty):key==='useMutation'?()=>mutation:key==='useSubscription'?noop:key==='then'?undefined:branch(path?path+'.'+key:key)});}
export const trpc=new Proxy(base,{get:(target,key)=>key==='useUtils'?()=>branch():key in target?target[key]:branch(key)});
export const trpcClient={};
`
const stubs = {
  panes: `export const WorkspacePaneAdapter=()=>null,WorkspacePaneBindingForm=()=>null;`,
  promotion: `export const PlanPromotionDialog=()=>null;`,
  comparison: `export const PlanSourceComparisonDialog=()=>null;`,
  devfixtures: `export const PlanKanbanDevFixtures=()=>null;`,
  trpc: mock,
  atoms: `import {atom} from 'jotai'; export const desktopViewAtom=atom(null),openAgentChatIdsAtom=atom([]),selectedAgentChatIdAtom=atom(null),showNewChatFormAtom=atom(false),selectedProjectAtom=atom({id:"fixture",name:"Sample project",path:"C:/sandbox"}),agentsMobileViewModeAtom=atom("chats"),agentsSidebarOpenAtom=atom(true),automationDetailIdAtom=atom(null);`,
  activity: `export const OrchestrationActivityPanel=()=>null;`,
  board: `export const SharedRecordsBoard=()=>null;`,
  selection: `export const writeSavedWorkspaceSelection=()=>{},readSavedWorkspaceSelection=()=>null,readPendingWorkspaceLayout=()=>null,writePendingWorkspaceLayout=()=>{};`,
  action: `export const retainRecordAction=()=>{};`,
}
await build({
  entryPoints: ["tests/fixtures/beta-react-ui.tsx"],
  outfile: resolve(output, "fixture.js"),
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
  plugins: [
    {
      name: "isolated-data",
      setup(build) {
        build.onResolve(
          {
            filter:
              /pane-adapters$|plan-promotion-dialog$|plan-source-comparison-dialog$|plan-kanban-dev-fixtures$|\/trpc$|\/agents\/atoms$|orchestration-activity-panel$|shared-records-board$|\/selection-storage$|\/record-action$/,
          },
          (args) => {
            const name = args.path.endsWith("pane-adapters")
              ? "panes"
              : args.path.endsWith("plan-promotion-dialog")
                ? "promotion"
                : args.path.endsWith("plan-source-comparison-dialog")
                  ? "comparison"
                  : args.path.endsWith("plan-kanban-dev-fixtures")
                    ? "devfixtures"
                    : args.path.endsWith("/trpc")
                      ? "trpc"
                      : args.path.endsWith("/atoms")
                        ? "atoms"
                        : args.path.endsWith("activity-panel")
                          ? "activity"
                          : args.path.endsWith("shared-records-board")
                            ? "board"
                            : args.path.endsWith("selection-storage")
                              ? "selection"
                              : "action"
            return { path: name, namespace: "fixture-mock" }
          },
        )
        build.onLoad({ filter: /.*/, namespace: "fixture-mock" }, (args) => ({
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
  resolve(output, "fixture.css"),
  (
    await postcss([tailwind(require(resolve("tailwind.config.js"))), autoprefixer]).process(css, {
      from: cssPath,
    })
  ).css,
)
writeFileSync(
  resolve(output, "index.html"),
  '<!doctype html><html class="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
)
writeFileSync(
  resolve(output, "main.cjs"),
  `
const {app,BrowserWindow,session}=require('electron');
const {writeFileSync}=require('node:fs'); const {resolve}=require('node:path');
const output=__dirname; app.setPath('userData',resolve(output,'profile'));
const report={samples:[],errors:[],syntheticData:true}; let win;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
 win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level===3)report.errors.push(message)});
 for(const [label,width,height] of [['desktop',1280,800],['narrow',390,844]]){
  win.setSize(width,height);
  for(const surface of ['fleet','automation','beta','records','knowledge','workspaces','plans','branches']){
   await win.loadFile(resolve(output,'index.html'),{query:{surface}}); await pause(300);
   const read=()=>win.webContents.executeJavaScript("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyText:document.body.innerText.slice(0,300),details:document.querySelectorAll('details').length,rootPresent:!!document.querySelector('[data-fixture-surface]'),titles:[...document.querySelectorAll('.workspace-title,.beta-page-title')].map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight})),font:getComputedStyle(document.querySelector('.beta-surface')).fontFamily})");
   const initial=await read(); if(!initial.rootPresent)throw Error('Fixture did not render: '+surface);
   if(initial.scrollWidth>initial.width+1)throw Error('Page overflow: '+surface);
   if(initial.titles.some(t=>t.size!=='20px'||t.weight!=='600'))throw Error('Inconsistent title role: '+JSON.stringify(initial.titles));
   writeFileSync(resolve(output,surface+'-'+label+'.png'),(await win.webContents.capturePage()).toPNG());
   let expanded=null;
   if(surface!=='automation'){
    await win.webContents.executeJavaScript("document.querySelector('details summary')?.click()");await pause(80); expanded=await read();
    writeFileSync(resolve(output,surface+'-'+label+'-expanded.png'),(await win.webContents.capturePage()).toPNG());
   }
   report.samples.push({surface,label,initial,expanded});
  }
 }
 report.hidden=!win.isVisible();report.status=report.errors.length?'errors':'captured';
 writeFileSync(resolve(output,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({output,status:report.status}));
}catch(error){report.failure=String(error);writeFileSync(resolve(output,'failure.json'),JSON.stringify(report,null,2));process.exitCode=1}
finally{if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)}});
`,
)
console.log(`Prepared isolated React fixture: ${output}`)
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
if (code !== 0) throw Error(`Fixture failed (${code})`)
