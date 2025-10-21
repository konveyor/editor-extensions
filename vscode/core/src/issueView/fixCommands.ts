import { IncidentTypeItem, ReferenceItem } from "./issueModel";

export const fixGroupOfIncidents = async (item: IncidentTypeItem | ReferenceItem) => {
  if (item) {
    item?.fix();
  }
};
