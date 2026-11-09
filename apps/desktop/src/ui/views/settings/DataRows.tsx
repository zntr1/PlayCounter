import {
  Download,
  FolderInput,
  FolderOpen,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { exportLocalData, importLocalData } from "../../../backup";
import { getT } from "../../../i18n";
import { useAppStore } from "../../../store";
import { Button, Modal } from "../../primitives";
import { ResetPlayCounterDialog } from "../../ResetPlayCounterDialog";
import { ResetSettingsDialog } from "../../ResetSettingsDialog";
import { SettingsRow, type SettingsRowProps } from "./SettingsKit";
import { formatError, setSettingsOp, useSettingsOps } from "./settingsOps";

const t = getT("settings");

export function ExportDataRow({ level, disabled }: SettingsRowProps) {
  const exporting = useSettingsOps((state) => state.exporting);
  const addToast = useAppStore((state) => state.addToast);

  async function handleExport() {
    setSettingsOp({ exporting: true });
    try {
      const result = await exportLocalData();
      if ("cancelled" in result) return;
      addToast({
        tone: "success",
        title: t("Backup exported"),
        detail: result.path,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Export failed"),
        detail: formatError(error),
      });
    } finally {
      setSettingsOp({ exporting: false });
    }
  }

  return (
    <SettingsRow
      id="exportData"
      dataTour="settings-backup-export"
      level={level}
      disabled={disabled}
      title={t("Export data")}
      description={t(
        "Save your history, notes, playthroughs, shelves, game cache, and settings to a JSON file you can copy to another PC.",
      )}
      control={
        <Button
          icon={Download}
          loading={exporting}
          disabled={disabled}
          onClick={() => void handleExport()}
        >
          {t("Export")}
        </Button>
      }
    />
  );
}

export function ImportDataRow({ level, disabled }: SettingsRowProps) {
  const importing = useSettingsOps((state) => state.importing);
  const addToast = useAppStore((state) => state.addToast);
  const [confirming, setConfirming] = useState(false);

  async function handleImport() {
    setSettingsOp({ importing: true });
    try {
      const result = await importLocalData();
      if ("cancelled" in result) return;
      // On success the window reloads, so this toast is best-effort.
      addToast({
        tone: "success",
        title: t("Backup imported"),
        detail: t("{{sessions}} sessions restored. Reloading…", {
          sessions: result.sessions,
        }),
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Import failed"),
        detail: formatError(error),
      });
    } finally {
      setSettingsOp({ importing: false });
    }
  }

  return (
    <>
      <SettingsRow
        id="importData"
        dataTour="settings-backup-import"
        level={level}
        disabled={disabled}
        title={t("Import data")}
        description={t(
          "Replace all local data with a backup file. Your current data is backed up automatically first.",
        )}
        control={
          <Button
            icon={Upload}
            loading={importing}
            disabled={disabled}
            onClick={() => setConfirming(true)}
          >
            {t("Import")}
          </Button>
        }
      />
      {confirming ? (
        <Modal
          size="sm"
          labelId="import-data-dialog-title"
          eyebrow={t("Settings")}
          title={t("Import backup?")}
          icon={FolderInput}
          onClose={() => setConfirming(false)}
          footer={
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                icon={FolderOpen}
                onClick={() => {
                  setConfirming(false);
                  void handleImport();
                }}
              >
                {t("Choose file")}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-6 text-text-muted">
            {t(
              "This replaces your current play history, game cache, and settings with the contents of the backup file. Your current data is saved to a backup file first, and PlayCounter reloads when the import finishes.",
            )}
          </p>
        </Modal>
      ) : null}
    </>
  );
}

export function ResetSettingsRow({ level, disabled }: SettingsRowProps) {
  const blocked = useSettingsOps(
    (state) =>
      state.startupSyncing ||
      state.importing ||
      state.exporting ||
      state.installingUpdate,
  );
  const addToast = useAppStore((state) => state.addToast);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsRow
        id="resetSettings"
        level={level}
        disabled={disabled}
        title={t("Restore default settings")}
        description={t(
          "Reset app preferences while keeping your games, play history, and backup preferences.",
        )}
        control={
          <Button
            icon={RotateCcw}
            disabled={disabled || blocked}
            onClick={() => setConfirming(true)}
          >
            {t("Reset settings")}
          </Button>
        }
      />
      {confirming ? (
        <ResetSettingsDialog
          onCancel={() => setConfirming(false)}
          onReset={() => {
            setConfirming(false);
            addToast({
              tone: "success",
              title: t("Settings reset"),
              detail: t("Default app settings have been restored."),
            });
          }}
        />
      ) : null}
    </>
  );
}

export function ResetAllRow({ level, disabled }: SettingsRowProps) {
  const blocked = useSettingsOps(
    (state) => state.importing || state.exporting || state.installingUpdate,
  );
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsRow
        id="resetAll"
        level={level}
        disabled={disabled}
        title={t("Start over")}
        description={t(
          "Clear your library, history, and app settings, then restart PlayCounter. Your backup files are preserved.",
        )}
        control={
          <Button
            variant="danger"
            icon={Trash2}
            disabled={disabled || blocked}
            onClick={() => setConfirming(true)}
          >
            {t("Reset PlayCounter")}
          </Button>
        }
      />
      {confirming ? (
        <ResetPlayCounterDialog onCancel={() => setConfirming(false)} />
      ) : null}
    </>
  );
}
