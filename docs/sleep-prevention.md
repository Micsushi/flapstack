# Sleep prevention

Preferences offers Off (default), Automatic, and On. Automatic qualifies live
agent streams, in-process runtime owners, and open owned PTYs, including an idle
terminal shell. Closing the last terminal and settling the last run releases the
assertion within five seconds. On does not require active work. The status reports
the actual owned assertion and whether agent work/open terminals qualify.

Windows and Linux use Electron's [app-suspension blocker](https://www.electronjs.org/docs/latest/api/power-save-blocker).
macOS first uses `/usr/bin/caffeinate -i -w <app PID>` and falls back to Electron
after helper failure. Apple's [implementation](https://github.com/apple-oss-distributions/PowerManagement/blob/main/caffeinate/caffeinate.c)
binds this assertion to the monitored process. No display-sleep assertion, shell,
privileged service, or global power preference is used. OS policy, forced sleep,
lid closure, and battery safety can still override idle-sleep prevention.

The mode is stored atomically within the app profile. Invalid settings default
to Off with a visible recovery message. Changing a mode supports shared Undo/Redo
and rejects stale changes from another window. Saving failure preserves the
previous mode; the UI reports that failure. Native assertion failure stays visible
and is retried by the bounded refresh. Quit releases only Flapstack's own assertion;
the macOS helper also watches the parent PID so a crashed app cannot deliberately
leave an unbound helper. Hidden Stage 6 performance profiles do not initialize it.

Unit tests use isolated assertion fakes. A windowless Windows Electron 39.8.10
probe also acquired and released a real app-suspension assertion. Actual macOS assertion/lid behavior,
Linux desktop power integration, and packaged quit/crash proof remain separate
platform verification requirements. This does not mark all S7-F5-T5 acceptance
complete.
