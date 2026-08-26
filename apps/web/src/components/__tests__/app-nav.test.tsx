// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const route = vi.hoisted(() => ({ pathname: "/jobs" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

const { AppNav } = await import("../app-nav");

afterEach(cleanup);

describe("AppNav", () => {
  it("exposes Jobs as a first-class section and marks it active", () => {
    render(<AppNav />);

    const jobs = screen.getByRole("link", { name: "Jobs" });
    expect(jobs.getAttribute("href")).toBe("/jobs");
    expect(jobs.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Applications" }).getAttribute("aria-current")).toBe(
      null,
    );
  });
});
