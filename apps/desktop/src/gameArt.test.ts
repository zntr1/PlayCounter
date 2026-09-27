import { afterEach, expect, it, vi } from "vitest";
import { artForGame } from "./gameArt";
import { requestJson } from "./requestJson";

vi.mock("./requestJson", () => ({
  requestJson: vi.fn(async () => ({ covers: [], heroes: [] })),
  requestWithTimeout: vi.fn(),
}));
vi.mock("./store", () => ({
  useAppStore: {
    getState: () => ({ settings: { apiEndpoint: "https://api.example" } }),
  },
}));

afterEach(() => vi.mocked(requestJson).mockClear());

it("asks the API for 18+ art only when told to", async () => {
  await artForGame(5);
  await artForGame(5, { adult: false });
  await artForGame(5, { adult: true });
  expect(vi.mocked(requestJson).mock.calls.map((call) => call[0])).toEqual([
    "https://api.example/api/art/game/5",
    "https://api.example/api/art/game/5",
    "https://api.example/api/art/game/5?adult=true",
  ]);
});
