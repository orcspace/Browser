const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const defaults = require("../config/default.json");
let fixture, base;
test.beforeAll(async () => {
  fixture = http.createServer((req, res) => {
    if (req.url === "/download") {
      res.writeHead(200, {
        "Content-Disposition": 'attachment; filename="hello.txt"',
        "Content-Type": "text/plain",
      });
      return res.end("Browser download fixture");
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><title>Fixture page</title><h1>It works</h1><a href="/second">Second</a><a href="/popup" target="_blank">Popup</a><script>window.receivedHeaders=' +
        JSON.stringify(req.headers) +
        "</script>",
    );
  });
  await new Promise((resolve) => fixture.listen(0, "0.0.0.0", resolve));
  base = `http://localhost:${fixture.address().port}`;
});
test.afterAll(() => fixture.close());
async function launch(profile, extraArgs = []) {
  const application = await electron.launch({
    chromiumSandbox: true,
    args: [path.join(__dirname, ".."), ...extraArgs],
    env: { ...process.env, BROWSER_PROFILE: profile },
  });
  const page = await application.firstWindow();
  await page.waitForFunction(
    () => window.browser && document.querySelector("#search"),
  );
  return { application, page };
}
const getState = (page) => page.evaluate(() => window.browser.state());
const command = (page, name, data) =>
  page.evaluate(([n, d]) => window.browser.action(n, d), [name, data]);
const remote = (application, expression) =>
  application.evaluate(async ({ webContents }, expr) => {
    const content = webContents
      .getAllWebContents()
      .find((wc) => wc.getURL().startsWith("http:"));
    if (!content) return null;
    return content.executeJavaScript(expr);
  }, expression);

