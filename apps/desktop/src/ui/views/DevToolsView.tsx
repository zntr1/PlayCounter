import { Database, Library, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store";
import {
  clearFakeHistory,
  clearLocalLibrary,
  seedFakeHistory,
} from "../../tracker";
import { Panel } from "../components";
import { Button, Modal } from "../primitives";

export function DevToolsView() {
  const [confirmClearLibrary, setConfirmClearLibrary] = useState(false);
  const settings = useAppStore((state) => state.settings);
  const recentSessions = useAppStore((state) => state.recentSessions);
  const exeCache = useAppStore((state) => state.exeCache);
  const hasLocalLibraryData = useAppStore(
    (state) =>
      state.recentSessions.length > 0 ||
      state.activeSessions.length > 0 ||
      state.ambiguousMatches.length > 0 ||
      state.exeCache.size > 0 ||
      state.gameMetadata.size > 0 ||
      state.emulatorMappings.size > 0 ||
      state.emulatorObservations.length > 0 ||
      state.archivedSeconds > 0 ||
      Object.keys(state.archivedGameSeconds).length > 0 ||
      Object.keys(state.playtimeAdjustments).length > 0 ||
      state.autoDetectedGameKeys.length > 0,
  );
  const runtimeLog = useAppStore((state) => state.runtimeLog);
  const setDevNumber = useAppStore((state) => state.setDevNumber);
  const setApiEndpoint = useAppStore((state) => state.setApiEndpoint);
  const toggleVerboseLogs = useAppStore((state) => state.toggleVerboseLogs);
  const addToast = useAppStore((state) => state.addToast);
  const fakeSessionCount = recentSessions.filter((session) =>
    session.exeName.startsWith("playcounter-fake-"),
  ).length;
  function handleSeedFakeHistory() {
    seedFakeHistory();
    addToast({
      tone: "success",
      title: "Fake history seeded",
      detail: "Local fake sessions were added for testing.",
    });
  }

  function handleClearFakeHistory() {
    clearFakeHistory();
    addToast({
      tone: "success",
      title: "Fake history cleared",
      detail: "Local fake sessions were removed.",
    });
  }

  return (
    <div className="grid max-w-3xl gap-5">
      <Panel className="grid gap-4 p-5">
        <NumberInput
          label="Polling interval"
          suffix="seconds"
          value={settings.pollingIntervalSeconds}
          onChange={(value) => setDevNumber("pollingIntervalSeconds", value)}
        />
        <NumberInput
          label="Unmatched retry"
          suffix="days"
          value={settings.unmatchedRetryDays}
          onChange={(value) => setDevNumber("unmatchedRetryDays", value)}
        />
      </Panel>
      <Panel className="grid gap-4 p-5">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">API endpoint override</span>
          <input
            value={settings.apiEndpoint}
            onChange={(event) => setApiEndpoint(event.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-text outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.verboseLogs}
            onChange={toggleVerboseLogs}
            className="h-4 w-4 accent-accent"
          />
          <span>Verbose log</span>
        </label>
      </Panel>
      <Panel className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-text">Fake history</h2>
            <p className="mt-1 text-sm text-text-muted">
              Add local-only sample sessions for History and My Games testing.
            </p>
            <p className="mt-2 text-sm text-text-muted">
              Seeded sessions:{" "}
              <span className="font-mono text-text">{fakeSessionCount}</span>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              icon={Database}
              variant="primary"
              onClick={handleSeedFakeHistory}
            >
              Seed
            </Button>
            <Button
              icon={Trash2}
              variant="danger"
              onClick={handleClearFakeHistory}
              disabled={fakeSessionCount === 0}
            >
              Clear
            </Button>
          </div>
        </div>
      </Panel>
      <Panel className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-text">Local library</h2>
            <p className="mt-1 text-sm text-text-muted">
              Reset games, history, playtime, and cached matches for an empty
              library test. Settings, ignored processes, and install identity
              stay intact.
            </p>
            <p className="mt-2 text-sm text-text-muted">
              Cached matches:{" "}
              <span className="font-mono text-text">{exeCache.size}</span>
              {" · "}sessions:{" "}
              <span className="font-mono text-text">
                {recentSessions.length}
              </span>
            </p>
          </div>
          <Button
            className="shrink-0"
            icon={Trash2}
            variant="danger"
            onClick={() => setConfirmClearLibrary(true)}
            disabled={!hasLocalLibraryData}
          >
            Clear library
          </Button>
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 font-medium">
          Runtime log
        </div>
        <div className="max-h-80 divide-y divide-border overflow-auto">
          {runtimeLog.length === 0 ? (
            <div className="px-4 py-8 text-sm text-text-muted">
              No runtime events recorded.
            </div>
          ) : null}
          {runtimeLog.map((entry) => (
            <div key={entry.id} className="grid gap-1 px-4 py-2 text-sm">
              <span>{entry.message}</span>
              <span className="font-mono text-xs text-text-faint">
                {new Date(entry.at).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </Panel>
      {confirmClearLibrary ? (
        <Modal
          size="sm"
          labelId="clear-local-library-title"
          eyebrow="Developer tool"
          title="Clear the local library?"
          icon={Library}
          onClose={() => setConfirmClearLibrary(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmClearLibrary(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                data-autofocus
                onClick={() => {
                  const cleared = clearLocalLibrary();
                  setConfirmClearLibrary(false);
                  addToast({
                    tone: "success",
                    title: "Local library cleared",
                    detail: `${cleared.sessions} sessions and ${cleared.matches} cached matches were removed.`,
                  });
                }}
              >
                Clear library
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-muted">
            This permanently removes local games, completed and active sessions,
            archived playtime, executable matches, and emulator game mappings. A
            game that is currently running can be detected again on the next
            scan.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function NumberInput({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_130px_80px] items-center gap-3 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-md border border-border bg-surface px-3 py-2 text-text outline-none focus:border-accent"
      />
      <span className="text-text-muted">{suffix}</span>
    </label>
  );
}
