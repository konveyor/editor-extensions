import { AnalysisProfile } from "@editor-extensions/shared";

export function getBundledProfiles(): AnalysisProfile[] {
  return [
    // {
    //   id: "builtin-empty",
    //   name: "Empty Profile",
    //   mode: "source-only",
    //   customRules: [],
    //   useDefaultRules: true,
    //   labelSelector: "",
    //   readOnly: true,
    // },
    {
      id: "builtin-quarkus",
      name: "Migrate → Quarkus",
      mode: "source-and-dependencies",
      customRules: [],
      useDefaultRules: true,
      labelSelector: "(konveyor.io/source=java-ee) && (konveyor.io/target=quarkus)",
      readOnly: true,
    },
  ];
}
