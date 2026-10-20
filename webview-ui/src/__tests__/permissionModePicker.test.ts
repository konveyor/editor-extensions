import { expect } from "expect";
import { permissionModeOptions } from "../components/ChatPage/PermissionModePicker";

describe("permissionModeOptions", () => {
  it("offers approve and auto", () => {
    expect(permissionModeOptions("auto").map((o) => o.value)).toEqual(["approve", "auto"]);
    expect(permissionModeOptions(null).map((o) => o.value)).toEqual(["approve", "auto"]);
  });

  it("shows a mode the agent set itself, but does not let the user pick it", () => {
    const options = permissionModeOptions("smart_approve");
    expect(options[0]).toEqual({ value: "smart_approve", label: "smart approve", disabled: true });
    expect(options.slice(1).map((o) => o.value)).toEqual(["approve", "auto"]);
  });
});
