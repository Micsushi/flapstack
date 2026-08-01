import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getUsageProvider } from "../src/main/lib/usage/registry"
import { credentialAccountTag } from "../src/main/lib/usage/provider-identity"
import { validateOpenAiOrganizationBinding } from "../src/main/lib/usage/providers/codex"
import { validateAnthropicOrganizationBinding } from "../src/main/lib/usage/providers/anthropic"
import {
  getUsageSettings,
  normalizeUsageSettings,
  setUsageSettings,
} from "../src/main/lib/usage/settings"
import { getProviderJson } from "../src/main/lib/usage/providers/http"

describe("Stage 6 organization usage contracts", () => {
  let configDirectory: string

  beforeEach(() => {
    configDirectory = mkdtempSync(join(tmpdir(), "flapstack-stage6-org-usage-"))
    vi.stubEnv("FLAPSTACK_CONFIG_DIR", configDirectory)
    vi.stubEnv("FLAPSTACK_DISABLE_LOCAL_USAGE_CREDENTIALS", "1")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    rmSync(configDirectory, { recursive: true, force: true })
  })

  it("normalizes explicit organization and project/workspace selectors", () => {
    const normalized = normalizeUsageSettings({
      organization: {
        openai: {
          organizationId: " org-openai ",
          projectIds: ["project-b", "project-a", "project-b", "", "x".repeat(300)],
        },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: ["workspace-2", "workspace-1", "workspace-2"],
        },
      },
    } as never)

    expect(normalized.organization).toEqual({
      openai: {
        organizationId: "org-openai",
        projectIds: ["project-a", "project-b"],
        validatedBinding: null,
      },
      anthropic: {
        organizationId: "org-anthropic",
        workspaceIds: ["workspace-1", "workspace-2"],
        validatedBinding: null,
      },
    })
  })

  it("does not poll Anthropic Admin endpoints until the exact binding is validated", async () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: null, projectIds: [], validatedBinding: null },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: ["workspace-a"],
          validatedBinding: null,
        },
      },
    })
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)

    const provider = getUsageProvider("anthropic")!
    const status = await provider.getStatus(context("sk-ant-admin"))
    const samples = await provider.pollLatest(context("sk-ant-admin"))

    expect(status).toMatchObject({
      accountTag: undefined,
      configured: false,
      status: "source-unavailable",
    })
    expect(status.detail).toContain("Validate the exact Anthropic organization")
    expect(samples).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("invalidates a validated Anthropic binding when the Admin credential changes", async () => {
    setValidatedAnthropicBinding("sk-ant-original", ["workspace-a"])
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)

    const provider = getUsageProvider("anthropic")!
    const status = await provider.getStatus(context("sk-ant-replaced"))
    const samples = await provider.pollLatest(context("sk-ant-replaced"))

    expect(status).toMatchObject({
      configured: false,
      status: "source-unavailable",
    })
    expect(samples).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("persists Anthropic proof only after the exact organization and workspaces validate", async () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: null, projectIds: [], validatedBinding: null },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: ["workspace-b", "workspace-a"],
          validatedBinding: null,
        },
      },
    })
    const fetch = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith("/organizations/me")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "org-anthropic" })))
      }
      const workspaceId = url.pathname.split("/").at(-1)
      return Promise.resolve(new Response(JSON.stringify({ id: workspaceId })))
    })
    vi.stubGlobal("fetch", fetch)

    await expect(
      validateAnthropicOrganizationBinding(
        "sk-ant-admin",
        "org-anthropic",
        ["workspace-b", "workspace-a"],
        new Date("2026-07-10T12:00:00Z"),
      ),
    ).resolves.toMatchObject({
      organizationId: "org-anthropic",
      credentialTag: credentialAccountTag("anthropic", "sk-ant-admin"),
      validatedAt: "2026-07-10T12:00:00.000Z",
      coverage: {
        selection: "selected-workspaces",
        workspaceIds: ["workspace-a", "workspace-b"],
      },
    })
    expect(getUsageSettings().organization.anthropic.validatedBinding).toMatchObject({
      organizationId: "org-anthropic",
      credentialTag: credentialAccountTag("anthropic", "sk-ant-admin"),
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("does not poll OpenAI Admin endpoints until the exact organization binding is validated", async () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: "org-openai", projectIds: ["project-a"] },
        anthropic: { organizationId: null, workspaceIds: [] },
      },
    } as never)
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)

    const provider = getUsageProvider("codex")!
    const status = await provider.getStatus(context("sk-admin"))
    const samples = await provider.pollLatest(context("sk-admin"))

    expect(status).toMatchObject({
      accountTag: undefined,
      configured: false,
      status: "source-unavailable",
    })
    expect(status.detail).toContain("Validate the exact OpenAI organization")
    expect(samples).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("invalidates a validated OpenAI binding when the Admin credential changes", async () => {
    setValidatedOpenAiBinding("sk-original", ["project-a"])
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)

    const provider = getUsageProvider("codex")!
    const status = await provider.getStatus(context("sk-replaced"))
    const samples = await provider.pollLatest(context("sk-replaced"))

    expect(status).toMatchObject({
      configured: false,
      status: "source-unavailable",
    })
    expect(samples).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("persists proof only when OpenAI confirms the selected organization", async () => {
    setUsageSettings({
      organization: {
        openai: {
          organizationId: "org-openai",
          projectIds: ["project-a"],
          validatedBinding: null,
        },
        anthropic: { organizationId: null, workspaceIds: [] },
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [], has_more: false }), {
          headers: { "openai-organization": "org-openai" },
        }),
      ),
    )

    await expect(
      validateOpenAiOrganizationBinding(
        "sk-admin",
        "org-openai",
        ["project-a"],
        new Date("2026-07-10T12:00:00Z"),
      ),
    ).resolves.toMatchObject({
      organizationId: "org-openai",
      credentialTag: credentialAccountTag("openai", "sk-admin"),
      coverage: { selection: "selected-projects", projectIds: ["project-a"] },
    })
    expect(getUsageSettings().organization.openai.validatedBinding?.validatedAt).toBe(
      "2026-07-10T12:00:00.000Z",
    )
  })

  it("polls OpenAI from the validated binding and persists exact coverage provenance", async () => {
    setValidatedOpenAiBinding("sk-admin", ["project-a"])
    const fetch = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      const url = new URL(input)
      expect(new Headers(init?.headers).get("OpenAI-Organization")).toBe("org-openai")
      expect(url.searchParams.getAll("group_by")).toContain("project_id")
      expect(url.searchParams.getAll("project_ids")).toEqual(["project-a"])
      const cost = url.pathname.endsWith("/costs")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                start_time: 1_783_000_000,
                end_time: 1_783_086_400,
                results: cost
                  ? [{ amount: { value: 1.25, currency: "eur" }, project_id: "project-a" }]
                  : [
                      {
                        input_tokens: 10,
                        output_tokens: 5,
                        num_model_requests: 2,
                        project_id: "project-a",
                      },
                    ],
              },
            ],
            has_more: false,
            next_page: null,
          }),
          { headers: { "openai-organization": "org-openai" } },
        ),
      )
    })
    vi.stubGlobal("fetch", fetch)

    const samples = await getUsageProvider("codex")!.pollLatest(context("sk-admin"))

    expect(samples).toContainEqual(
      expect.objectContaining({
        accountTag: "openai-org:org-openai:project:project-a",
        sourceTag: "organization-usage",
        totalTokens: 15,
        rawPayload: expect.objectContaining({
          organizationId: "org-openai",
          endpoint: "organization/usage/completions",
          retrievedAt: "2026-07-10T12:00:00.000Z",
          truthClass: "provider-reported",
          coverage: {
            source: "validated-binding",
            selection: "selected-projects",
            projectIds: ["project-a"],
          },
        }),
      }),
    )
    expect(samples).toContainEqual(
      expect.objectContaining({
        accountTag: "openai-org:org-openai:project:project-a",
        sourceTag: "organization-cost",
        currency: "eur",
        costQuality: "unknown",
        costUsd: null,
        rawPayload: expect.objectContaining({
          endpoint: "organization/costs",
          truthClass: "unknown",
          coverage: {
            source: "validated-binding",
            selection: "selected-projects",
            projectIds: ["project-a"],
          },
        }),
      }),
    )
    expect(getUsageSettings().organization.openai.validatedBinding).toMatchObject({
      organizationId: "org-openai",
      credentialTag: credentialAccountTag("openai", "sk-admin"),
      coverage: {
        selection: "selected-projects",
        projectIds: ["project-a"],
      },
    })
    expect(JSON.stringify(samples)).not.toContain("sk-admin")
  })

  it("rejects an OpenAI response from a different organization", async () => {
    setValidatedOpenAiBinding("sk-admin", [], "org-expected")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [], has_more: false, next_page: null }), {
          headers: { "openai-organization": "org-other" },
        }),
      ),
    )

    await expect(getUsageProvider("codex")!.pollLatest(context("sk-admin"))).rejects.toThrow(
      "different OpenAI organization",
    )
  })

  it("rejects rows outside the validated OpenAI project coverage", async () => {
    setValidatedOpenAiBinding("sk-admin", ["project-a"])
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        const cost = new URL(input).pathname.endsWith("/costs")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  start_time: 1_783_000_000,
                  end_time: 1_783_086_400,
                  results: cost
                    ? [{ amount: { value: 1, currency: "usd" }, project_id: "project-other" }]
                    : [{ input_tokens: 1, output_tokens: 1, project_id: "project-other" }],
                },
              ],
              has_more: false,
            }),
            { headers: { "openai-organization": "org-openai" } },
          ),
        )
      }),
    )

    await expect(getUsageProvider("codex")!.pollLatest(context("sk-admin"))).rejects.toThrow(
      "outside the validated OpenAI project coverage",
    )
  })

  it("polls Anthropic from the validated binding with exact coverage provenance", async () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: null, projectIds: [], validatedBinding: null },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: ["workspace-a"],
          validatedBinding: null,
        },
      },
    })
    const fetch = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith("/organizations/me")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "org-anthropic" })))
      }
      if (url.pathname.endsWith("/organizations/workspaces/workspace-a")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "workspace-a" })))
      }
      expect(url.searchParams.getAll("group_by[]")).toContain("workspace_id")
      expect(url.searchParams.getAll("workspace_ids[]")).toEqual(["workspace-a"])
      const cost = url.pathname.endsWith("/cost_report")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                starting_at: "2026-07-10T00:00:00Z",
                ending_at: "2026-07-11T00:00:00Z",
                results: cost
                  ? [{ amount: "123.45", currency: "USD", workspace_id: "workspace-a" }]
                  : [
                      {
                        uncached_input_tokens: 10,
                        cache_read_input_tokens: 5,
                        output_tokens: 3,
                        workspace_id: "workspace-a",
                      },
                    ],
              },
            ],
            has_more: false,
            next_page: null,
          }),
        ),
      )
    })
    vi.stubGlobal("fetch", fetch)

    await validateAnthropicOrganizationBinding(
      "sk-ant-admin",
      "org-anthropic",
      ["workspace-a"],
      new Date("2026-07-10T11:59:00Z"),
    )
    const samples = await getUsageProvider("anthropic")!.pollLatest(context("sk-ant-admin"))

    expect(fetch).toHaveBeenCalledTimes(4)
    expect(samples).toContainEqual(
      expect.objectContaining({
        accountTag: "anthropic-org:org-anthropic:workspace:workspace-a",
        sourceTag: "organization-cost",
        costUsd: 1.2345,
        rawPayload: expect.objectContaining({
          organizationId: "org-anthropic",
          workspaceId: "workspace-a",
          endpoint: "/v1/organizations/cost_report",
          retrievedAt: "2026-07-10T12:00:00.000Z",
          truthClass: "provider-reported",
          coverage: {
            source: "validated-binding",
            selection: "selected-workspaces",
            workspaceIds: ["workspace-a"],
          },
        }),
      }),
    )
    expect(samples).toContainEqual(
      expect.objectContaining({
        sourceTag: "organization-usage",
        totalTokens: 18,
        rawPayload: expect.objectContaining({
          endpoint: "/v1/organizations/usage_report/messages",
          truthClass: "provider-reported",
          coverage: {
            source: "validated-binding",
            selection: "selected-workspaces",
            workspaceIds: ["workspace-a"],
          },
        }),
      }),
    )
    expect(JSON.stringify(samples)).not.toContain("sk-ant-admin")
  })

  it("rejects Anthropic rows outside the validated workspace coverage", async () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: null, projectIds: [], validatedBinding: null },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: ["workspace-a"],
          validatedBinding: null,
        },
      },
    })
    const fetch = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith("/organizations/me")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "org-anthropic" })))
      }
      if (url.pathname.endsWith("/organizations/workspaces/workspace-a")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "workspace-a" })))
      }
      const cost = url.pathname.endsWith("/cost_report")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                starting_at: "2026-07-10T00:00:00Z",
                ending_at: "2026-07-11T00:00:00Z",
                results: cost
                  ? [{ amount: "100", currency: "USD", workspace_id: "workspace-other" }]
                  : [
                      {
                        uncached_input_tokens: 1,
                        output_tokens: 1,
                        workspace_id: "workspace-other",
                      },
                    ],
              },
            ],
            has_more: false,
          }),
        ),
      )
    })
    vi.stubGlobal("fetch", fetch)
    await validateAnthropicOrganizationBinding("sk-ant-admin", "org-anthropic", ["workspace-a"])

    await expect(
      getUsageProvider("anthropic")!.pollLatest(context("sk-ant-admin")),
    ).rejects.toThrow("outside the validated Anthropic workspace coverage")
  })

  it("invalidates only revoked Anthropic Admin polling and preserves personal samples", async () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: null, projectIds: [], validatedBinding: null },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: [],
          validatedBinding: null,
        },
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        const url = new URL(input)
        if (url.pathname.endsWith("/organizations/me")) {
          return Promise.resolve(new Response(JSON.stringify({ id: "org-anthropic" })))
        }
        return Promise.resolve(new Response(JSON.stringify({ data: [], has_more: false })))
      }),
    )
    await validateAnthropicOrganizationBinding("sk-ant-admin", "org-anthropic", [])

    const claudeDirectory = join(configDirectory, ".claude")
    mkdirSync(claudeDirectory, { recursive: true })
    writeFileSync(
      join(claudeDirectory, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "personal-token", refreshToken: "personal-refresh" },
      }),
    )
    vi.stubEnv("USERPROFILE", configDirectory)
    vi.stubEnv("HOME", configDirectory)
    vi.stubEnv("FLAPSTACK_DISABLE_LOCAL_USAGE_CREDENTIALS", "0")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        const url = new URL(input)
        if (url.pathname === "/api/oauth/usage") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                five_hour: {
                  utilization: 20,
                  resets_at: "2026-07-10T17:00:00Z",
                  is_enabled: true,
                },
              }),
            ),
          )
        }
        return Promise.resolve(new Response(null, { status: 401 }))
      }),
    )

    const reportSourceFailure = vi.fn()
    const provider = getUsageProvider("anthropic")!
    const samples = await provider.pollLatest(context("sk-ant-admin", reportSourceFailure))

    expect(samples).toEqual([
      expect.objectContaining({
        providerId: "anthropic",
        sourceTag: "personal-oauth",
        metricKey: "five_hour",
        percentUsed: 20,
      }),
    ])
    expect(reportSourceFailure).toHaveBeenCalledOnce()
    expect(reportSourceFailure).toHaveBeenCalledWith({
      source: "admin",
      accountTag: "anthropic-org:org-anthropic",
      status: "auth-failed",
      detail: "Provider rejected the configured credential",
    })
    expect(getUsageSettings().organization.anthropic.validatedBinding).toBeNull()
    await expect(provider.getStatus(context("sk-ant-admin"))).resolves.toMatchObject({
      configured: true,
      status: "ok",
    })

    await expect(provider.pollLatest(context("sk-ant-admin"))).resolves.toEqual([
      expect.objectContaining({ sourceTag: "personal-oauth" }),
    ])
    const adminRequests = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => new URL(String(input)).pathname.includes("/organizations/"))
    expect(adminRequests).toHaveLength(2)
  })

  it("invalidates only revoked OpenAI Admin polling and preserves personal samples", async () => {
    setValidatedOpenAiBinding("sk-admin", [])
    const codexDirectory = join(configDirectory, ".codex")
    mkdirSync(codexDirectory, { recursive: true })
    writeFileSync(
      join(codexDirectory, "auth.json"),
      JSON.stringify({
        tokens: { access_token: "personal-token", account_id: "personal-account" },
      }),
    )
    vi.stubEnv("CODEX_HOME", codexDirectory)
    vi.stubEnv("FLAPSTACK_DISABLE_LOCAL_USAGE_CREDENTIALS", "0")
    const fetch = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input)
      if (url.hostname === "chatgpt.com") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan_type: "plus",
              rate_limit: {
                primary_window: {
                  used_percent: 15,
                  reset_at: 1_783_086_400,
                  limit_window_seconds: 18_000,
                },
              },
            }),
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 401 }))
    })
    vi.stubGlobal("fetch", fetch)

    const reportSourceFailure = vi.fn()
    const provider = getUsageProvider("codex")!
    const samples = await provider.pollLatest(context("sk-admin", reportSourceFailure))

    expect(samples).toEqual([
      expect.objectContaining({
        providerId: "codex",
        sourceTag: "personal-oauth",
        metricKey: "five_hour",
        percentUsed: 15,
      }),
    ])
    expect(reportSourceFailure).toHaveBeenCalledOnce()
    expect(reportSourceFailure).toHaveBeenCalledWith({
      source: "admin",
      accountTag: "openai-org:org-openai",
      status: "auth-failed",
      detail: "Provider rejected the configured credential",
    })
    expect(getUsageSettings().organization.openai.validatedBinding).toBeNull()
    await expect(provider.getStatus(context("sk-admin"))).resolves.toMatchObject({
      configured: true,
      status: "ok",
    })

    await expect(provider.pollLatest(context("sk-admin"))).resolves.toEqual([
      expect.objectContaining({ sourceTag: "personal-oauth" }),
    ])
    const adminRequests = fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).hostname === "api.openai.com",
    )
    expect(adminRequests).toHaveLength(2)
  })

  it("rejects repeated opaque provider cursors instead of polling forever", async () => {
    setValidatedOpenAiBinding("sk-admin", [])
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [], has_more: true, next_page: "same-cursor" }), {
            headers: { "openai-organization": "org-openai" },
          }),
        ),
      ),
    )

    await expect(getUsageProvider("codex")!.pollLatest(context("sk-admin"))).rejects.toThrow(
      "repeated pagination cursor",
    )
  })

  it("retries a rate-limited provider request without exposing response content", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("sensitive", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal("fetch", fetch)

    await expect(
      getProviderJson<{ ok: boolean }>({
        providerId: "codex",
        url: "https://api.openai.com/v1/organization/costs",
        apiKey: "sk-admin-secret",
      }),
    ).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(fetch.mock.results)).not.toContain("sk-admin-secret")
  })

  it("persists normalized selectors in the daemon-readable non-secret settings", () => {
    setUsageSettings({
      organization: {
        openai: { organizationId: "org-openai", projectIds: ["project-a"] },
        anthropic: {
          organizationId: "org-anthropic",
          workspaceIds: ["workspace-a"],
          validatedBinding: null,
        },
      },
    } as never)
    expect(getUsageSettings().organization.openai.organizationId).toBe("org-openai")
    expect(getUsageSettings().organization.anthropic.workspaceIds).toEqual(["workspace-a"])
  })
})

