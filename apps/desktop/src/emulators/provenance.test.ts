import { describe, expect, it } from "vitest";
import {
  emulatorMappingProvenance,
  emulatorSessionProvenance,
} from "./provenance";
import type { EmulatorMapping } from "./types";

describe.each(["pcsx2", "dolphin", "dosbox"])(
  "%s match provenance",
  (emulatorId) => {
    const contentKind = emulatorId === "dosbox" ? "program" : "rom";
    const contentValue = emulatorId === "dosbox" ? "nfs.exe" : "game.iso";
    const mapping: EmulatorMapping = {
      emulatorId,
      label: emulatorId,
      contentKey: `${emulatorId}:${contentKind}:${contentValue}`,
      contentKind,
      contentValue,
      display: contentValue,
      decision: "game",
      gameId: 192570,
      igdbId: 97,
      gameName: "Need for Speed: Underground 2",
      source: "igdb",
      confidence: "user",
      trust: "recognized",
      decidedAt: "2026-09-15T21:50:00Z",
      lastSeenAt: "2026-09-15T21:50:00Z",
    };
    const share = {
      gameId: mapping.gameId!,
      submittedAt: mapping.decidedAt,
    };

    it.each(["verified", "already_curated"] as const)(
      "uses Community for an exact %s link without changing its IGDB identity",
      (status) => {
        const saved = { ...mapping, share: { ...share, status } };
        const before = structuredClone(saved);
        expect(emulatorMappingProvenance(saved)).toEqual({
          source: "community",
        });
        expect(saved).toEqual(before);
      },
    );

    it("recognizes curated matches on installations that never submitted them", () => {
      expect(
        emulatorMappingProvenance({ ...mapping, confidence: "curated" }),
      ).toEqual({ source: "community" });
    });

    it("keeps local choices and title-search suggestions distinct", () => {
      expect(emulatorMappingProvenance(mapping)).toEqual({ source: "custom" });
      expect(
        emulatorMappingProvenance({ ...mapping, confidence: "probable" }),
      ).toEqual({ source: "igdb" });
    });

    it("shows pending review without claiming approval and respects revocation", () => {
      expect(
        emulatorMappingProvenance({
          ...mapping,
          share: { ...share, status: "pending" },
        }),
      ).toEqual({ source: "custom", approval: "pending" });
      expect(
        emulatorMappingProvenance({
          ...mapping,
          confidence: "curated",
          share: { ...share, status: "rejected" },
        }),
      ).toEqual({ source: "custom" });
    });

    it("does not transfer another game's approval to a replacement or custom game", () => {
      expect(
        emulatorMappingProvenance({
          ...mapping,
          gameId: 123,
          share: { ...share, status: "verified" },
        }),
      ).toEqual({ source: "custom" });
      expect(
        emulatorMappingProvenance({
          ...mapping,
          source: "custom",
          share: { ...share, status: "verified" },
        }),
      ).toEqual({ source: "custom" });
    });

    it("repairs old sessions from the exact saved mapping without metadata fallback", () => {
      const session = {
        gameId: mapping.gameId!,
        igdbId: mapping.igdbId,
        source: mapping.source,
        emulator: {
          emulatorId,
          label: emulatorId,
          contentKey: mapping.contentKey,
          display: mapping.display,
          trust: mapping.trust,
        },
      };
      const curated = { ...mapping, confidence: "curated" as const };
      expect(emulatorSessionProvenance(session, curated)).toEqual({
        source: "community",
      });
      expect(emulatorSessionProvenance(session)).toEqual({});
      expect(
        emulatorSessionProvenance(session, { ...curated, gameId: 123 }),
      ).toEqual({});
      expect(
        emulatorSessionProvenance(session, { ...curated, igdbId: 123 }),
      ).toEqual({});
      expect(
        emulatorSessionProvenance(session, { ...curated, source: "community" }),
      ).toEqual({});
      expect(
        emulatorSessionProvenance(session, {
          ...curated,
          contentKey: "another:rom:game.iso",
        }),
      ).toEqual({});
      expect(
        emulatorSessionProvenance(session, { ...curated, decision: "ignored" }),
      ).toEqual({});
      expect(
        emulatorSessionProvenance({ ...session, source: "custom" }),
      ).toEqual({ source: "custom" });
    });
  },
);
