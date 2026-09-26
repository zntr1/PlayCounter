import { describe, expect, it } from "vitest";
import { exeProductName, exePublisher } from "./exeDetails";

describe("exe product name", () => {
  it.each([
    [
      { productName: "PostgreSQL", fileDescription: "PostgreSQL Server" },
      "postgres.exe",
      "PostgreSQL Server",
    ],
    [
      { productName: "Hades II", fileDescription: "Hades2" },
      "Hades2.exe",
      "Hades II",
    ],
    [
      {
        productName: "Microsoft® Visual Studio®",
        fileDescription: "Microsoft Visual C++ Package Server",
      },
      "vcpkgsrv.exe",
      "Microsoft Visual C++ Package Server",
    ],
    [{ productName: "Discord™" }, "Discord.exe", "Discord"],
    [{ fileDescription: "  " }, "tool.exe", null],
  ])("names %o", (details, exeName, expected) => {
    expect(exeProductName(details, exeName)).toBe(expected);
  });

  it("returns nothing without details and cleans the publisher", () => {
    expect(exeProductName(null, "x.exe")).toBeNull();
    expect(exePublisher({ companyName: "Microsoft® Corporation " })).toBe(
      "Microsoft Corporation",
    );
  });
});
