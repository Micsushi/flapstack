"use client"

import { useId, useRef, useState } from "react"
import { useAtom } from "jotai"
import { ChevronLeft } from "lucide-react"

import { IconSpinner, GitHubIcon } from "../../components/ui/icons"
import { Logo } from "../../components/ui/logo"
import { Input } from "../../components/ui/input"
import { Button } from "../../components/ui/button"
import { Label } from "../../components/ui/label"
import { trpc } from "../../lib/trpc"
import { selectedProjectAtom } from "../agents/atoms"

export interface SelectRepoPageProps {
  embedded?: boolean
}

export function SelectRepoPage({ embedded = false }: SelectRepoPageProps) {
  const [, setSelectedProject] = useAtom(selectedProjectAtom)
  const [showClonePage, setShowClonePage] = useState(false)
  const [githubUrl, setGithubUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const folderButton = useRef<HTMLButtonElement>(null)
  const cloneButton = useRef<HTMLButtonElement>(null)
  const cloneInput = useRef<HTMLInputElement>(null)
  const inputId = useId()

  // Get tRPC utils for cache management
  const utils = trpc.useUtils()

  // Open folder mutation
  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (project) {
        // Optimistically update the projects list cache
        utils.projects.list.setData(undefined, (oldData) => {
          if (!oldData) return [project]
          const exists = oldData.some((p) => p.id === project.id)
          if (exists) {
            return oldData.map((p) =>
              p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
            )
          }
          return [project, ...oldData]
        })

        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: project.gitRemoteUrl,
          gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
        })
      }
    },
  })

  // Clone from GitHub mutation
  const cloneFromGitHub = trpc.projects.cloneFromGitHub.useMutation({
    onSuccess: (project) => {
      if (project) {
        utils.projects.list.setData(undefined, (oldData) => {
          if (!oldData) return [project]
          const exists = oldData.some((p) => p.id === project.id)
          if (exists) {
            return oldData.map((p) =>
              p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
            )
          }
          return [project, ...oldData]
        })

        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: project.gitRemoteUrl,
          gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
        })
        setShowClonePage(false)
        setGithubUrl("")
      }
    },
  })

  const handleOpenFolder = async () => {
    if (busy.current) return
    busy.current = true
    setError(null)
    try {
      await openFolder.mutateAsync()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open the repository.")
    } finally {
      busy.current = false
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) folderButton.current?.focus()
      })
    }
  }

  const handleCloneFromGitHub = async () => {
    if (!githubUrl.trim() || busy.current) return
    busy.current = true
    setError(null)
    try {
      await cloneFromGitHub.mutateAsync({ repoUrl: githubUrl.trim() })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not clone the repository.")
    } finally {
      busy.current = false
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          ;(cloneInput.current ?? cloneButton.current)?.focus()
        }
      })
    }
  }

  const handleBack = () => {
    if (busy.current) return
    setShowClonePage(false)
    setGithubUrl("")
    setError(null)
    requestAnimationFrame(() => cloneButton.current?.focus())
  }

  // Clone from GitHub page
  if (showClonePage) {
    return (
      <div
        className={`${embedded ? "h-full w-full" : "h-screen w-screen"} relative flex flex-col items-center justify-center bg-background select-none`}
      >
        {/* Draggable title bar area */}
        {!embedded && (
          <div
            className="fixed top-0 left-0 right-0 h-10"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />
        )}

        {/* Back button */}
        <button
          aria-label="Back to repository selection"
          onClick={handleBack}
          disabled={cloneFromGitHub.isPending}
          className={`${embedded ? "absolute top-4" : "fixed top-12"} left-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-foreground/5 disabled:opacity-50`}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="w-full max-w-[440px] space-y-8 px-4">
          {/* Header with dual icons */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5" fill="white" />
              </div>
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
                <GitHubIcon className="w-5 h-5 text-background" />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">Clone from GitHub</h1>
            </div>
          </div>

          {/* Input */}
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCloneFromGitHub()
            }}
          >
            <Label htmlFor={inputId}>Repository URL or owner/repo</Label>
            <div className="relative">
              <Input
                id={inputId}
                ref={cloneInput}
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="owner/repo"
                className="text-center pr-10"
                autoFocus
                readOnly={cloneFromGitHub.isPending}
                aria-describedby={error ? `${inputId}-error` : undefined}
              />
              {cloneFromGitHub.isPending && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <IconSpinner className="h-4 w-4" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Example: facebook/react or https://github.com/facebook/react
            </p>
            {error && (
              <p
                id={`${inputId}-error`}
                role="alert"
                className="text-sm text-red-700 dark:text-red-400 break-words"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={!githubUrl.trim() || cloneFromGitHub.isPending}
            >
              {cloneFromGitHub.isPending ? "Cloning..." : "Clone"}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  // Main select repo page
  return (
    <div
      className={`${embedded ? "h-full w-full" : "h-screen w-screen"} relative flex flex-col items-center justify-center bg-background select-none`}
    >
      {/* Draggable title bar area */}
      {!embedded && (
        <div
          className="fixed top-0 left-0 right-0 h-10"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}

      <div className="w-full max-w-[440px] space-y-8 px-4">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center mx-auto w-max">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-6 h-6" fill="white" />
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold tracking-tight">Select a repository</h1>
            <p className="text-sm text-muted-foreground">
              Choose a local folder to start working with
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3">
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400 break-words">
              {error}
            </p>
          )}
          <button
            ref={folderButton}
            onClick={handleOpenFolder}
            disabled={openFolder.isPending}
            className="w-full h-8 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {openFolder.isPending ? <IconSpinner className="h-4 w-4" /> : "Select folder"}
          </button>
          <button
            ref={cloneButton}
            onClick={() => {
              if (busy.current) return
              setError(null)
              setShowClonePage(true)
            }}
            disabled={openFolder.isPending || cloneFromGitHub.isPending}
            className="w-full h-8 px-4 bg-muted text-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted/80 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.06)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.06)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {cloneFromGitHub.isPending ? <IconSpinner className="h-4 w-4" /> : "Clone from GitHub"}
          </button>
        </div>
      </div>
    </div>
  )
}
