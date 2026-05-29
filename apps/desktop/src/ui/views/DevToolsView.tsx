import { useAppStore } from "../../store";
import { Panel } from "../components";

export function DevToolsView() {
  const settings = useAppStore((state) => state.settings);
  const runtimeLog = useAppStore((state) => state.runtimeLog);
  const setDevNumber = useAppStore((state) => state.setDevNumber);
  const setApiEndpoint = useAppStore((state) => state.setApiEndpoint);
  const toggleVerboseLogs = useAppStore((state) => state.toggleVerboseLogs);

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
          label="Heartbeat interval"
          suffix="seconds"
          value={settings.heartbeatIntervalSeconds}
          onChange={(value) => setDevNumber("heartbeatIntervalSeconds", value)}
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
