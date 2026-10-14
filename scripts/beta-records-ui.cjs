// Isolated shared-UI interaction checks. Synthetic transport, no live Records access.
const { resolve } = require("node:path")
const { mkdirSync, writeFileSync, readFileSync } = require("node:fs")
const { spawn } = require("node:child_process")
const assert = require("node:assert/strict")
const output =
  process.env.FLAPSTACK_BETA_UI_OUTPUT ||
  resolve(".local-evidence/beta-records-ui", `${Date.now()}-${process.pid}`)

if (!process.versions.electron) {
  ;(async () => {
    mkdirSync(output, { recursive: true })
    const { prepareProjectRecordsSource } = await import("./lib/project-records-source.mjs")
    const source = prepareProjectRecordsSource(process.cwd())
    await require("esbuild").build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
import {mountBoard} from ${JSON.stringify(resolve(source, "board.js"))};
const mode=new URLSearchParams(location.search).get('view')||'yap';
const path='projects/example/tasks.md';
const records=[{id:'TASK-1',title:'Simplify the settings screen',kind:'task',workClassification:{view:'current',reason:'Preview sample',sourceLinks:['fixture:preview']},state:'in_progress',history:[],projects:[{id:'example',name:'Example project'}]}];
const input={inputId:'input-1',version:1,originalText:'Simplify the settings screen and keep my saved preferences.',segments:[{id:'segment-1',text:'Simplify the settings screen'}],attachments:[],reviewable:true};
let proposal={proposalId:'proposal-1',inputId:'input-1',version:1,status:'proposed',reviewable:true,rows:[{id:'row-1',actionId:'action-1',projectId:'example',projectName:'Example project',sourceSegmentIds:['segment-1'],interpretedRequest:'Simplify the settings screen',uncertainty:false}],actions:[{id:'action-1',kind:'create',recordKind:'task',title:'Simplify the settings screen',rowIds:['row-1'],record:{description:'Keep saved preferences.'}}]};
proposal.rows.push({...proposal.rows[0],id:'row-2',actionId:'action-2',interpretedRequest:'Keep saved preferences'});proposal.actions.push({...proposal.actions[0],id:'action-2',title:'Keep saved preferences',rowIds:['row-2']});
let catalog={revision:'r1',setups:[{id:'setup-1',name:'Build and review',versions:[{version:1,digest:'fixture',definition:{schemaVersion:1,nodes:[{id:'builder',label:'Build',type:'role',settings:{model:'fixture'}},{id:'reviewer',label:'Review',type:'review',settings:{required:true}}],edges:[{id:'edge-1',from:'builder',to:'reviewer',kind:'reviews'}],layout:{builder:{x:20,y:20},reviewer:{x:240,y:20}}}}]}],assignments:[]};
window.calls=[];
const request=async(url,options={})=>{
 const body=options.body?JSON.parse(options.body):null;window.calls.push({url,body});let result={};
 if(url==='/v1/session')result={bearer:true};
 else if(url==='/v1/documents')result={documents:[{path}]};
 else if(url.startsWith('/v1/document?'))result={path,revision:'a'.repeat(64),document:{schemaVersion:1,title:'Tasks',records}};
 else if(url==='/v1/workflow')result={records:records.map(r=>({path,recordId:r.id,column:r.state,reasons:[]}))};
 else if(url==='/v1/agents')result={available:true,runs:[{id:'run-1',agentId:'agent-1',name:'Builder',projectId:'example',path,recordId:'TASK-1',status:'running',attemptId:'attempt-1',attemptRevision:1}],workspaces:{example:'C:/sandbox/example'},defaults:{}};
 else if(url==='/v1/records')result={records:[{path,recordId:'TASK-1',title:'Settings',kind:'task',revision:'r1',projects:[{id:'example'}]},{path,recordId:'TASK-2',title:'Preferences',kind:'task',revision:'r1',projects:[{id:'example'}]}]};
 else if(url==='/v1/setups'){
   if(body?.action==='save'){const setup=catalog.setups[0];setup.versions.push({version:setup.versions.length+1,digest:'new',definition:body.definition});catalog={...catalog,revision:'r2'};result={...catalog,setupId:setup.id,version:setup.versions.length};}
   else result=catalog;
 }
 else if(url.startsWith('/v1/yap/input'))result={input};
 else if(url==='/v1/yap/proposal'){if(body?.proposal){proposal={...body.proposal,version:proposal.version+1,status:'reviewed',approval:null};result={proposal};}else result={proposals:mode==='yap-review'?[proposal]:[]};}
 else if(url.startsWith('/v1/yap/proposal?'))result={proposal};
 else if(url==='/v1/yap/inference')result={proposal};
 else if(url==='/v1/yap/proposal/approve'){if(proposal.status==='approved'&&JSON.stringify(proposal.approval.selectedActionIds)!==JSON.stringify(body.selectedActionIds))throw Error('Save a corrected version before changing approval');proposal={...proposal,status:'approved',approval:{selectedActionIds:body.selectedActionIds}};result={proposal,approval:proposal.approval};}
 else if(options.method==='POST')throw Error('Unexpected fixture mutation: '+url);
 return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
};
window.mountFixture=()=>mountBoard(document.getElementById('host'),{embedded:true,hostNavigation:true,view:mode==='yap-review'?'yap':mode,request});
window.dispose=window.mountFixture();
`,
      },
      bundle: true,
      outfile: resolve(output, "fixture.js"),
    })
    const appCss = readFileSync(resolve("src/renderer/styles/globals.css"), "utf8")
    const betaCss = appCss.slice(
      appCss.indexOf("/* Beta workspace roles."),
      appCss.indexOf("/* Search highlight styles */"),
    )
    writeFileSync(resolve(output, "theme.css"), betaCss)
    writeFileSync(
      resolve(output, "index.html"),
      '<!doctype html><html class="dark"><link rel="stylesheet" href="theme.css"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0;background:#09090b"><div class="beta-surface beta-records-host"><div id="host"></div></div><script src="fixture.js"></script></body></html>',
    )
    const env = { ...process.env, FLAPSTACK_BETA_UI_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const executable = process.env.FLAPSTACK_UI_ELECTRON || require("electron")
    const child = spawn(executable, [__filename], { env, stdio: "inherit", windowsHide: true })
    const deadline = setTimeout(() => child.kill(), 60000)
    const code = await new Promise((done, reject) => {
      child.on("exit", done)
      child.on("error", reject)
    })
    clearTimeout(deadline)
    if (code !== 0) throw Error(`Beta Records UI check failed (${code})`)
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, nativeTheme } = require("electron")
  app.setPath("userData", resolve(output, "profile"))
  app.disableHardwareAcceleration()
  nativeTheme.themeSource = "dark"
  app.on("window-all-closed", () => {})
  const windows = []
  const read = (win, code) =>
    win.webContents.executeJavaScript(
      `(()=>{const root=document.querySelector('#host').shadowRoot;${code}})()`,
    )
  const ready = async (win, selector) => {
    for (let i = 0; i < 100; i++) {
      if (await read(win, `return !!root.querySelector(${JSON.stringify(selector)})`)) return
      await new Promise((done) => setTimeout(done, 30))
    }
    throw Error(`Missing ${selector}: ${await read(win, "return root.textContent.slice(-3000)")}`)
  }
  app.whenReady().then(async () => {
    try {
      for (const view of ["board", "yap", "yap-review", "setups", "fleet"]) {
        const win = new BrowserWindow({
          show: false,
          width: 1280,
          height: 800,
          webPreferences: {
            offscreen: true,
            backgroundThrottling: false,
            focusOnNavigation: false,
          },
        })
        windows.push(win)
        await win.loadFile(resolve(output, "index.html"), { query: { view } })
        await ready(
          win,
          view === "board"
            ? ".task-card"
            : view === "setups"
              ? "[data-node-id]"
              : view === "fleet"
                ? ".fleet-row"
                : view === "yap-review"
                  ? ".yap-action-toggle"
                  : "#yap-original-text",
        )
        for (const [size, width, height] of [
          ["desktop", 1280, 800],
          ["narrow", 390, 844],
        ]) {
          win.setSize(width, height)
          await new Promise((done) => setTimeout(done, 150))
          const overflow = await read(
            win,
            "return document.documentElement.scrollWidth > innerWidth + 1",
          )
          assert.equal(overflow, false, `${view} ${size} page overflow`)
          writeFileSync(
            resolve(output, `${view}-${size}.png`),
            (await win.webContents.capturePage()).toPNG(),
          )
        }
        await read(
          win,
          "document.querySelector('.beta-surface').style.setProperty('--workspace-text-body', '18px')",
        )
        assert.equal(
          await read(win, "return getComputedStyle(root.querySelector('.records-shell')).fontSize"),
          "18px",
          "Shared typography reaches the shadow tree",
        )
        await read(
          win,
          "document.querySelector('.beta-surface').style.removeProperty('--workspace-text-body')",
        )
        // Theme inheritance must follow the app even when it differs from the OS.
        for (const dark of [false, true]) {
          await read(win, `document.documentElement.classList.toggle('dark', ${dark})`)
          const theme = await read(
            win,
            `const style=getComputedStyle(root.querySelector('.records-shell'));const parent=getComputedStyle(document.querySelector('.beta-surface'));const probe=document.createElement('span');probe.style.color='hsl('+parent.getPropertyValue('--foreground')+')';document.querySelector('.beta-surface').append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {actual:style.color,expected}`,
          )
          assert.equal(theme.actual, theme.expected, "Embedded Records follows app theme")
        }
        if (view === "yap-review") {
          assert.equal(await read(win, 'return root.querySelector(".yap-source-row").hidden'), true)
          await read(
            win,
            'root.querySelector(".yap-action-toggle").focus();root.querySelector(".yap-action-toggle").click()',
          )
          assert.equal(
            await read(win, 'return root.querySelector(".yap-source-row").hidden'),
            false,
          )
          assert.equal(await read(win, "return root.activeElement?.className"), "yap-action-toggle")
          writeFileSync(
            resolve(output, "yap-expanded-narrow.png"),
            (await win.webContents.capturePage()).toPNG(),
          )
          await read(win, 'root.querySelector("[data-yap-approve]").click()')
          await ready(win, "[data-yap-apply]")
          assert.equal(
            await read(win, 'return root.querySelector("[data-yap-approve]").hidden'),
            true,
          )
          assert.equal(
            await read(win, 'return root.querySelector("[data-yap-apply]").disabled'),
            false,
          )
          assert.equal(
            await read(
              win,
              'return window.calls.filter(c=>c.url==="/v1/yap/proposal/apply").length',
            ),
            0,
          )
          writeFileSync(
            resolve(output, "yap-approved-narrow.png"),
            (await win.webContents.capturePage()).toPNG(),
          )
        }
        if (view === "yap-review") {
          await read(win, "root.querySelector('[aria-label=\"Include action action-2\"]').click()")
          assert.equal(await read(win, 'return !!root.querySelector("[data-yap-apply]")'), false)
          assert.equal(
            await read(win, 'return root.querySelector("[data-yap-approve]").hidden'),
            false,
          )
          assert.equal(
            await read(win, 'return root.querySelector("[data-yap-approve]").disabled'),
            true,
          )
          await read(win, 'root.querySelector("[data-yap-save]").click()')
          await ready(win, "[data-yap-approve]:not([disabled])")
          assert.equal(
            await read(
              win,
              "return root.querySelector('[aria-label=\"Include action action-2\"]').checked",
            ),
            false,
          )
          await read(win, 'root.querySelector("[data-yap-approve]").click()')
          await ready(win, "[data-yap-apply]")
          assert.deepEqual(
            await read(
              win,
              'return window.calls.filter(c=>c.url==="/v1/yap/proposal/approve").at(-1).body.selectedActionIds',
            ),
            ["action-1"],
          )
          await read(
            win,
            'const op=root.querySelector(\'[aria-label="Action for row-1"]\');op.value="combine";op.dispatchEvent(new Event("change"));',
          )
          await read(win, 'root.querySelector(".yap-content-editor").open=true')
          await new Promise((done) => setTimeout(done, 30))
          await read(
            win,
            'const picker=root.querySelector(\'[aria-label="Combine source for row-1"]\');picker.focus();picker.selectedIndex=1;picker.dispatchEvent(new Event("change"));',
          )
          assert.equal(
            await read(win, 'return root.querySelector(".yap-content-editor").open'),
            true,
          )
          assert.equal(
            await read(win, 'return root.activeElement?.getAttribute("aria-label")'),
            "Combine source for row-1",
          )
          await read(
            win,
            'const input=root.querySelector("#yap-original-text");input.value="My unsent revised request";input.dispatchEvent(new Event("input"));window.dispose();window.dispose=window.mountFixture();',
          )
          await ready(win, ".yap-action-toggle")
          assert.equal(
            await read(win, 'return root.querySelector("#yap-original-text").value'),
            "My unsent revised request",
          )
          assert.equal(
            await read(win, 'return root.querySelector("[data-yap-approve]").disabled'),
            true,
          )
          assert.equal(
            await read(
              win,
              'return JSON.parse(localStorage.getItem("projectRecordsYapDraft")).text',
            ),
            "My unsent revised request",
          )
          assert.equal(
            await read(
              win,
              'return window.calls.filter(c=>c.url==="/v1/yap/proposal/apply").length',
            ),
            0,
          )
        }
        if (view === "setups") {
          assert.equal(
            await read(win, 'return root.querySelector("#setup-assign").closest("details").open'),
            false,
          )
          await read(
            win,
            'const input=root.querySelector("#setup-name");input.value="Changed workflow";input.dispatchEvent(new Event("input"));root.querySelector("#setup-refresh").click()',
          )
          await new Promise((done) => setTimeout(done, 150))
          assert.equal(
            await read(win, 'return root.querySelector("#setup-name").value'),
            "Changed workflow",
          )
        }
        if (view === "fleet")
          assert.equal(await read(win, 'return root.querySelector("#fleet-health").hidden'), true)
        win.destroy()
      }
      console.log(
        "PASS: beta Records desktop/narrow layouts, expandable review focus, approval/apply boundary, workflow draft preservation, healthy Fleet.",
      )
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      for (const win of windows) if (!win.isDestroyed()) win.destroy()
      app.exit(process.exitCode || 0)
    }
  })
}