test("real navigation, isolation, shortcuts, pinning and restore", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-desktop-"));
  let application;
  try {
    let page;
    ({ application, page } = await launch(profile));
    await expect(page.locator("#newtab")).toBeVisible();
    await page.locator("#search").fill(base);
    await page.locator("#search").press("Enter");
    await expect
      .poll(() => remote(application, "document.title"))
      .toBe("Fixture page");
    expect(
      await remote(
        application,
        "[typeof require, typeof process, typeof window.browser]",
      ),
    ).toEqual(["undefined", "undefined", "undefined"]);
    expect(
      await application.evaluate(({ app }) =>
        app.commandLine.hasSwitch("no-sandbox"),
      ),
    ).toBe(false);
    expect(
      await application.evaluate(({ webContents }) => {
        const preferences = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith("http:"))
          .getLastWebPreferences();
        return {
          sandbox: preferences.sandbox,
          node: preferences.nodeIntegration,
          isolated: preferences.contextIsolation,
        };
      }),
    ).toEqual({ sandbox: true, node: false, isolated: true });
    expect(await remote(application, "window.receivedHeaders.dnt")).toBe("1");
    expect(await remote(application, 'window.receivedHeaders["sec-gpc"]')).toBe(
      "1",
    );
    await command(page, "pinTab");
    await expect(page.locator("#pinned-tabs .tab")).toHaveCount(1);
    // Electron's before-input-event is a native input hook. CDP keyboard
    // injection bypasses it, so exercise the actual native input path here.
    await application.evaluate(({ BrowserWindow }, platform) => {
      const wc = BrowserWindow.getFocusedWindow().webContents;
      const modifiers = [platform === "darwin" ? "meta" : "control"];
      wc.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers });
      wc.sendInputEvent({ type: "keyUp", keyCode: "T", modifiers });
    }, process.platform);
    await expect.poll(async () => (await getState(page)).tabs.length).toBe(2);
    await page.locator("#address").fill("y майнкрафт");
    await expect(page.locator("#engine-indicator")).toHaveText("YouTube");
    await page.locator("#address").press("Enter");
    await expect
      .poll(async () => {
        const current = await getState(page);
        return current.tabs.find((t) => t.id === current.activeId)?.url;
      })
      .toContain("youtube.com/results?search_query=");
    await command(page, "closeTab");
    await expect(page.locator("#pinned-tabs .tab")).toHaveCount(1);
    await command(page, "reopenTab");
    await expect.poll(async () => (await getState(page)).tabs.length).toBe(2);
    await command(page, "closeTab");
    await command(page, "toggleSidebar");
    await expect(page.locator("body")).toHaveClass(/collapsed/);
    await application.close();
    application = null;
    ({ application, page } = await launch(profile));
    await expect(page.locator("#pinned-tabs .tab")).toHaveCount(1);
    expect((await getState(page)).tabs[0].url).toBe(`${base}/`);
    expect((await getState(page)).config.appearance.sidebarCollapsed).toBe(
      true,
    );
  } finally {
    if (application) await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("config editor applies settings and rejects invalid updates; website popups stay isolated", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-settings-"));
  const { application, page } = await launch(profile);
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const editor = page.locator("#config-editor");
    const config = structuredClone(defaults);
    config.appearance.accent = "#ffaabb";
    config.appearance.sidebarWidth = 280;
    await editor.fill(JSON.stringify(config));
    await page.getByText("Save changes", { exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue(
            "--sidebar",
          ),
        ),
      )
      .toBe("280px");
    await editor.fill("{broken");
    await page.getByText("Save changes", { exact: true }).click();
    await expect(page.locator("#toast")).toBeVisible();
    expect((await getState(page)).config.appearance.accent).toBe("#ffaabb");
    await command(page, "closePanel");
    await command(page, "navigate", base);
    await expect
      .poll(() => remote(application, "document.title"))
      .toBe("Fixture page");
    await remote(application, 'document.querySelector("a[target]").click()');
    await expect.poll(async () => (await getState(page)).tabs.length).toBe(2);
    expect(
      (await getState(page)).tabs.some((tab) => tab.url === `${base}/popup`),
    ).toBe(true);
    const denied = await command(page, "navigate", "file:///etc/passwd");
    expect(denied.ok).toBe(false);
    // A web renderer cannot call the chrome's IPC channels.
    expect(await remote(application, "typeof window.browser")).toBe(
      "undefined",
    );
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("unpacked extension content scripts and downloads", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-extension-"));
  const extension = path.join(profile, "extension");
  fs.mkdirSync(extension);
  fs.writeFileSync(
    path.join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Fixture extension",
      version: "1.0",
      content_scripts: [
        { matches: ["http://localhost/*"], js: ["content.js"] },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(extension, "content.js"),
    'document.documentElement.dataset.extension = "loaded";',
  );
  const { application, page } = await launch(profile);
  try {
    await application.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, extension);
    await command(page, "installExtension");
    await expect
      .poll(async () => (await getState(page)).extensions[0]?.name)
      .toBe("Fixture extension");
    await command(page, "navigate", base);
    await expect
      .poll(() =>
        remote(application, "document.documentElement.dataset.extension"),
      )
      .toBe("loaded");
    const destination = path.join(profile, "hello.txt");
    await application.evaluate(({ session }, file) => {
      session
        .fromPartition("persist:browser")
        .once("will-download", (_event, item) => item.setSavePath(file));
    }, destination);
    await command(page, "navigate", `${base}/download`);
    await expect
      .poll(async () => (await getState(page)).downloads[0]?.state)
      .toBe("completed");
    expect(fs.readFileSync(destination, "utf8")).toBe(
      "Browser download fixture",
    );
    expect((await getState(page)).tabs[0].url).toBe(`${base}/`);
    await command(page, "newTab");
    const secondDestination = path.join(profile, "newtab-download.txt");
    await application.evaluate(({ session }, file) => {
      session
        .fromPartition("persist:browser")
        .once("will-download", (_event, item) => item.setSavePath(file));
    }, secondDestination);
    await command(page, "navigate", `${base}/download`);
    await expect
      .poll(async () => (await getState(page)).downloads[0]?.state)
      .toBe("completed");
    await expect(page.locator("#newtab")).toBeVisible();
    const snapshot = await getState(page);
    expect(snapshot.tabs.find((tab) => tab.id === snapshot.activeId).url).toBe(
      null,
    );
    await command(
      page,
      "removeExtension",
      (await getState(page)).extensions[0].id,
    );
    await expect
      .poll(async () => (await getState(page)).extensions.length)
      .toBe(0);
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("media permission asks once per request and blocked location stays denied", async () => {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "browser-permissions-"),
  );
  const { application, page } = await launch(profile, [
    "--use-fake-device-for-media-stream",
  ]);
  try {
    await application.evaluate(({ dialog }) => {
      global.permissionPrompts = 0;
      dialog.showMessageBox = async () => {
        global.permissionPrompts++;
        return { response: 1 };
      };
    });
    await command(page, "navigate", base);
    await expect
      .poll(() => remote(application, "document.title"))
      .toBe("Fixture page");
    expect(
      await remote(
        application,
        'navigator.permissions.query({name:"geolocation"}).then(p=>p.state)',
      ),
    ).toBe("denied");
    expect(
      await remote(
        application,
        'navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return "approved"})',
      ),
    ).toBe("approved");
    expect(await application.evaluate(() => global.permissionPrompts)).toBe(1);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0 });
    });
    expect(
      await remote(
        application,
        'navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return "approved"}).catch(e=>e.name)',
      ),
    ).toBe("NotAllowedError");
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("custom CSS aligns native content, keeps tab nodes stable and preserves settings drafts", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-custom-"));
  const { application, page } = await launch(profile);
  try {
    await command(page, "navigate", base);
    await expect
      .poll(() => remote(application, "document.title"))
      .toBe("Fixture page");
    await page.evaluate(() => {
      window.originalTab = document.querySelector("[data-tab]");
    });
    await remote(application, 'document.title = "Updated title"');
    await expect(page.locator(".tab-name")).toHaveText("Updated title");
    expect(
      await page.evaluate(
        () => window.originalTab === document.querySelector("[data-tab]"),
      ),
    ).toBe(true);
    const config = (await getState(page)).config;
    config.appearance.cssVariables["--sidebar"] = "310px";
    config.appearance.customCSS =
      "#viewport,.page { top:66px; } #toolbar { height:66px; }";
    expect((await command(page, "saveConfig", JSON.stringify(config))).ok).toBe(
      true,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.querySelector("#viewport").getBoundingClientRect().x,
        ),
      )
      .toBe(310);
    const expected = await page.evaluate(() => {
      const v = document.querySelector("#viewport"),
        r = v.getBoundingClientRect();
      return {
        x: Math.round(r.x + v.clientLeft),
        y: Math.round(r.y + v.clientTop),
        width: v.clientWidth,
        height: v.clientHeight,
      };
    });
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]
            .contentView.children.find((view) =>
              view.webContents?.getURL().startsWith("http:"),
            )
            ?.getBounds(),
        ),
      )
      .toEqual(expected);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.querySelector("#viewport").getBoundingClientRect().x,
        ),
      )
      .toBe(310);
    await command(page, "settings");
    const draft = '{"unfinished":';
    await page.locator("#config-editor").fill(draft);
    await command(page, "downloads");
    await expect(page.locator("#panel h2")).toHaveText("Downloads.");
    await command(page, "settings");
    await expect(page.locator("#config-editor")).toHaveValue(draft);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page
      .getByRole("button", { name: "Reset settings", exact: true })
      .click();
    await expect(page.locator("#config-editor")).toHaveValue(
      JSON.stringify(defaults, null, 2),
    );
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("matte glass persists, applies transparency on restart and external invalid config keeps last valid state", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-glass-"));
  let { application, page } = await launch(profile);
  try {
    await command(page, "settings");
    await page
      .getByRole("button", { name: "Matte glass", exact: true })
      .click();
    await expect(page.locator("body")).toHaveClass(/glass/);
    expect((await getState(page)).restartRequired).toBe(true);
    await expect(
      page.getByRole("button", { name: "Restart Browser", exact: true }),
    ).toBeVisible();
    const file = path.join(profile, "config.json");
    const valid = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, "{invalid");
    await expect
      .poll(async () => (await getState(page)).configError)
      .not.toBe("");
    expect((await getState(page)).config.appearance.material).toBe("glass");
    fs.writeFileSync(file, valid);
    await expect.poll(async () => (await getState(page)).configError).toBe("");
    await application.close();
    application = null;
    ({ application, page } = await launch(profile));
    expect((await getState(page)).restartRequired).toBe(false);
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor(),
      ),
    ).toMatch(/^#000000(?:00)?$/);
    await expect(page.locator("body")).toHaveClass(/glass/);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
  } finally {
    if (application) await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("closing and reopening a window flushes state without a stale save timer", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-lifecycle-"));
  const { application, page } = await launch(profile);
  try {
    await command(page, "navigate", base);
    await expect
      .poll(() => remote(application, "document.title"))
      .toBe("Fixture page");
    await command(page, "pinTab");
    await application.evaluate(({ app, BrowserWindow }) => {
      app.removeAllListeners("window-all-closed");
      BrowserWindow.getAllWindows()[0].close();
    });
    // Advance past the old debounced save deadline with the process alive,
    // matching macOS's close-window lifecycle on every test platform.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(
      JSON.parse(fs.readFileSync(path.join(profile, "tabs.json"), "utf8")).tabs,
    ).toHaveLength(1);
    const reopened = application.waitForEvent("window");
    await application.evaluate(({ app }) => app.emit("activate"));
    const next = await reopened;
    await expect(next.locator("#pinned-tabs .tab")).toHaveCount(1);
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("reopen survives the tab limit and idle timing starts when a tab loses focus", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-sleep-"));
  const { application, page } = await launch(profile);
  try {
    await command(page, "navigate", base);
    await expect
      .poll(() => remote(application, "document.title"))
      .toBe("Fixture page");
    const first = (await getState(page)).activeId;
    await command(page, "newTab");
    await command(page, "navigate", `${base}/second`);
    await expect
      .poll(async () =>
        (await getState(page)).tabs.every((tab) => !tab.loading),
      )
      .toBe(true);
    await command(page, "closeTab");
    const config = (await getState(page)).config;
    config.tabs.maxOpen = 1;
    await command(page, "saveConfig", JSON.stringify(config));
    expect((await command(page, "reopenTab")).ok).toBe(false);
    config.tabs.maxOpen = 80;
    await command(page, "saveConfig", JSON.stringify(config));
    await command(page, "reopenTab");
    await expect.poll(async () => (await getState(page)).tabs.length).toBe(2);
    const second = (await getState(page)).activeId;
    await expect
      .poll(async () =>
        (await getState(page)).tabs.every((tab) => !tab.loading),
      )
      .toBe(true);
    await application.evaluate(() => {
      const original = Date.now;
      Date.now = () => original() + 20 * 60_000;
    });
    await command(page, "newTab");
    await expect
      .poll(
        async () =>
          (await getState(page)).tabs.find((tab) => tab.id === first)?.sleeping,
        { timeout: 35000, intervals: [500, 1000] },
      )
      .toBe(true);
    expect(
      (await getState(page)).tabs.find((tab) => tab.id === second).sleeping,
    ).toBe(false);
    await command(page, "activate", first);
    await expect
      .poll(
        async () =>
          (await getState(page)).tabs.find((tab) => tab.id === first)?.sleeping,
      )
      .toBe(false);
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