function setValidatedOpenAiBinding(
  secret: string,
  projectIds: string[],
  organizationId = "org-openai",
) {
  setUsageSettings({
    organization: {
      openai: {
        organizationId,
        projectIds,
        validatedBinding: {
          organizationId,
          credentialTag: credentialAccountTag("openai", secret),
          validatedAt: "2026-07-10T11:59:00.000Z",
          coverage: {
            selection: projectIds.length > 0 ? "selected-projects" : "all-projects",
            projectIds,
          },
        },
      },
      anthropic: { organizationId: null, workspaceIds: [] },
    },
  } as never)
}

function setValidatedAnthropicBinding(
  secret: string,
  workspaceIds: string[],
  organizationId = "org-anthropic",
) {
  setUsageSettings({
    organization: {
      openai: {
        organizationId: null,
        projectIds: [],
        validatedBinding: null,
      },
      anthropic: {
        organizationId,
        workspaceIds,
        validatedBinding: {
          organizationId,
          credentialTag: credentialAccountTag("anthropic", secret),
          validatedAt: "2026-07-10T11:59:00.000Z",
          coverage: {
            selection: workspaceIds.length > 0 ? "selected-workspaces" : "all-workspaces",
            workspaceIds,
          },
        },
      },
    },
  })
}

function context(secret: string, reportSourceFailure?: (failure: unknown) => void) {
  return {
    now: new Date("2026-07-10T12:00:00Z"),
    source: "app-poll" as const,
    getSecret: async () => secret,
    log: () => undefined,
    reportSourceFailure,
  }
}
