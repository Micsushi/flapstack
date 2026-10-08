const { resolve } = require("node:path")
const { mkdirSync, writeFileSync } = require("node:fs")
const { spawn } = require("node:child_process")
const assert = require("node:assert/strict")
const output =
  process.env.FLAPSTACK_BOARD_REFERENCE_OUTPUT ||
  resolve(".local-evidence/board-references", `${Date.now()}-${process.pid}`)

if (!process.versions.electron) {
  ;(async () => {
    mkdirSync(output, { recursive: true })
    const { prepareProjectRecordsSource } = await import("./lib/project-records-source.mjs")
    const source = prepareProjectRecordsSource(process.cwd())
    await require("esbuild").build({
      stdin: {
        contents: `
      import {mountBoard} from ${JSON.stringify(resolve(source, "board.js"))};
      const path='projects/'+(new URLSearchParams(location.search).get('doc') || 'example')+'/tasks.md';
      const records=['A short title','A much longer title that should wrap onto a second line while keeping all the cards the same size'].map((title,i)=>({id:'T-'+i,title,kind:'task',state:'planned',projects:[{id:'example',name:'Example'}],history:[],workClassification:{view:'current',reason:'Fixture',sourceLinks:['fixture']}}));
      const extra=new URLSearchParams(location.search).get('extra');
      if(extra)records.push({...records[0],id:extra,title:extra});
      window.records=records;
      window.remount=()=>{window.dispose?.();window.dispose=mountBoard(document.getElementById('host'),{embedded:true,hostNavigation:true,request:async(url)=>new Response(JSON.stringify(
        url==='/v1/session'?{bearer:true}:url==='/v1/documents'?{documents:[{path}]}:url.startsWith('/v1/document?')?{path,revision:'a'.repeat(64),document:{schemaVersion:1,title:'Tasks',records}}:url==='/v1/workflow'?{records:records.map(r=>({path,recordId:r.id,column:r.state,reasons:[]}))}:url==='/v1/agents'?{agents:[],runs:[],workspaces:{}}:{}
      ),{headers:{'Content-Type':'application/json'}})});};window.remount();
    `,
        resolveDir: process.cwd(),
      },
      bundle: true,
      outfile: resolve(output, "bundle.js"),
    })
    writeFileSync(
      resolve(output, "index.html"),
      '<html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0"><div id="host"></div><script src="bundle.js"></script></body></html>',
    )
    const env = { ...process.env, FLAPSTACK_BOARD_REFERENCE_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require("electron"), [__filename], {
      env,
      stdio: "inherit",
      windowsHide: true,
    })
    const deadline = setTimeout(() => child.kill(), 45000)
    const code = await new Promise((resolve, reject) => {
      child.on("exit", resolve)
      child.on("error", reject)
    })
    clearTimeout(deadline)
    if (code !== 0) throw Error(`Board reference check failed (${code})`)
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, nativeTheme } = require("electron")
  app.on("window-all-closed", () => {})
  app.setPath("userData", resolve(output, "profile"))
  nativeTheme.themeSource = "dark"
  const windows = []
  const read = (win, code) =>
    win.webContents.executeJavaScript(
      `(()=>{const root=document.querySelector('#host').shadowRoot;${code}})()`,
    )
  const ready = async (win) => {
    for (let i = 0; i < 100; i++) {
      if (
        await read(
          win,
          'return root.querySelectorAll(".ticket-number").length>0 && [...root.querySelectorAll(".ticket-number")].every(e=>/^#\\d+$/.test(e.textContent))',
        )
      )
        return
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw Error(
      "Numbers did not appear: " +
        (await read(
          win,
          'return root.querySelector("#board-message").textContent+" / "+root.querySelector("#task-board").textContent',
        )),
    )
  }
  const snapshot = (win) =>
    read(
      win,
      'return Object.fromEntries([...root.querySelectorAll(".ticket-compact")].map(e=>[e.dataset.recordId,e.querySelector(".ticket-number").textContent]))',
    )
  const open = async (extra, doc) => {
    const win = new BrowserWindow({
      show: false,
      width: 1400,
      height: 850,
      webPreferences: { offscreen: true, backgroundThrottling: false, focusOnNavigation: false },
    })
    windows.push(win)
    await win.loadFile(resolve(output, "index.html"), {
      query: { ...(extra ? { extra } : {}), ...(doc ? { doc } : {}) },
    })
    await ready(win)
    return win
  }
  app.whenReady().then(async () => {
    let exit = 0
    try {
      const first = await open()
      const initial = await snapshot(first)
      assert.equal(new Set(Object.values(initial)).size, 2)
      const heights = await read(
        first,
        'return [...root.querySelectorAll(".ticket-compact")].map(e=>e.getBoundingClientRect().height)',
      )
      assert.equal(new Set(heights).size, 1)
      const query = initial["T-0"]
      await read(
        first,
        `const input=root.querySelector('#board-search');input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input'));`,
      )
      assert.deepEqual(await snapshot(first), { "T-0": query })
      await read(
        first,
        "window.records[0].title='Renamed';window.records[0].state='done';window.records.reverse();window.remount();",
      )
      await ready(first)
      assert.deepEqual(await snapshot(first), initial)
      first.destroy()
      const reopened = await open()
      assert.deepEqual(await snapshot(reopened), initial)
      const [a, b] = await Promise.all([open("new-a"), open("new-b")])
      const na = await snapshot(a),
        nb = await snapshot(b)
      assert.equal(na["T-0"], query)
      assert.equal(nb["T-0"], query)
      assert.notEqual(na["new-a"], nb["new-b"])
      await read(reopened, "window.records.pop();window.remount();")
      await ready(reopened)
      await read(
        reopened,
        "window.records.push({id:'later',title:'Later',kind:'task',state:'planned',projects:[{id:'example',name:'Example'}],history:[],workClassification:{view:'current',reason:'Fixture',sourceLinks:['fixture']}});window.remount();",
      )
      await ready(reopened)
      const other = await open(undefined, "other-document")
      const otherNumbers = await snapshot(other)
      assert.notEqual(otherNumbers["T-0"], query)
      const later = await snapshot(reopened)
      assert(![...Object.values(initial), na["new-a"], nb["new-b"]].includes(later.later))
      const waitFor = async (win, expression) => {
        for (let i = 0; i < 100; i++) {
          if (await read(win, expression)) return
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw Error(`Timed out: ${expression}`)
      }
      const editReference = async (win, id, value, submit = true) => {
        await read(
          win,
          `const card=root.querySelector('[data-record-id="${id}"]');card.open=true;const input=card.querySelector('.reference-input');input.focus();input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input'));${submit ? "card.querySelector('form').requestSubmit();" : ""}`,
        )
      }
      const referenceIs = (id, value) =>
        `return root.querySelector('[data-record-id="${id}"] .ticket-number')?.textContent===${JSON.stringify(value)}`
      await editReference(a, "T-0", "FLAP-42")
      await waitFor(a, referenceIs("T-0", "FLAP-42"))
      assert(
        await read(
          a,
          `return root.activeElement===root.querySelector('[data-record-id="T-0"] .reference-input')`,
        ),
      )
      await editReference(a, "T-0", "newer unsaved text", false)
      await read(a, "root.querySelector('#board-undo').click()")
      await waitFor(a, referenceIs("T-0", query))
      assert.equal(
        await read(a, `return root.querySelector('[data-record-id="T-0"] .reference-input').value`),
        "newer unsaved text",
      )
      await read(a, "root.querySelector('#board-redo').click()")
      await waitFor(a, referenceIs("T-0", "FLAP-42"))
      assert.equal(
        await read(a, `return root.querySelector('[data-record-id="T-0"] .reference-input').value`),
        "newer unsaved text",
      )
      // A stale window may not silently overwrite an already-saved reference.
      await editReference(b, "T-0", "OTHER")
      await waitFor(
        b,
        `return root.querySelector('[data-record-id="T-0"] .reference-error')?.textContent.includes('another window')`,
      )
      await read(b, "window.remount()")
      await waitFor(b, referenceIs("T-0", "FLAP-42"))
      await editReference(b, "T-1", "flap-42")
      await waitFor(
        b,
        `return root.querySelector('[data-record-id="T-1"] .reference-error')?.textContent.includes('already assigned')`,
      )
      assert.equal((await snapshot(b))["T-1"], initial["T-1"])
      assert.equal(
        await read(b, `return root.querySelector('[data-record-id="T-1"] .reference-input').value`),
        "flap-42",
      )
      await editReference(b, "T-1", query)
      await waitFor(
        b,
        `return root.querySelector('[data-record-id="T-1"] .reference-error')?.textContent.includes('reserved')`,
      )
      await read(
        b,
        `const input=root.querySelector('#board-search');input.value='flap-42';input.dispatchEvent(new Event('input'));`,
      )
      assert.deepEqual(await snapshot(b), { "T-0": "FLAP-42" })
      await read(
        b,
        `const input=root.querySelector('#board-search');input.value='';input.dispatchEvent(new Event('input'));`,
      )
      await editReference(b, "T-0", "")
      await waitFor(b, referenceIs("T-0", query))
      await read(b, "root.querySelector('#board-undo').click()")
      await waitFor(b, referenceIs("T-0", "FLAP-42"))
      await read(b, "root.querySelector('#board-redo').click()")
      await waitFor(b, referenceIs("T-0", query))
      await editReference(b, "T-0", "FLAP-42")
      await waitFor(b, referenceIs("T-0", "FLAP-42"))
      await read(b, "window.remount()")
      await waitFor(b, referenceIs("T-0", "FLAP-42"))
      await new Promise((resolve) => setTimeout(resolve, 100))
      writeFileSync(resolve(output, "desktop.png"), (await b.webContents.capturePage()).toPNG())
      await read(b, `root.querySelector('[data-record-id="T-0"]').open=true`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      writeFileSync(
        resolve(output, "reference-editor.png"),
        (await b.webContents.capturePage()).toPNG(),
      )
      b.setSize(390, 844)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert(await read(b, "return document.documentElement.scrollWidth<=innerWidth"))
      writeFileSync(resolve(output, "phone.png"), (await b.webContents.capturePage()).toPNG())
      await read(
        other,
        "Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});window.remount();",
      )
      for (let i = 0; i < 100; i++) {
        if (
          await read(
            other,
            'return root.querySelector("#board-message").textContent.includes("could not be saved")',
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert(
        await read(
          other,
          'return root.querySelector("#board-message").textContent.includes("could not be saved")',
        ),
      )
      assert.equal((await snapshot(other))["T-0"], "T-0")
      console.log(
        "PASS: editable references, duplicate rejection, clear-to-default, saved/draft Undo/Redo, stale-window rejection, custom search/persistence, short unique references, exact-number search, rename/move/reorder stability, reopen persistence, concurrent windows, distinct document identities, storage-failure fallback, no reuse, equal card heights, phone layout",
      )
      console.log(output)
    } catch (error) {
      console.error(error)
      exit = 1
    } finally {
      windows.forEach((win) => {
        if (!win.isDestroyed()) win.destroy()
      })
      app.exit(exit)
    }
  })
}
